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
export async function ghJson(cfg, args) {
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
    return { ...state, attempts: Array.isArray(state?.attempts) ? state.attempts : [] };
  } catch {
    return { attempts: [] };
  }
}

let expectedCache = null;

/**
 * 仓库规定的必需检查名（main 的分支保护 + 规则集，本进程内缓存）；分支保护查不到返回 null。
 * `pr checks --required` 只列已经登记出来的检查——还没开跑的必需检查不在里面，不能据此判「全绿」。
 */
async function expectedRequired(cfg) {
  if (expectedCache) return expectedCache;
  const protection = await ghJson(cfg, ['api', 'repos/{owner}/{repo}/branches/main/protection/required_status_checks', '--jq', '.contexts']);
  if (!Array.isArray(protection)) return null;
  const rules = await ghJson(cfg, ['api', 'repos/{owner}/{repo}/rules/branches/main', '--jq',
    '[.[] | select(.type == "required_status_checks") | .parameters.required_status_checks[].context]']);
  expectedCache = [...new Set([...protection, ...(Array.isArray(rules) ? rules : [])].map(String))];
  return expectedCache;
}

/** 必需检查的整体状态：{ state: 'none'|'pending'|'fail'|'pass', failed: [检查名] }。规定的必需检查没全部登记出来算 pending。 */
export async function requiredState(cfg, prNumber) {
  const rows = await ghJson(cfg, ['pr', 'checks', String(prNumber), '--required', '--json', 'name,bucket']);
  if (!Array.isArray(rows) || rows.length === 0) return { state: 'none', failed: [] };
  if (rows.some((r) => r.bucket === 'pending')) return { state: 'pending', failed: [] };
  const expected = await expectedRequired(cfg);
  if (!expected || expected.some((name) => !rows.some((r) => r.name === name))) return { state: 'pending', failed: [] };
  const failed = rows.filter((r) => r.bucket === 'fail').map((r) => r.name);
  return { state: failed.length > 0 ? 'fail' : 'pass', failed };
}

/** 必需检查：全部登记并出结果且有失败 → 失败名单；还有 pending/未登记、全通过或没有必需检查 → null。 */
async function failedRequired(cfg, prNumber) {
  const { state, failed } = await requiredState(cfg, prNumber);
  return state === 'fail' ? failed : null;
}

/** runner 自己开的、仍开着的 cw PR（按编号升序）；列表失败返回 null。 */
export async function listOwnPrs(cfg) {
  const prs = await ghJson(cfg, ['pr', 'list', '--state', 'open', '--limit', '100', '--json', 'number,headRefName,headRefOid,url,isDraft,mergeable']);
  if (!Array.isArray(prs)) return null;
  return prs.filter((p) => CW_BRANCH_RE.test(p.headRefName ?? '')).sort((a, b) => a.number - b.number);
}

const MAX_UPDATE_BRANCH = 3;
const MAX_CONFLICT_FIXES = 3;
const BASE_FRESH_CHECK = 'lint-base-fresh';
const RUN_LINK_RE = /\/actions\/runs\/(\d+)\//;

/** 失败的检查：[{ name, runId }]（runId 取自检查链接，取不到为 null）。 */
export async function failingChecks(cfg, prNumber) {
  const rows = await ghJson(cfg, ['pr', 'checks', String(prNumber), '--json', 'name,bucket,link']);
  return (Array.isArray(rows) ? rows : []).filter((r) => r.bucket === 'fail')
    .map((r) => ({ name: r.name, runId: RUN_LINK_RE.exec(r.link ?? '')?.[1] ?? null }));
}

/**
 * 必需检查全部出结果且有红的 PR 该怎么处理（修不动必须有出口，审计 #8/#5）：
 *   落后 main（lint-base-fresh 红）→ update_branch（程序做，不占修复次数；超过 3 次升级）
 *   修复次数用完 → escalate attempts_exhausted
 *   本 head 修过没改动（判定与本 PR 无关）→ 先 rerun 失败 job 一次；重跑过仍红 → escalate rerun_still_failing
 *   否则 → fix（派 claude）
 */
function decide(state, pr, checks, maxAttempts) {
  if (checks.some((c) => c.name === BASE_FRESH_CHECK)) {
    return (state.update_branch?.length ?? 0) >= MAX_UPDATE_BRANCH ? { action: 'escalate', reason: 'update_branch_exhausted' } : { action: 'update_branch' };
  }
  const ciAttempts = state.attempts.filter((a) => a.kind !== 'conflict');
  if (ciAttempts.length >= maxAttempts) return { action: 'escalate', reason: 'attempts_exhausted' };
  if (ciAttempts.some((a) => a.head === pr.headRefOid)) {
    return state.reruns?.[pr.headRefOid] ? { action: 'escalate', reason: 'rerun_still_failing' } : { action: 'rerun' };
  }
  return { action: 'fix' };
}

/**
 * 与 main 冲突的 PR（GitHub 不跑 pull_request CI，必需检查永远出不来，金丝雀 4 #6232）：
 * 本 head 合过没成 → escalate conflict_unresolved；冲突修复次数用完 → escalate conflict_exhausted；否则 → fix（kind=conflict）。
 * 冲突来自 main 前进，不占 CI 修复次数。
 */
function decideConflict(state, pr) {
  const tries = state.attempts.filter((a) => a.kind === 'conflict');
  if (tries.some((a) => a.head === pr.headRefOid)) return { action: 'escalate', reason: 'conflict_unresolved' };
  if (tries.length >= MAX_CONFLICT_FIXES) return { action: 'escalate', reason: 'conflict_exhausted' };
  return { action: 'fix', kind: 'conflict' };
}

/** 下一个要处理的 PR：{ pr, failedRequired, checks, action, reason? }，没有返回 null。已升级的 PR 不再处理。 */
export async function findTarget(cfg, log) {
  const ours = await listOwnPrs(cfg);
  if (!ours) {
    log('CI 修复：列 PR 失败，本轮跳过');
    return null;
  }
  for (const pr of ours) {
    const state = readState(cfg, pr.number);
    if (state.escalated) continue;
    if (pr.mergeable === 'CONFLICTING') return { pr, failedRequired: [], checks: [], ...decideConflict(state, pr) };
    const failed = await failedRequired(cfg, pr.number);
    if (!failed) continue;
    const checks = await failingChecks(cfg, pr.number);
    return { pr, failedRequired: failed, checks, ...decide(state, pr, checks, cfg.ciFixMaxAttempts) };
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
