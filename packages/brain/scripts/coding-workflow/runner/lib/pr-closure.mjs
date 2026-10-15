// 外部关闭（未合并）的 cw PR 收尾（金丝雀 5：PR #6220 被人关掉后 runner 两天毫无反应——各道门只看 open 列表）。
// 每轮在各道门之前：
//   关闭未合并 → Brain 只写 result（completed 是终态，status 不动）：runner.phase='closed_unmerged'、merge.closed=true、
//     终态交接单（verdict=CLOSED、无下一步）、commander 待人处理的标 resolved=pr_closed；上报终态 span
//     （merge，outcome=fail，reason=pr_closed_externally，run_terminal）；本机 qa-<pr>.json 记 closed（Brain 写成功才记，失败下轮重试）。
//   重开（又出现在 open 列表且本机记过 closed）→ 清 closed / preview_stopped，Brain phase 回 awaiting_qa、merge 置空、记 reopened，各门照常接管。
//   已结束的 PR 停预览释放容量（只停一次）：合并的要求 QA 通过过；外部关闭的不论 QA 结果一律停。
// 修复会话中途被关的 PR 由 pushPrHead 推送前拦下（pr_closed），留给这里收尾。
import fs from 'node:fs';
import { ghJson, CW_BRANCH_RE } from './cifix-scan.mjs';
import { readState, writeState, previewCall, usesBrainPreview } from './qa-gate.mjs';
import { syncTaskId, syncTask, rememberPr } from './pr-sync.mjs';
import { hasUnmirroredStates, restoreStates } from './state-store.mjs';
import { finalHandoff } from './merge-gate.mjs';
import { gateSpan, postSpans } from './spans.mjs';
import { prFile } from './repos.mjs';

const CLOSED_PHASE = 'closed_unmerged';
const REASON = 'pr_closed_externally';

/** 外部关闭（未合并）的 cw PR；列表失败返回 null。 */
async function listClosedUnmerged(cfg) {
  const prs = await ghJson(cfg, ['pr', 'list', '--state', 'closed', '--search', 'is:unmerged', '--limit', '100',
    '--json', 'number,headRefName,headRefOid,url,state,closedAt']);
  if (!Array.isArray(prs)) return null;
  return prs.filter((p) => p.state === 'CLOSED' && CW_BRANCH_RE.test(p.headRefName ?? ''));
}

/** 最后一次 closed 事件的操作人；取不到返回 null。 */
async function closedBy(cfg, number) {
  const events = await ghJson(cfg, ['api', `repos/{owner}/{repo}/issues/${number}/events?per_page=100`]);
  if (!Array.isArray(events)) return null;
  return events.filter((e) => e?.event === 'closed').at(-1)?.actor?.login ?? null;
}

function commanderHuman(cfg, number) {
  try {
    return JSON.parse(fs.readFileSync(prFile(cfg, `commander-${number}.json`), 'utf8'))?.human ?? null;
  } catch {
    return null;
  }
}

/** 关闭时的 QA 状态（写进交接单 not_done）。 */
function qaAtClose(s) {
  if (s.passed) return `关闭时已通过AI QA + 独立裁判（第 ${s.approved?.round ?? '?'} 轮），未合并`;
  return `关闭时 QA 未通过（已验 ${s.rounds.length} 轮${s.escalated ? `，升级 ${s.escalated.type} 未解除` : ''}）`;
}

async function settleOne(ctx, pr) {
  const { cfg } = ctx;
  const current = readState(cfg, pr.number);
  if (!current.closed || hasUnmirroredStates(cfg, pr.number)) rememberPr(ctx, { ...pr, state: 'CLOSED' });
  if (current.closed) return;
  await restoreStates(ctx, [pr]);
  if (readState(cfg, pr.number).closed) return;
  const mark = (extra) => writeState(cfg, pr.number, { ...readState(cfg, pr.number), closed: { at: pr.closedAt ?? null, head: pr.headRefOid, ...extra } });
  const taskId = await syncTaskId(ctx, pr);
  if (!taskId) {
    ctx.log(`[coding-closure] PR #${pr.number} 已被外部关闭，但分支与 refs/pull 上都读不到 task_id，保留待办下轮重试`);
    return;
  }
  const task = await syncTask(ctx, taskId, pr);
  const prior = task.result ?? {};
  // 换机 / 本机记录丢失：Brain 已收过尾，只补本机标记
  if (prior.runner?.phase === CLOSED_PHASE) {
    mark({ by: prior.merge?.closed_by ?? null, task_id: taskId });
    return;
  }
  const by = await closedBy(cfg, pr.number);
  const human = commanderHuman(cfg, pr.number);
  const r = await ctx.brain.patch(taskId, { result: {
    runner: { ...prior.runner, phase: CLOSED_PHASE, closed_reason: REASON },
    merge: { merged: false, closed: true, closed_at: pr.closedAt ?? null, head: pr.headRefOid, closed_by: by },
    handoff: finalHandoff(taskId, pr, prior, {
      verdict: 'CLOSED',
      done: [`PR #${pr.number} 被 ${by ?? '未知'} 于 ${pr.closedAt ?? '未知时间'} 关闭未合并`],
      notDone: [qaAtClose(readState(cfg, pr.number))],
    }),
    // 已上交主理人的：随关闭一并了结，不再等人
    ...(human ? { commander_human: { ...human, resolved: 'pr_closed' } } : {}),
  } });
  if (!r.ok) {
    ctx.log(`[coding-closure] PR #${pr.number} 外部关闭回写 Brain 任务 ${taskId} 失败（HTTP ${r.status}），下轮重试`);
    return;
  }
  // 终态 span（迁移 546：runs 结果以 run_terminal 为准）；时间取关闭时刻
  const at = Date.parse(pr.closedAt ?? '') || Date.now();
  await postSpans(ctx, [gateSpan({
    taskId, key: 'merge', startedAt: at, endedAt: at, ok: false, terminal: true, occurrence: `${pr.number}:closed`,
    evidence: { reason: REASON, closed_at: pr.closedAt ?? null, closed_by: by, head: pr.headRefOid },
  })]);
  mark({ by, task_id: taskId });
  ctx.log(`[coding-closure] PR #${pr.number} 被 ${by ?? '未知'} 关闭未合并：任务 ${taskId} 记 ${CLOSED_PHASE}`);
}

