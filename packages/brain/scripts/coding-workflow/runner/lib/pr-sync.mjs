// 活跃 PR 与尚未确认的终态收尾身份。按仓库隔离；不是历史 PR 扫描器，也不授予合并权限。
import fs from 'node:fs';
import { prFile, stateDir, normalizeRepoName } from './repos.mjs';
import { ghJson, CW_BRANCH_RE } from './cifix-scan.mjs';
import { remoteTaskId, remoteTaskIdByPr } from './pr-branch.mjs';

const FILE = 'pr-sync-pending.json';
const LOOKUP_LIMIT = 30;
const fields = ['number', 'headRefName', 'headRefOid', 'url', 'state', 'closedAt', 'mergedAt'];
const scope = (cfg) => cfg.repoSlug ?? cfg.repoKey ?? 'cecelia';
export const validSyncPr = (pr) => Number.isSafeInteger(pr?.number) && pr.number > 0 && CW_BRANCH_RE.test(pr.headRefName ?? '');
const validTask = (id, pr) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) && id.slice(0, 8) === pr.headRefName.slice(-8);

function read(cfg) {
  const file = prFile(cfg, FILE);
  if (!fs.existsSync(file)) return {};
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (data.repo !== scope(cfg) || !data.entries || typeof data.entries !== 'object') throw new Error('pr_sync_scope_invalid');
  return data.entries;
}
function write(cfg, entries) {
  fs.mkdirSync(stateDir(cfg), { recursive: true });
  const file = prFile(cfg, FILE);
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify({ repo: scope(cfg), entries }, null, 2)}\n`);
  fs.renameSync(`${file}.tmp`, file);
}
export function syncEntry(cfg, pr) {
  const e = read(cfg)[pr.number];
  return e?.pr?.headRefName === pr.headRefName ? e : null;
}

/** 只接 GitHub 本轮查询得到的身份 / 已成功执行 merge 的 PR，未知字段不进入身份账。 */
export function rememberPr(ctx, pr, extra = {}) {
  if (!validSyncPr(pr)) return;
  const entries = read(ctx.cfg);
  const old = entries[pr.number];
  if (old && old.pr.headRefName !== pr.headRefName) throw new Error('pr_sync_identity_changed');
  const identity = Object.fromEntries(fields.filter((f) => pr[f] !== undefined).map((f) => [f, pr[f]]));
  const reopened = pr.state === 'OPEN' && old?.pr.state && old.pr.state !== 'OPEN';
  entries[pr.number] = { ...(reopened ? { task_id: old.task_id } : old), ...extra, pr: { ...old?.pr, ...identity } };
  write(ctx.cfg, entries);
  (ctx.syncPrs ??= new Map()).set(pr.number, entries[pr.number].pr);
}

export function updateSync(ctx, pr, extra) {
  const entries = read(ctx.cfg);
  const old = entries[pr.number];
  if (!old || old.pr.headRefName !== pr.headRefName) return;
  entries[pr.number] = { ...old, ...extra };
  write(ctx.cfg, entries);
}
export function forgetSyncedPr(ctx, pr) {
  const entries = read(ctx.cfg);
  delete entries[pr.number];
  write(ctx.cfg, entries);
}

/** 已退出 open 列表的待办逐项核实真实状态，每轮至多 30 项、按上次核验时间轮转；失败保留待办。 */
export async function prepareStateSync(ctx, prs) {
  ctx.syncPrs = new Map();
  for (const pr of prs ?? []) rememberPr(ctx, { ...pr, state: 'OPEN' });
  const open = new Set((prs ?? []).map((p) => p.number));
  const pending = Object.values(read(ctx.cfg)).filter((e) => validSyncPr(e.pr) && !open.has(e.pr.number))
    .sort((a, b) => (a.checked_at ?? 0) - (b.checked_at ?? 0)).slice(0, LOOKUP_LIMIT);
  for (const e of pending) {
    updateSync(ctx, e.pr, { checked_at: Date.now() });
    const pr = await ghJson(ctx.cfg, ['pr', 'view', String(e.pr.number), '--json', fields.join(',')]);
    if (!validSyncPr(pr) || pr.number !== e.pr.number || pr.headRefName !== e.pr.headRefName || !['OPEN', 'CLOSED', 'MERGED'].includes(pr.state)) continue;
    rememberPr(ctx, pr);
  }
}

/** task 来源只能是已核过的 sprint branch/ref 关联；UUID 前缀必须与 CW branch 一致。 */
export async function syncTaskId(ctx, pr) {
  if (!validSyncPr(pr)) return null;
  const entry = syncEntry(ctx.cfg, pr);
  if (entry?.task_source && validTask(entry.task_id, pr)) return entry.task_id;
  for (const [source, resolve] of [
    ['branch', () => remoteTaskId(ctx.cfg, pr.headRefName)],
    ['refs/pull', () => remoteTaskIdByPr(ctx.cfg, pr.number, pr.headRefName)],
  ]) {
    const id = await resolve();
    if (!validTask(id, pr)) continue;
    updateSync(ctx, pr, { task_id: id, task_source: source });
    return id;
  }
  return null;
}

export async function syncTask(ctx, taskId, pr) {
  const task = await ctx.brain.getTask(taskId);
  if (!task.ok || task.body?.id !== taskId) throw new Error(`brain_task_read_failed:${task.status ?? 'identity'}`);
  if (pr) {
    const repo = task.body.payload?.repo;
    const known = [ctx.cfg.repoKey, ctx.cfg.repoSlug, ctx.cfg.repoProfile?.origin, ...(ctx.cfg.repoProfile?.aliases ?? [])].filter(Boolean).map(normalizeRepoName);
    if (repo && !known.includes(normalizeRepoName(repo))) throw new Error('brain_task_repo_mismatch');
    for (const url of [task.body.result?.pr_url, task.body.result?.coding_workflow?.pr_url]) {
      if (url && String(url).replace(/\/$/, '') !== String(pr.url).replace(/\/$/, '')) throw new Error('brain_task_pr_mismatch');
    }
  }
  return task.body;
}
