// 收尾：写终态（遇 409 对账）、成功后 automerge、失败保留现场；以及按本机痕迹对账的收尾。
import fs from 'node:fs';
import path from 'node:path';
import { run } from './proc.mjs';
import { removeWorktree } from './worktree.mjs';
import { readReceipt, summarizeReceipt } from './receipt.mjs';

const GH_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * PATCH 终态。409 时 GET 任务对账：Brain 重启会把 in_progress 打回 queued（保留或清掉 claim），
 * queued→completed/failed 非法——若仍是本机的（claim 是自己或已被清）则重新认领、置 in_progress 再写终态；
 * 已被别人认领或状态已变则不覆盖，返回 { ok:false, foreign:true }。
 */
export async function writeTerminal(ctx, taskId, body) {
  const { cfg, brain, log } = ctx;
  const first = await brain.patch(taskId, body);
  if (first.ok || first.status !== 409) return first;
  const got = await brain.getTask(taskId);
  const task = got.ok ? got.body : null;
  const mine = task?.status === 'queued' && (!task.claimed_by || task.claimed_by === cfg.claimer);
  if (!mine) {
    log(`任务 ${taskId} 终态回写 409：当前 status=${task?.status ?? '?'} claimed_by=${task?.claimed_by ?? '-'}，不覆盖`);
    return { ...first, ok: false, foreign: true };
  }
  if (!task.claimed_by) {
    const claimed = await brain.claim(taskId, cfg.claimer);
    if (!claimed.ok) {
      log(`任务 ${taskId} 收尾重新认领失败（HTTP ${claimed.status}），不覆盖`);
      return { ...claimed, ok: false, foreign: true };
    }
  }
  const started = await brain.patch(taskId, { status: 'in_progress' });
  if (!started.ok) return started;
  log(`任务 ${taskId} 已被打回 queued，重新置 in_progress 后写终态`);
  return brain.patch(taskId, body);
}

/** 回写 failed；保留 worktree 供排查。summary 有 pr_url / detail 时一并写入。 */
export async function failTask(ctx, task, job, summary) {
  const { cfg, log } = ctx;
  const info = {
    status: summary.status,
    failed_activity: summary.failed_activity,
    reason_code: summary.reason_code,
    receipt_path: job.receiptPath,
    host: cfg.host,
    ...(summary.pr_url ? { pr_url: summary.pr_url } : {}),
    ...(summary.detail ? { detail: summary.detail } : {}),
  };
  const r = await writeTerminal(ctx, task.id, { status: 'failed', result: { coding_workflow_runner: info } });
  if (!r.ok && !r.foreign) log(`回写 failed 失败（HTTP ${r.status}），任务 ${task.id} 需人工收账`);
  log(`任务 ${task.id} 失败：${summary.failed_activity ?? '-'} / ${summary.reason_code}；现场 ${job.worktree ?? '无'}`);
  return 1;
}

/**
 * gh pr ready；合并一律由合并门在真人 QA + 独立裁判通过后按批准的 head 执行（lib/merge-gate.mjs）。
 * QA 门关闭时不靠 CI 绿自动合并（审计 #32，对应旧 harness「judge 是合并唯一权威」）：只 ready，P1 交人审。
 */
async function automerge(ctx, prUrl, cwd) {
  const { cfg, log } = ctx;
  const ready = await run(cfg.ghBin, ['pr', 'ready', prUrl], { cwd, timeoutMs: GH_TIMEOUT_MS });
  if (cfg.qaGate) return { ready: ready.code === 0, merge: 'awaiting_qa' };
  log(`[coding-qa][P1] QA 门关闭（CODING_WF_QA_GATE=0）：${prUrl} 只 ready 不合并，需人审`);
  return { ready: ready.code === 0, merge: 'qa_gate_off' };
}

/**
 * 成功收尾：先 PATCH completed（只补 result.runner）；成功后才 automerge，结果用只带 result 的 PATCH 补写，
 * 再删 worktree。completed 被别人接管 → 不覆盖、不 automerge；其他拒绝 → 改写 failed（complete_rejected）。
 */
export async function finishSuccess(ctx, task, job, summary, extra = {}) {
  const { cfg, brain, log } = ctx;
  // 开出 PR 不等于完成：phase 标明还在等 QA/人审，合并结果由合并门回写 result.merge（审计 #7）
  const runner = { receipt_path: job.receiptPath, host: cfg.host, phase: cfg.qaGate ? 'awaiting_qa' : 'awaiting_manual_merge', ...extra };
  const r = await writeTerminal(ctx, task.id, { status: 'completed', result: { runner } });
  if (r.foreign) return 1;
  if (!r.ok) {
    log(`Brain 拒绝 completed（HTTP ${r.status}）`);
    return failTask(ctx, task, job, { ...summary, reason_code: 'complete_rejected' });
  }
  if (cfg.automerge) {
    const merged = await automerge(ctx, summary.pr_url, job.worktree ?? undefined);
    const patched = await brain.patch(task.id, { result: { runner: { ...runner, automerge: merged } } });
    if (!patched.ok) log(`补写 automerge 结果失败（HTTP ${patched.status}）`);
  }
  if (job.worktree && !(await removeWorktree(cfg, job.worktree, job.branch))) {
    log(`删除 worktree ${job.worktree} 失败，留待保留期清理`);
  }
  log(`任务 ${task.id} 完成：${summary.pr_url}`);
  return 0;
}

/** 本机运行痕迹：有终态回执 → 其摘要；只有回执进度/日志 → runner_lost；无痕迹 → null。 */
export function localSummary(cfg, taskId) {
  const receiptPath = path.join(cfg.logDir, `${taskId}.json`);
  const receipt = readReceipt('', receiptPath);
  if (receipt) return summarizeReceipt(receipt);
  if (fs.existsSync(receiptPath) || fs.existsSync(path.join(cfg.logDir, `${taskId}.log`))) {
    return lostSummary('本机有运行日志但没有终态回执：runner 中途丢失');
  }
  return null;
}

export function lostSummary(detail) {
  return { status: 'failed', failed_activity: null, reason_code: 'runner_lost', pr_url: null, detail };
}

/** 按摘要对账收尾（不重跑）。已 in_progress 的直接写终态。 */
export function settle(ctx, task, summary) {
  const job = { worktree: null, branch: null, receiptPath: path.join(ctx.cfg.logDir, `${task.id}.json`) };
  if (summary.status === 'completed' && !summary.reason_code) {
    return finishSuccess(ctx, task, job, summary, { reconciled: true });
  }
  return failTask(ctx, task, job, summary);
}

/** 对账 queued 任务（本机有痕迹，或仍挂着本机 claim）：必要时认领 → in_progress → 终态。 */
export async function settleQueued(ctx, task, summary) {
  const { cfg, brain, log } = ctx;
  if (task.claimed_by && task.claimed_by !== cfg.claimer) return;
  if (!task.claimed_by) {
    const claimed = await brain.claim(task.id, cfg.claimer);
    if (!claimed.ok) {
      log(`对账认领 ${task.id} 失败（HTTP ${claimed.status}），跳过`);
      return;
    }
  }
  const started = await brain.patch(task.id, { status: 'in_progress' });
  if (!started.ok) {
    log(`对账置 in_progress 失败（HTTP ${started.status}），跳过 ${task.id}`);
    return;
  }
  await settle(ctx, task, summary);
}