/** 重开：清本机 closed / preview_stopped，Brain phase 回 awaiting_qa、merge 置空、记 reopened。Brain 写失败下轮重试。 */
async function reopen(ctx, pr, s) {
  const { cfg } = ctx;
  const taskId = await syncTaskId(ctx, pr);
  const entry = { at: new Date().toISOString(), closed_at: s.closed.at ?? null };
  if (!taskId) return;
  if (taskId) {
    const task = await syncTask(ctx, taskId, pr);
    const { closed_reason: _reason, ...runner } = task.result?.runner ?? {};
    const r = await ctx.brain.patch(taskId, { result: {
      runner: { ...runner, phase: 'awaiting_qa', reopened: [...(Array.isArray(runner.reopened) ? runner.reopened : []), entry] },
      merge: null,
    } });
    if (!r.ok) {
      ctx.log(`[coding-closure] PR #${pr.number} 重开回写 Brain 任务 ${taskId} 失败（HTTP ${r.status}），下轮重试`);
      return;
    }
  }
  const { closed: _closed, preview_stopped: _stopped, ...rest } = s;
  writeState(cfg, pr.number, { ...rest, reopened: [...(Array.isArray(s.reopened) ? s.reopened : []), entry] });
  ctx.log(`[coding-closure] PR #${pr.number} 已重开：恢复 awaiting_qa，各门照常接管`);
}

/** 已结束的 PR 停预览释放容量（只停一次）：合并的要求 QA 通过过；外部关闭的一律停。 */
async function stopFinishedPreviews(ctx, closed) {
  const merged = await ghJson(ctx.cfg, ['pr', 'list', '--state', 'merged', '--limit', '30', '--json', 'number,headRefName,headRefOid,url,mergedAt']);
  const listed = [
    ...(Array.isArray(merged) ? merged : []).filter((p) => CW_BRANCH_RE.test(p.headRefName ?? '')).map((p) => ({ ...p, merged: true })),
    ...closed.map((p) => ({ ...p, merged: false })),
  ];
  const done = new Map(listed.map((p) => [p.number, p]));
  for (const [number, pr] of ctx.syncPrs ?? []) {
    if (pr.state === 'OPEN') done.delete(number);
    else if (['MERGED', 'CLOSED'].includes(pr.state)) done.set(number, { ...pr, merged: pr.state === 'MERGED' });
  }
  for (const pr of done.values()) {
    const s = readState(ctx.cfg, pr.number);
    if (pr.merged && !s.passed) continue;
    if (!s.preview_stopped || hasUnmirroredStates(ctx.cfg, pr.number)) rememberPr(ctx, { ...pr, state: pr.merged ? 'MERGED' : 'CLOSED' });
    if (s.preview_stopped) continue;
    const r = await previewCall(ctx.cfg, `stop/${pr.number}`);
    ctx.log(`停 PR #${pr.number} 预览环境（${pr.merged ? '已合并' : '外部关闭'}）：HTTP ${r.status}`);
    if (r.ok) writeState(ctx.cfg, pr.number, { ...readState(ctx.cfg, pr.number), preview_stopped: true });
  }
}

/** 外部关闭收尾 + 重开恢复 + 停预览。openPrs = 本轮 open 列表（取不到为 null）。不抛错，也不算「本轮做了事」。 */
export async function settleClosedPrs(ctx, openPrs) {
  const warn = (what) => (error) => ctx.log(`[coding-closure] ${what}出错：${error?.message || error}`);
  const listed = await listClosedUnmerged(ctx.cfg).catch(warn('列外部关闭的 PR ')) ?? [];
  const candidates = new Map(listed.map((p) => [p.number, p]));
  for (const [number, pr] of ctx.syncPrs ?? []) {
    if (pr.state === 'CLOSED') candidates.set(number, pr);
    else candidates.delete(number);
  }
  const closed = [...candidates.values()];
  for (const pr of closed) await settleOne(ctx, pr).catch(warn(`PR #${pr.number} 收尾`));
  const opened = new Map((openPrs ?? []).map((p) => [p.number, p]));
  for (const [number, pr] of ctx.syncPrs ?? []) if (pr.state === 'OPEN') opened.set(number, pr);
  for (const pr of opened.values()) {
    const s = readState(ctx.cfg, pr.number);
    if (s.closed) await reopen(ctx, pr, s).catch(warn(`PR #${pr.number} 重开恢复`));
  }
  if (ctx.cfg.qaGate && usesBrainPreview(ctx.cfg)) await stopFinishedPreviews(ctx, closed).catch(warn('停预览'));
}
