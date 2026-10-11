/**
 * conversation-capture-remote.js — 对话捕获的远端拉取（ssh mmv 只读）
 *
 * 病根（2026-10-11 查实）：Brain 2026-09-10 迁 us-vps 容器后，容器里没有
 * ~/.claude/projects，三适配器静默返回 []，captures(source=conversation-*) 归零一个月。
 * 会话 transcript 只在主理人工作机 MMV 上，Brain 不能也不该在 us-vps 上读本机文件
 * （us-vps 零执行铁律 96054a8b：只做调度/接线/账本）。
 *
 * 做法与 openclaw-run-ingest 同款：Brain 定时 ssh mmv，只读跑一段脚本把会话吐成 JSON。
 * 远端脚本 = 三个生产适配器源码原样（data: URL 动态 import）+ 一层瘦身包装，
 * 不在 mmv 上落任何文件、不改任何东西；适配器逻辑只有一份，本地/远端同源。
 */
import fs from 'fs';
import { defaultExecAsync, buildHostCmd } from './host-exec.js';

const ADAPTERS = [
  ['claude', 'conversation-capture-claude.js', 'extractClaudeSessions'],
  ['codex', 'conversation-capture-codex.js', 'extractCodexSessions'],
  ['grok', 'conversation-capture-grok.js', 'extractGrokSessions'],
];

/** 每个 session 只回传尾部 turns（编排层 joinTurns 本就只取末 2000 字），控制 ssh 回传体积 */
export const REMOTE_TURN_CHAR_BUDGET = 4000;
export const REMOTE_EXEC_TIMEOUT_MS = 90_000;
const DEFAULT_HOST = process.env.CECELIA_CONVERSATION_CAPTURE_HOST || 'mmv';

function adapterSourceB64(file) {
  const src = fs.readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
  return Buffer.from(src, 'utf8').toString('base64');
}

/**
 * 生成在远端执行的 ESM 脚本。sinceMs 只接受有限整数（直接内插）。
 * 输出：{ sessions: [...], failures: [name], errors: {name: msg} }
 * claude 目录不存在记 failure（不许再静默 0）。
 */
export function buildRemoteExtractorScript(sinceMs) {
  if (!Number.isSafeInteger(sinceMs)) throw new Error(`invalid_sinceMs: ${String(sinceMs)}`);
  const adapters = ADAPTERS.map(([name, file, fn]) => [name, adapterSourceB64(file), fn]);
  return `
import fs from 'fs';
import os from 'os';
import path from 'path';
const SINCE = ${sinceMs};
const BUDGET = ${REMOTE_TURN_CHAR_BUDGET};
const ADAPTERS = ${JSON.stringify(adapters)};
const out = { sessions: [], failures: [], errors: {} };
function trimTurns(turns) {
  const kept = [];
  let used = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    const text = String(t.text || '');
    const room = BUDGET - used;
    if (room <= 0) break;
    const clipped = text.length > room ? text.slice(-room) : text;
    kept.unshift({ ...t, text: clipped });
    used += clipped.length;
  }
  return kept;
}
const claudeDir = process.env.CLAUDE_PROJECTS_DIR || path.join(os.homedir(), '.claude', 'projects');
for (const [name, b64, fn] of ADAPTERS) {
  try {
    if (name === 'claude' && !fs.existsSync(claudeDir)) throw new Error('projects_dir_missing: ' + claudeDir);
    const mod = await import('data:text/javascript;base64,' + b64);
    for (const s of mod[fn](SINCE)) out.sessions.push({ ...s, turns: trimTurns(s.turns || []) });
  } catch (e) {
    out.failures.push(name);
    out.errors[name] = String(e && e.message || e).slice(0, 500);
  }
}
process.stdout.write(JSON.stringify(out));
`;
}

/** 脚本 base64 后经 ssh 喂给 mmv 上的 node（规避多层引号转义）；容器内再包一层宿主逃逸 */
export function buildRemoteCaptureCmd(sinceMs, { inContainer = false, host = DEFAULT_HOST } = {}) {
  const b64 = Buffer.from(buildRemoteExtractorScript(sinceMs), 'utf8').toString('base64');
  const remote = `ssh -o BatchMode=yes -o ConnectTimeout=20 ${host} 'echo ${b64} | base64 -d | node --input-type=module'`;
  return buildHostCmd(remote, inContainer);
}

export function parseRemoteCaptureOutput(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(String(stdout ?? '').trim());
  } catch (e) {
    throw new Error(`parse_error: ${e.message}`);
  }
  if (!parsed || !Array.isArray(parsed.sessions)) throw new Error('parse_error: expected {sessions:[]}');
  return {
    sessions: parsed.sessions,
    failures: Array.isArray(parsed.failures) ? parsed.failures : [],
    errors: parsed.errors && typeof parsed.errors === 'object' ? parsed.errors : {},
  };
}

/** ssh / 解析失败直接抛，由编排层计入 adapter_failures('remote') */
export async function fetchRemoteSessions(sinceMs, { exec = defaultExecAsync, inContainer = false, host } = {}) {
  const stdout = await exec(buildRemoteCaptureCmd(sinceMs, { inContainer, host }), { timeoutMs: REMOTE_EXEC_TIMEOUT_MS });
  return parseRemoteCaptureOutput(stdout);
}
