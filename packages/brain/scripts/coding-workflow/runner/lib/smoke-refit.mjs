// QA 回归 smoke 的 CI 首跑兜底（C2c）：runner 固化的 cw-*-qa-smoke.sh 在 PR 的 Smoke Glob Runner 里红了——预览库是生产克隆、
// CI 是空库，依赖已有数据的命令预览能过、CI 会红。修复会话无权改这个脚本（pr-branch.mjs PROTECTED_RE），派它只会撞
// protected_path 升级。改由 runner 自己处理：从 CI 日志 `FAIL: T-n` 定位失败条目，剔除后重新固化并推送，每个 PR 最多一次，
// smoke_note 留痕、批准改绑到新 head（只动了 runner 自己的 smoke，不重跑 QA）。剔除后零固化且 PR 改了 API 面 → 撤销批准，
// 升级 qa_smoke_missing 交 commander（决策 4fe863c3，同 C2b 口径）。已剔过一次仍红 / 定位不到 / 剔除失败 → 交 cifix 升级。
import fs from 'node:fs';
import path from 'node:path';
import { git } from './proc.mjs';
import { removeWorktree } from './worktree.mjs';
import { checkLog } from './cifix-scan.mjs';
import { intentOf, preparePrWorktree, pushPrHead, headOf } from './pr-branch.mjs';
import { readState, writeState, escalate, report, prTouchesApi } from './qa-gate.mjs';
import { smokeCiFailures, dropSmokeBlocks, unregisterSmoke } from '../../lib/qa-smoke.mjs';
import { gateSpan, postSpans } from './spans.mjs';

const SMOKE_JOB = 'Smoke Glob Runner';
const RUNNER_ID = ['-c', 'user.name=coding-workflow-runner', '-c', 'user.email=coding-workflow-runner@cecelia.local'];

/**
 * 本 PR 的 QA smoke 是否在 CI 红、该怎么办：null = 不归这里管（没有 runner 固化的 smoke / Smoke Glob Runner 没红 / 红的是别的脚本）；
 * { action: 'refit', ids, file } = 剔除重固化；{ action: 'escalate', reason } = 已剔过一次仍红 / 定位不到失败条目。
 */
export async function smokeRefitDecision(cfg, target) {
  const job = target.checks?.find((c) => c.name === SMOKE_JOB);
  if (!job) return null;
  const qa = readState(cfg, target.pr.number);
  if (!qa.smoke?.file) return null;
  const log = await checkLog(cfg, job);
  const { failed, ids } = smokeCiFailures(log, path.basename(qa.smoke.file));
  if (!failed) return null;
  if (qa.smoke_refit) return { action: 'escalate', reason: 'qa_smoke_refit_exhausted' };
  if (ids.length === 0) return { action: 'escalate', reason: 'qa_smoke_fail_unlocated' };
  return { action: 'refit', ids, file: qa.smoke.file };
}

/** 在 PR worktree 里剔除失败条目、提交、推送；→ { removed, items, to }。失败抛 Error(reason_code)。 */
async function rewrite(cfg, pr, worktree, d, signal) {
  await preparePrWorktree(cfg, pr, worktree, signal);
  if ((await headOf(worktree)) !== pr.headRefOid) throw new Error('head_moved');
  const abs = path.join(worktree, d.file);
  const dropped = dropSmokeBlocks(fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '', d.ids);
  if (dropped.removed.length === 0) throw new Error('qa_smoke_fail_unlocated');
  const name = path.basename(d.file);
  let changed = [d.file];
  if (dropped.items.length > 0) fs.writeFileSync(abs, dropped.content);
  else changed = unregisterSmoke(worktree, name);
  if ((await git(worktree, ['add', '-A', '--', ...changed])).code !== 0) throw new Error('smoke_refit_add_failed');
  const message = `test(smoke): CI 首跑失败剔除 ${dropped.removed.join(',')}，${dropped.items.length ? `重新固化 ${name}` : `撤下 ${name}`}`;
  if ((await git(worktree, [...RUNNER_ID, 'commit', '-q', '-m', message])).code !== 0) throw new Error('smoke_refit_commit_failed');
  await pushPrHead(cfg, worktree, pr);
  return { removed: dropped.removed, items: dropped.items, to: await headOf(worktree) };
}

