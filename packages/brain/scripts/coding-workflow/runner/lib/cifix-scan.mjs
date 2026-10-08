// CI 修复的找目标与取日志：runner 自己开的 cw PR（分支 cp-<stamp>-cw-<id8>）里，
// 必需检查全部出结果且至少一个失败、本 head 没修过、累计次数未用尽的第一个。
import fs from 'node:fs';
import path from 'node:path';
import { run } from './proc.mjs';

export const CW_BRANCH_RE = /^cp-\d{8,10}-cw-[0-9a-f]{8}$/;
const GH_TIMEOUT_MS = 60 * 1000;
const LOG_TAIL_LINES = 120;
const LOGS_MAX_CHARS = 40000;
const JOB_LINK_RE = /github\.com\/([^/]+\/[^/]+)\/actions\/runs\/\d+\/job\/(\d+)/;
const ACTIONS_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z ?/;

/** gh 子命令 → 解析后的 JSON；输出不是 JSON 返回 null。`pr checks` 有失败/pending 时非 0 退出但照常输出 JSON。 */
async function ghJson(cfg, args) {
  const r = await run(cfg.ghBin, args, { cwd: cfg.repo, timeoutMs: GH_TIMEOUT_MS });
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

export function statePath(cfg, prNumber) {
  return path.join(cfg.logDir, `cifix-${prNumber}.json`);
}

export function readState(cfg, prNumber) {
  try {
    const state = JSON.parse(fs.readFileSync(statePath(cfg, prNumber), 'utf8'));
    return Array.isArray(state?.attempts) ? state : { attempts: [] };
  } catch {
    return { attempts: [] };
  }
}

/** 必需检查：全部出结果且有失败 → 失败名单；还有 pending、全通过或没有必需检查 → null。 */
async function failedRequired(cfg, prNumber) {
  const rows = await ghJson(cfg, ['pr', 'checks', String(prNumber), '--required', '--json', 'name,bucket']);
  if (!Array.isArray(rows) || rows.length === 0) return null;
  if (rows.some((r) => r.bucket === 'pending')) return null;
  const failed = rows.filter((r) => r.bucket === 'fail').map((r) => r.name);
  return failed.length > 0 ? failed : null;
}

/** 下一个要修的 PR：{ pr, failedRequired }，没有返回 null。 */
export async function findTarget(cfg, log) {
  const prs = await ghJson(cfg, ['pr', 'list', '--state', 'open', '--limit', '100', '--json', 'number,headRefName,headRefOid,url,isDraft']);
  if (!Array.isArray(prs)) {
    log('CI 修复：列 PR 失败，本轮跳过');
    return null;
  }
  const ours = prs.filter((p) => CW_BRANCH_RE.test(p.headRefName ?? '')).sort((a, b) => a.number - b.number);
  for (const pr of ours) {
    const { attempts } = readState(cfg, pr.number);
    if (attempts.length >= cfg.ciFixMaxAttempts) continue;
    if (attempts.some((a) => a.head === pr.headRefOid)) continue;
    const failed = await failedRequired(cfg, pr.number);
    if (failed) return { pr, failedRequired: failed };
  }
  return null;
}

/** 全部失败检查的 job 日志末尾（去 Actions 时间戳），按检查名分段，总长封顶。返回 { names, text }。 */
export async function failureLogs(cfg, prNumber) {
  const rows = await ghJson(cfg, ['pr', 'checks', String(prNumber), '--json', 'name,bucket,link']);
  const failed = (Array.isArray(rows) ? rows : []).filter((r) => r.bucket === 'fail');
  const parts = [];
  for (const check of failed) {
    const m = JOB_LINK_RE.exec(check.link ?? '');
    if (!m) continue;
    const r = await run(cfg.ghBin, ['api', `repos/${m[1]}/actions/jobs/${m[2]}/logs`], { cwd: cfg.repo, timeoutMs: GH_TIMEOUT_MS });
    const lines = r.stdout.split('\n').map((l) => l.replace(ACTIONS_TS_RE, '')).filter((l) => l.trim());
    parts.push(`### ${check.name}\n\`\`\`\n${lines.slice(-LOG_TAIL_LINES).join('\n')}\n\`\`\``);
  }
  const text = parts.join('\n\n');
  return {
    names: failed.map((c) => c.name),
    text: text.length > LOGS_MAX_CHARS ? `…${text.slice(-LOGS_MAX_CHARS)}` : text,
  };
}
