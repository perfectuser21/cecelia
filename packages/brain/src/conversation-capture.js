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
 * 15 分钟闲置判定 + 三工具"。
 *
 * dedupeKey 只绑 sessionId（2026-07-22 起，此前绑 sessionId+lastEntryId 导致同一
 * 会话每次"闲置又复聊"都被当新会话重新摘要，造成三倍冗余）：复聊后内容变化时，
 * 按 dedupe_key 做 UPDATE 覆盖已有 capture 的 content，而不是 INSERT 新行——既不
 * 丢内容，也不会一个 session 产生多条记录。
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
// mtime 下限必须用固定回看窗口而非"上次扫描时间"，否则 sinceMs 会随每次 10 分钟扫描滑动追上
// now，导致文件在"刚写完、还没闲置"和"已闲置但 mtime 早已滑出窗口"之间永远没有交集，
// session 结构性地永远捕获不到（decision：Critical #1 fix，见 handoff）。
// 35 分钟 = 15 分钟闲置阈值 + 2 个扫描周期缓冲，保证一个 session 越过闲置线后能被连续
// 好几轮扫描重新读到（dedupeKey 防重复写入）。
const LOOKBACK_WINDOW_MS = IDLE_THRESHOLD_MS + 2 * SCAN_INTERVAL_MS;
const SENTINEL_KEY = 'conversation_capture_last_scan';
const MAX_CONTENT_LEN = 2000;

let lastRunAt = 0;
export function __resetConversationCaptureForTest() { lastRunAt = 0; }

export function sessionDedupeKey(session, suffix = '') {
  const raw = `${session.source}:${session.sessionId}${suffix}`;
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

  // sentinel 只用来判断"是否首次运行"（首次要回看 24h 补历史积压），不再用它的
  // last_scan_at 作为 mtime 下限——那个用法正是 Critical #1 的病灶。
  let hasSentinel = false;
  try {
    const { rows } = await pool.query(`SELECT value_json FROM working_memory WHERE key = $1`, [SENTINEL_KEY]);
    hasSentinel = !!rows[0]?.value_json?.last_scan_at;
  } catch {
    hasSentinel = false;
  }
  const sinceMs = hasSentinel ? (now - LOOKBACK_WINDOW_MS) : (now - FIRST_RUN_LOOKBACK_MS);

  let errors = 0;
  const adapterFailures = [];
  let allSessions = [];
  const adapters = [
    ['claude', extractClaudeSessions],
    ['codex', extractCodexSessions],
    ['grok', extractGrokSessions],
  ];
  for (const [name, fn] of adapters) {
    try {
      allSessions = allSessions.concat(fn(sinceMs));
    } catch (e) {
      errors++;
      adapterFailures.push(name);
      console.warn(`[conversation-capture] ${name} adapter failed: ${e.message}`);
    }
  }

  const idleSessions = allSessions.filter(
    (s) => s.turns.length > 0 && (now - s.lastActivityMs) >= IDLE_THRESHOLD_MS
  );

  let pushed = 0;
  let skippedMachine = 0;
  let skippedUnregistered = 0;
  let provenanceLookupFailed = false;
  let humanSessions = [];

  if (idleSessions.length > 0) {
    const sessionIds = [...new Set(idleSessions.map((session) => session.sessionId))];
    try {
      const { rows } = await pool.query(
        `SELECT session_id, kind
         FROM session_provenance
         WHERE session_id = ANY($1::text[])`,
        [sessionIds]
      );
      const provenance = new Map(rows.map((row) => [row.session_id, row.kind]));
      humanSessions = idleSessions.filter((session) => {
        const kind = provenance.get(session.sessionId);
        if (kind === 'human') return true;
        if (kind === 'machine') skippedMachine++;
        else skippedUnregistered++;
        return false;
      });
    } catch (e) {
      errors++;
      provenanceLookupFailed = true;
      console.warn(`[conversation-capture] provenance lookup failed; fail-closed for this scan: ${e.message}`);
    }
  }

  for (const session of humanSessions) {
    const rawText = joinTurns(session.turns);
    const dedupeKey = sessionDedupeKey(session);

    // 内容和上次入库完全一致就整段跳过——既不重新 pushCapture，更不要再花钱调一次
    // LLM 摘要（Critical #2）。内容有变化（同一 session 复聊后再次闲置）则往下走，
    // pushCapture 会按 dedupeKey UPDATE 已有行的 content，不产生新行。查询本身失败
    // 要 fail open（当作未捕获继续处理），不能因为一次 DB 抖动就静默漏掉一个 session。
    let existingContent;
    try {
      const { rows: existing } = await pool.query(
        'SELECT content FROM captures WHERE dedupe_key = $1 LIMIT 1',
        [dedupeKey]
      );
      existingContent = existing.length > 0 ? existing[0].content : undefined;
    } catch (e) {
      console.warn(`[conversation-capture] dedupe check failed for session=${session.sessionId}, fail-open and processing anyway: ${e.message}`);
      existingContent = undefined;
    }
    if (existingContent === rawText) continue;

    try {
      const result = await pushCapture(pool, {
        content: rawText,
        source: session.source,
        repo: session.repo,
        dedupeKey,
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

  const record = {
    last_scan_at: new Date(now).toISOString(),
    pushed,
    errors,
    sessions_seen: idleSessions.length,
    sessions_processed: humanSessions.length,
    skipped_machine: skippedMachine,
    skipped_unregistered: skippedUnregistered,
    provenance_lookup_failed: provenanceLookupFailed,
    adapter_failures: adapterFailures,
  };
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

  return {
    ok: true,
    pushed,
    errors,
    sessions_seen: idleSessions.length,
    sessions_processed: humanSessions.length,
    skipped_machine: skippedMachine,
    skipped_unregistered: skippedUnregistered,
    provenance_lookup_failed: provenanceLookupFailed,
  };
}