/** 剔除重固化一次。返回 null（处理完，含 PR 已关/head 已变）或 { escalate: reason }（交 cifix 升级 ci_fix_exhausted）。不抛错。 */
export async function refitSmoke(ctx, target, d, signal) {
  const { cfg } = ctx;
  const { pr } = target;
  const worktree = path.join(cfg.worktreeBase, `smoke-refit-${pr.number}`);
  fs.mkdirSync(cfg.worktreeBase, { recursive: true });
  if (fs.existsSync(worktree)) await removeWorktree(cfg, worktree, null);
  fs.rmSync(worktree, { recursive: true, force: true });
  const startedAt = Date.now();
  try {
    const r = await rewrite(cfg, pr, worktree, d, signal);
    const taskId = intentOf(worktree, pr.headRefName)?.taskId ?? null;
    const at = new Date().toISOString();
    const s = readState(cfg, pr.number);
    const skipped = r.removed.map((id) => ({ id, reason: 'ci_failed' }));
    s.smoke_refit = { from: pr.headRefOid, to: r.to, removed: r.removed, items: r.items, at };
    const why = `；CI 首跑 Smoke Glob Runner 失败，剔除 ${skipped.map((x) => `${x.id}(${x.reason})`).join(',')}`;
    if (r.items.length > 0) {
      s.smoke = { ...s.smoke, items: r.items, refit_at: at };
      s.smoke_note = `${s.smoke_note ?? ''}${why}，重新固化 ${d.file}（${r.items.join(',')}）`;
    } else {
      s.smoke = null;
      s.smoke_note = `${s.smoke_note ?? ''}${why}，剔除后本任务无回归 smoke`;
    }
    ctx.log(`CI 修复 PR #${pr.number}：QA 回归 smoke CI 首跑失败，剔除 ${r.removed.join(',')}${r.items.length ? ` 重新固化（${r.items.join(',')}）` : '，剔光撤下'}`);
    await postSpans(ctx, [taskId && gateSpan({
      taskId, key: 'ci_fix', startedAt, endedAt: Date.now(), ok: true,
      occurrence: `${pr.number}:smoke_refit`, evidence: { result: 'smoke_refit', removed: r.removed, items: r.items },
    })]);
    if (r.items.length === 0 && await prTouchesApi(worktree)) {
      s.passed = false;
      s.smoke_missing = true;
      s.smoke_gap = { round: s.rounds.at(-1)?.round ?? null, api_items: r.removed, skipped };
      await escalate(ctx, pr, s, taskId, { type: 'qa_smoke_missing', ...s.smoke_gap });
      return null;
    }
    // 只动了 runner 自己的 smoke：已批准的改绑到新 head（不撤销、不重跑 QA）
    if (s.passed && s.approved?.head === pr.headRefOid) s.approved = { ...s.approved, head: r.to, rebound_from: pr.headRefOid };
    writeState(cfg, pr.number, s);
    await report(ctx, taskId, s);
    return null;
  } catch (error) {
    const reason = error?.message || 'smoke_refit_error';
    if (reason === 'pr_closed' || reason === 'head_moved') {
      ctx.log(`CI 修复 PR #${pr.number}：QA 回归 smoke 剔除跳过（${reason === 'pr_closed' ? 'PR 已关闭，交给关闭收尾' : 'head 已变，下轮按新 head 再看'}）`);
      return null;
    }
    ctx.log(`CI 修复 PR #${pr.number}：QA 回归 smoke 剔除重固化失败：${reason}`);
    return { escalate: reason === 'qa_smoke_fail_unlocated' ? reason : `qa_smoke_refit_failed:${reason}` };
  } finally {
    await removeWorktree(cfg, worktree, pr.headRefName);
    fs.rmSync(worktree, { recursive: true, force: true });
  }
}
