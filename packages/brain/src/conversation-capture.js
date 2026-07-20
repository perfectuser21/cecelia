/**
 * conversation-capture.js — 对话原始捕获编排层（decision 39fa77ac，前身 f64adaaf/0c9e1652）
 *
 * 调用三个工具适配器（conversation-capture-claude/codex/grok.js）拿到全部 session，
 * 过滤出"最后一条消息距今 ≥15 分钟"（判定为已结束）的 session，逐个：
 *   ① 原始文本写一条 capture（nature=null）
 *   ② 调 Haiku 生成 2-4 条 topic 摘要，写另一条 capture（nature='session_summary'）
 * 10 分钟自 gate（接 scheduler-jobs.js），零静默失败——失败必计入 errors。
 *
 * 与 PR#4135 版本的区别：从"逐条消息 + 只支持 Claude Code"改为"按 session 分组 +
 * 15 分钟闲置判定 + 三工具"。dedupeKey 绑定 sessionId+lastEntryId（而非只绑
 * sessionId），确保同一 session 复聊后再次闲置时能产生新 capture，不会漏内容。
 */
import crypto from 'crypto';
import { pushCapture } from './capture-inbox.js';
import { callLLM } from './llm-caller.js';
import { extractJsonObject } from './json-utils.js';
import { extractClaudeSessions } from './conversation-capture-claude.js';
import { extractCodexSessions } from './conversation-capture-codex.js';
import { extractGrokSessions } from './conversation-capture-grok.js';

const SCAN_INTERVAL_MS = parseInt(process.env.CECELIA_CONVERSATION_CAPTURE_INTERVAL_MS || String(10 * 60 * 1000), 10);
const FIRST_RUN_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const IDLE_THRESHOLD_MS = 15 * 60 * 1000;
const SENTINEL_KEY = 'conversation_capture_last_scan';
const MAX_CONTENT_LEN = 2000;

let lastRunAt = 0;
export function __resetConversationCaptureForTest() { lastRunAt = 0; }

export function sessionDedupeKey(session, suffix = '') {
  const raw = `${session.source}:${session.sessionId}:${session.lastEntryId}${suffix}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function joinTurns(turns) {
  return turns.map((t) => t.text).join('\n\n').slice(-MAX_CONTENT_LEN);
}

const SUMMARY_PROMPT = (rawText) => `你是 Cecelia 的对话摘要助手。以下是 Alex 在一段 AI 编程会话里说过的原始内容（只有他自己打的字，不含 AI 回复）。
提炼出 2-4 条这段会话的核心话题，每条一句话。只输出 JSON，不要其他文字：
{"topics": ["话题1", "话题2", ...]}

原始内容：
---
${rawText}
---`;

export async function summarizeSession(rawText, llm) {
  try {
    const { text } = await llm('thalamus', SUMMARY_PROMPT(rawText), { maxTokens: 256 });
    const parsed = extractJsonObject(text);
    const topics = Array.isArray(parsed?.topics)
      ? parsed.topics.filter((t) => typeof t === 'string' && t.trim())
      : [];
    if (topics.length === 0) return null;
    return topics.map((t, i) => `${i + 1}. ${t}`).join('\n');
  } catch (e) {
    console.warn(`[conversation-capture] summarize failed: ${e.message}`);
    return null;
  }
}

/**
 * 主入口：扫三工具 + 过滤已闲置 session + 写 captures（原始+摘要）+ 维护扫描哨兵。
 */
export async function runConversationCapture(pool, { llm = callLLM } = {}) {
  const now = Date.now();
  if (now - lastRunAt < SCAN_INTERVAL_MS) return { skipped: true };
  lastRunAt = now;

  let lastScanMs;
  try {
    const { rows } = await pool.query(`SELECT value_json FROM working_memory WHERE key = $1`, [SENTINEL_KEY]);
    const lastScanIso = rows[0]?.value_json?.last_scan_at;
    lastScanMs = lastScanIso ? new Date(lastScanIso).getTime() : now - FIRST_RUN_LOOKBACK_MS;
  } catch {
    lastScanMs = now - FIRST_RUN_LOOKBACK_MS;
  }

  let allSessions = [];
  const adapters = [
    ['claude', extractClaudeSessions],
    ['codex', extractCodexSessions],
    ['grok', extractGrokSessions],
  ];
  for (const [name, fn] of adapters) {
    try {
      allSessions = allSessions.concat(fn(lastScanMs));
    } catch (e) {
      console.warn(`[conversation-capture] ${name} adapter failed: ${e.message}`);
    }
  }

  const idleSessions = allSessions.filter(
    (s) => s.turns.length > 0 && (now - s.lastActivityMs) >= IDLE_THRESHOLD_MS
  );

  let pushed = 0;
  let errors = 0;

  for (const session of idleSessions) {
    const rawText = joinTurns(session.turns);

    try {
      const result = await pushCapture(pool, {
        content: rawText,
        source: session.source,
        repo: session.repo,
        dedupeKey: sessionDedupeKey(session),
      });
      if (result?.captureId) {
        pushed++;
      } else {
        errors++;
        console.warn(`[conversation-capture] raw push returned null for session=${session.sessionId}`);
      }
    } catch (e) {
      errors++;
      console.warn(`[conversation-capture] raw push failed for session=${session.sessionId}: ${e.message}`);
    }

    const summary = await summarizeSession(rawText, llm);
    if (summary) {
      try {
        const result = await pushCapture(pool, {
          content: summary,
          source: session.source,
          nature: 'session_summary',
          repo: session.repo,
          dedupeKey: sessionDedupeKey(session, ':summary'),
        });
        if (!result?.captureId) {
          errors++;
          console.warn(`[conversation-capture] summary push returned null for session=${session.sessionId}`);
        }
      } catch (e) {
        errors++;
        console.warn(`[conversation-capture] summary push failed for session=${session.sessionId}: ${e.message}`);
      }
    }
  }

  const record = { last_scan_at: new Date(now).toISOString(), pushed, errors, sessions_processed: idleSessions.length };
  try {
    await pool.query(
      `INSERT INTO working_memory (key, value_json, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
      [SENTINEL_KEY, JSON.stringify(record)]
    );
  } catch (e) {
    console.warn(`[conversation-capture] sentinel write failed: ${e.message}`);
  }

  return { ok: true, pushed, errors };
}
