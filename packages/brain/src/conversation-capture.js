/**
 * conversation-capture.js — 对话原始捕获（decision f64adaaf/0c9e1652）
 *
 * 纯机械过滤 ~/.claude/projects/*.jsonl 里 role=user 的真人文本轮次（排除
 * tool_result 注入消息、排除 assistant 消息），零 LLM 成本，写入现有 captures
 * 表（source=conversation）。10 分钟自 gate，接 scheduler-jobs.js。
 *
 * 与已退役的"轨道C conversation-digest"（decision a823206d）的区别：不进
 * LLM、不复用旧表、失败必须可观测（详见 architecture.md 前情提要）。
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { pushCapture } from './capture-inbox.js';

export const CLAUDE_PROJECTS_DIR = process.env.CLAUDE_PROJECTS_DIR
  || path.join(os.homedir(), '.claude', 'projects');

const SCAN_INTERVAL_MS = parseInt(process.env.CECELIA_CONVERSATION_CAPTURE_INTERVAL_MS || String(10 * 60 * 1000), 10);
const FIRST_RUN_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const SENTINEL_KEY = 'conversation_capture_last_scan';

let lastRunAt = 0;
export function __resetConversationCaptureForTest() { lastRunAt = 0; }

function dedupeKeyFor(filePath, entry, lineIndex) {
  const idPart = entry.uuid || `line${lineIndex}`;
  const raw = `${path.basename(filePath)}:${idPart}`;
  return crypto.createHash('sha1').update(raw).digest('hex');
}

function isRealUserText(entry) {
  if (entry?.message?.role !== 'user') return false;
  const content = entry.message.content;
  if (typeof content === 'string') return content.trim().length > 0;
  if (Array.isArray(content)) {
    const hasToolResult = content.some((b) => b?.type === 'tool_result');
    if (hasToolResult) return false;
    const textBlocks = content.filter((b) => b?.type === 'text' && b.text?.trim());
    return textBlocks.length > 0;
  }
  return false;
}

function extractText(entry) {
  const content = entry.message.content;
  if (typeof content === 'string') return content.trim();
  return content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n').trim();
}

/**
 * 解析单个 JSONL 会话文件，返回 sinceMs 之后的真人文本轮次。
 * 纯函数：不读写数据库，不产生副作用；格式损坏的行/不存在的文件返回空数组。
 */
export function extractUserTurns(filePath, sinceMs) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }

  const lines = content.split('\n').filter((l) => l.trim());
  const turns = [];

  lines.forEach((line, lineIndex) => {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      return;
    }
    if (!isRealUserText(entry)) return;

    const timestamp = entry.timestamp || null;
    if (timestamp) {
      const ts = new Date(timestamp).getTime();
      if (!Number.isNaN(ts) && ts < sinceMs) return;
    }

    turns.push({
      text: extractText(entry).slice(0, 2000),
      dedupeKey: dedupeKeyFor(filePath, entry, lineIndex),
      timestamp,
    });
  });

  return turns;
}

/**
 * 扫描目录 + 写入 captures + 维护扫描进度哨兵。
 * 10 分钟自 gate（复用 capture-triage.js 的模块自 gate 模型）。
 */
export async function runConversationCapture(pool) {
  const now = Date.now();
  if (now - lastRunAt < SCAN_INTERVAL_MS) return { skipped: true };
  lastRunAt = now;

  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) {
    return { ok: false, error: 'CLAUDE_PROJECTS_DIR not found', pushed: 0, errors: 0 };
  }

  let lastScanMs;
  try {
    const { rows } = await pool.query(
      `SELECT value_json FROM working_memory WHERE key = $1`,
      [SENTINEL_KEY]
    );
    const lastScanIso = rows[0]?.value_json?.last_scan_at;
    lastScanMs = lastScanIso ? new Date(lastScanIso).getTime() : now - FIRST_RUN_LOOKBACK_MS;
  } catch {
    lastScanMs = now - FIRST_RUN_LOOKBACK_MS;
  }

  let pushed = 0;
  let errors = 0;

  let projectDirs = [];
  try {
    projectDirs = fs.readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch (e) {
    return { ok: false, error: e.message, pushed: 0, errors: 0 };
  }

  for (const dir of projectDirs) {
    const dirPath = path.join(CLAUDE_PROJECTS_DIR, dir.name);
    let files;
    try {
      files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      let stat;
      try {
        stat = fs.statSync(filePath);
      } catch {
        continue;
      }
      if (stat.mtimeMs < lastScanMs) continue;

      const turns = extractUserTurns(filePath, lastScanMs);
      for (const turn of turns) {
        try {
          const result = await pushCapture(pool, {
            content: turn.text,
            source: 'conversation',
            // captures.repo 是 varchar(100)，dir.name 是 Claude Code 项目目录名
            // （完整路径把 / 替换成 -），嵌套 worktree 路径真实超过 100 字符。
            // repo 只是描述性元数据非唯一键（dedupeKey 已负责去重），截断即可。
            repo: dir.name.slice(0, 100),
            dedupeKey: turn.dedupeKey,
          });
          if (result?.captureId) {
            pushed++;
          } else {
            // pushCapture 的契约是永不抛出：DB 错误（含约束违反）内部 catch 后
            // console.warn 并 resolve(null)。这才是它真实的失败信号路径，
            // 必须在这里计入 errors，否则会出现"全绿返回但数据丢失"的假阳性。
            errors++;
            console.warn(`[conversation-capture] pushCapture returned null for ${filePath} (dedupeKey=${turn.dedupeKey})`);
          }
        } catch (e) {
          // 防御性兜底：pushCapture 本身不会走到这里，但保留以覆盖其他未预期异常。
          errors++;
          console.warn(`[conversation-capture] push failed for ${filePath}: ${e.message}`);
        }
      }
    }
  }

  const record = { last_scan_at: new Date(now).toISOString(), pushed, errors };
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
