#!/usr/bin/env node
// runner 状态查看：node status.mjs [--log-dir <dir>] [--json]，按回执修改时间倒序列出每任务状态（默认目录同 runner logDir）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './lib/config.mjs';
import { summarizeReceipt } from './lib/receipt.mjs';
import { readState } from './lib/cifix-scan.mjs';
import { loadRepos } from './lib/repos.mjs';

const FINAL_STATUSES = new Set(['completed', 'partial', 'failed']);
const EMPTY_HINT = '没有运行记录';
// runner 使用 Brain 的 UUID 任务 ID 命名回执；其他 JSON 是状态文件，不是任务。
const RECEIPT_NAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i;

function githubPr(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.port) return null;
    const m = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/.exec(url.pathname);
    return m ? { slug: `${m[1]}/${m[2]}`.toLowerCase(), number: m[3] } : null;
  } catch { return null; }
}

function parseReceipt(file, taskId) {
  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { status: 'unreadable', failed_activity: null, reason_code: null, pr_url: null };
  }
  const isObject = receipt !== null && typeof receipt === 'object' && !Array.isArray(receipt);
  // 仅验证本地回执形态与任务前缀；不能证明文件来源或 GitHub 合并。
  if (!isObject || receipt.schema_version !== 1 || receipt.workflow !== 'coding_spec'
      || typeof receipt.run_tag !== 'string' || !new RegExp(`^cw-${taskId.slice(0, 8).toLowerCase()}-\\d{8}$`).test(receipt.run_tag)
      || !Array.isArray(receipt.activities)) {
    return { status: 'unreadable', failed_activity: null, reason_code: null, pr_url: null };
  }
  if (isObject && 'last_event' in receipt) {
    return { status: 'running', failed_activity: null, reason_code: null, pr_url: null };
  }
  if (isObject && FINAL_STATUSES.has(receipt.status)) {
    const { status, failed_activity, reason_code, pr_url } = summarizeReceipt(receipt);
    return { status, failed_activity, reason_code, pr_url };
  }
  return { status: 'unreadable', failed_activity: null, reason_code: null, pr_url: null };
}

/** pr_url 对应的 CI 自动修复记录摘要；没有 PR 或没修过返回 null。 */
function ciFixSummary(logDir, prUrl, repos) {
  const pr = githubPr(prUrl);
  if (!pr) return null;
  const repo = repos.find((entry) => typeof entry.slug === 'string' && entry.slug.toLowerCase() === pr.slug);
  if (!repo) return null;
  const { attempts } = readState({ logDir, stateNs: repo.state_ns }, pr.number);
  if (attempts.length === 0) return null;
  return { attempts: attempts.length, last_result: attempts[attempts.length - 1]?.result ?? null };
}

/** 每任务回执状态，按文件 mtime 倒序；目录不存在或无回执返回 []。 */
export function collectStatus(logDir) {
  let names;
  try {
    names = fs.readdirSync(logDir);
  } catch {
    return [];
  }
  let repos = [];
  try { repos = loadRepos(); } catch { /* 未能核实仓库身份，不关联 CI 修复状态 */ }
  const rows = [];
  for (const name of names.filter((n) => RECEIPT_NAME_RE.test(n))) {
    const file = path.join(logDir, name);
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const receipt = parseReceipt(file, name.slice(0, -'.json'.length));
    rows.push({
      task_id: name.slice(0, -'.json'.length),
      mtime: new Date(stat.mtimeMs).toISOString(),
      mtimeMs: stat.mtimeMs,
      ...receipt,
      ci_fix: ciFixSummary(logDir, receipt.pr_url, repos),
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
    const ciFix = r.ci_fix ? `  ci_fix=${r.ci_fix.attempts}次 last=${r.ci_fix.last_result ?? '-'}` : '';
    return `${r.task_id}  ${r.status}  ${r.mtime}  ${tail}${ciFix}`.trimEnd();
  }).join('\n');
}

function parseArgs(argv) {
  const opts = { logDir: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--log-dir') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) throw new Error('--log-dir 需要目录参数');
      opts.logDir = value;
      i += 1;
    }
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
if (directEntry) {
  try { main(); } catch (err) {
    console.error(err.message);
    process.exitCode = 2;
  }
}
