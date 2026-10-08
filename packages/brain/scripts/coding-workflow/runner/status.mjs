#!/usr/bin/env node
// runner 状态查看：node status.mjs [--log-dir <dir>] [--json]，按回执修改时间倒序列出每任务状态（默认目录同 runner logDir）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './lib/config.mjs';
import { summarizeReceipt } from './lib/receipt.mjs';

const FINAL_STATUSES = new Set(['completed', 'partial', 'failed']);
const EMPTY_HINT = '没有运行记录';

function parseReceipt(file) {
  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { status: 'unreadable', failed_activity: null, reason_code: null, pr_url: null };
  }
  const isObject = receipt !== null && typeof receipt === 'object';
  if (isObject && 'last_event' in receipt) {
    return { status: 'running', failed_activity: null, reason_code: null, pr_url: null };
  }
  if (isObject && FINAL_STATUSES.has(receipt.status)) {
    const { status, failed_activity, reason_code, pr_url } = summarizeReceipt(receipt);
    return { status, failed_activity, reason_code, pr_url };
  }
  return { status: 'unreadable', failed_activity: null, reason_code: null, pr_url: null };
}

/** 每任务回执状态，按文件 mtime 倒序；目录不存在或无回执返回 []。 */
export function collectStatus(logDir) {
  let names;
  try {
    names = fs.readdirSync(logDir);
  } catch {
    return [];
  }
  const rows = [];
  for (const name of names.filter((n) => n.endsWith('.json'))) {
    const file = path.join(logDir, name);
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    rows.push({
      task_id: name.slice(0, -'.json'.length),
      mtime: new Date(stat.mtimeMs).toISOString(),
      mtimeMs: stat.mtimeMs,
      ...parseReceipt(file),
    });
  }
  rows.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return rows.map(({ mtimeMs, ...row }) => row);
}

export function formatStatus(rows) {
  if (!rows.length) return EMPTY_HINT;
  return rows.map((r) => {
    const tail = r.status === 'completed'
      ? (r.pr_url ?? '')
      : `failed_activity=${r.failed_activity ?? '-'} reason_code=${r.reason_code ?? '-'}`;
    return `${r.task_id}  ${r.status}  ${r.mtime}  ${tail}`.trimEnd();
  }).join('\n');
}

function parseArgs(argv) {
  const opts = { logDir: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--log-dir') opts.logDir = argv[++i] ?? null;
    else if (argv[i] === '--json') opts.json = true;
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const logDir = opts.logDir || loadConfig().logDir;
  const rows = collectStatus(logDir);
  if (opts.json) console.log(JSON.stringify(rows));
  else if (!rows.length) console.log(`${EMPTY_HINT}（${logDir}）`);
  else console.log(formatStatus(rows));
  process.exitCode = 0;
}

let directEntry = false;
try {
  directEntry = Boolean(process.argv[1])
    && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
} catch { /* 被 import 时不启动 */ }
if (directEntry) main();
