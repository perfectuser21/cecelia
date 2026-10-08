#!/usr/bin/env node
// coding workflow runner：每次调用至多新跑一条开关任务（task_type=data + payload.headed_manual="true"
// + payload.coding_workflow===true）：保留期清理 → 对账（本机丢失的 in_progress、带本机痕迹的 queued）
// → 认领 → 建 worktree → 跑七活动 coding 链 → 回写 Brain。
// 退出码：0 = 无新任务 / 上一轮仍在跑 / 新任务完成；1 = 新任务失败或 runner 自身出错。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './lib/config.mjs';
import { acquireLock } from './lib/lock.mjs';
import { brainClient, EXECUTOR_KIND } from './lib/brain.mjs';
import { isSwitched, hasRunResult, pickCandidates, taskNames, runTimeoutMs } from './lib/plan.mjs';
import { prepareWorktree } from './lib/worktree.mjs';
import { cleanupRetention } from './lib/retention.mjs';
import { runExecutor } from './lib/executor.mjs';
import { readReceipt, summarizeReceipt } from './lib/receipt.mjs';
import { failTask, finishSuccess, localSummary, lostSummary, settle, settleQueued } from './lib/terminal.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW_REL = 'packages/brain/scripts/coding-workflow';
const EXECUTOR_REL = 'packages/brain/scripts/activity-contract-run.js';
const LOCK_EXTRA_MS = 60 * 60 * 1000;

const log = (...args) => console.error(`[${new Date().toISOString()}] [coding-workflow-runner]`, ...args);

function readContract(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error('contract_unreadable');
  }
}

/** 本机 runner 认领的 in_progress 任务：本进程已持锁 = 原执行者已不在，按本机痕迹收尾（无终态回执即 runner_lost）。 */
async function settleLost(ctx) {
  const rows = await ctx.brain.listTasks('in_progress');
  for (const task of rows.filter((t) => isSwitched(t) && t.claimed_by === ctx.cfg.claimer)) {
    const local = localSummary(ctx.cfg, task.id);
    const summary = local && local.reason_code !== 'runner_lost'
      ? local
      : lostSummary('runner 已不在（本机锁空闲）且没有终态回执');
    log(`对账本机丢失的 in_progress 任务 ${task.id}：${summary.reason_code ?? 'completed'}`);
    await settle(ctx, task, summary);
  }
}

/** queued 开关任务：挂着本机 claim 或本机有痕迹的先对账收尾；其余里挑最早的未跑过的新任务。 */
async function pickNew(ctx, queued) {
  const { cfg } = ctx;
  const traced = new Set();
  for (const task of queued.filter(isSwitched)) {
    const local = localSummary(cfg, task.id);
    if (local) traced.add(task.id);
    if (!local && task.claimed_by !== cfg.claimer) continue;
    log(`对账 queued 任务 ${task.id}（本机${local ? '有运行痕迹' : ' claim 残留'}），不重跑`);
    await settleQueued(ctx, task, local ?? lostSummary('任务挂着本机 claim 但本机没有运行痕迹'));
  }
  return pickCandidates(queued).filter((task) => {
    if (traced.has(task.id)) return false;
    if (hasRunResult(task)) {
      log(`任务 ${task.id} 已有运行结果（result.coding_workflow/runner/coding_workflow_runner），不认领`);
      return false;
    }
    return true;
  });
}

async function claimFirst(ctx, candidates) {
  if (candidates.length === 0) {
    log('没有可新跑的开关任务');
    return null;
  }
  for (const task of candidates) {
    const r = await ctx.brain.claim(task.id, ctx.cfg.claimer);
    if (r.ok) return { ...task, claimed_kind: r.body?.executor_kind ?? null };
    log(`认领 ${task.id} 失败（HTTP ${r.status}），换下一条`);
  }
  return null;
}

/** 建 worktree 并跑执行器；返回回执摘要。任一步失败抛 Error(reason_code)。 */
async function execute(cfg, task, job, signal) {
  const names = taskNames(task.id);
  const worktree = await prepareWorktree(cfg, task, names, job, signal);
  const contract = readContract(path.join(worktree, WORKFLOW_REL, 'contract.json'));
  const envelope = {
    contract,
    input: { run_tag: names.runTag, task_id: task.id, worktree, sprint_dir: names.sprintDir, brain_url: cfg.brainUrl },
  };
  log(`开跑 ${task.id}：worktree=${worktree} branch=${names.branch}`);
  const r = await runExecutor({
    executor: cfg.executor ?? path.join(worktree, EXECUTOR_REL),
    cwdDir: path.join(worktree, WORKFLOW_REL),
    worktree,
    envelope,
    receiptPath: job.receiptPath,
    logPath: path.join(cfg.logDir, `${task.id}.log`),
    timeoutMs: cfg.runTimeoutMs ?? runTimeoutMs(contract),
    killGraceMs: cfg.killGraceMs,
    signal,
  });
  if (r.aborted) throw new Error('runner_terminated');
  if (r.timedOut) throw new Error('executor_timeout');
  const receipt = readReceipt(r.stdout, job.receiptPath);
  if (!receipt) throw new Error('executor_crashed');
  return summarizeReceipt(receipt);
}

export async function runOnce(cfg, signal) {
  await cleanupRetention(cfg).catch((error) => log(`保留期清理失败：${error.message}`));
  const ctx = { cfg, brain: brainClient(cfg.brainUrl, { listLimit: cfg.listLimit, log }), log };
  let task;
  try {
    await settleLost(ctx);
    task = await claimFirst(ctx, await pickNew(ctx, await ctx.brain.listTasks('queued')));
  } catch (error) {
    log(`查询/对账/认领失败：${error.message}`);
    return 1;
  }
  if (!task) return 0;

  const started = await ctx.brain.patch(task.id, { status: 'in_progress' });
  if (!started.ok) {
    log(`已认领 ${task.id} 但置 in_progress 失败（HTTP ${started.status}），不开跑`);
    return 1;
  }

  const startedAt = Date.now();
  const job = { worktree: null, branch: null, receiptPath: path.join(cfg.logDir, `${task.id}.json`) };
  // Brain 没把 kind 记成 coding-workflow-runner（旧端点保留历史残留）：重启会被当本机执行体打回重跑，不跑链
  if (task.claimed_kind !== EXECUTOR_KIND) {
    const detail = `认领响应 executor_kind=${task.claimed_kind ?? '空'}，不是 ${EXECUTOR_KIND}`;
    log(`任务 ${task.id} ${detail}，不跑链`);
    return failTask(ctx, task, job, { status: 'failed', failed_activity: null, reason_code: 'executor_kind_mismatch', pr_url: null, detail });
  }
  let summary;
  try {
    summary = await execute(cfg, task, job, signal);
  } catch (error) {
    summary = { status: 'failed', failed_activity: null, reason_code: error?.message || 'runner_error', pr_url: null };
  }
  try {
    if (summary.status === 'completed' && !summary.reason_code) {
      return await finishSuccess(ctx, task, job, summary, { duration_s: Math.round((Date.now() - startedAt) / 1000) });
    }
    return await failTask(ctx, task, job, summary);
  } catch (error) {
    // 收尾本身出错也要尽力回写，不留 in_progress 孤儿
    log(`收尾异常：${error?.stack || error}`);
    return failTask(ctx, task, job, { ...summary, reason_code: 'runner_finalize_error' });
  }
}

/** 最长持锁 = 总超时 + 1 小时；超过即视为陈旧（防 pid 复用让死锁永不释放）。 */
function maxHoldMs(cfg) {
  let total = cfg.runTimeoutMs;
  if (!total) {
    try {
      total = runTimeoutMs(readContract(path.join(HERE, '../contract.json')));
    } catch {
      total = runTimeoutMs({});
    }
  }
  return total + LOCK_EXTRA_MS;
}

export async function main(env = process.env) {
  const cfg = loadConfig(env);
  let lock;
  try {
    lock = acquireLock(cfg.lockDir, { maxHoldMs: maxHoldMs(cfg) });
  } catch (error) {
    log(`取锁失败：${error.message}`);
    return 1;
  }
  if (!lock) {
    log('上一轮仍在运行，本轮退出');
    return 0;
  }
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  try {
    return await runOnce(cfg, abort.signal);
  } finally {
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
    lock.release();
  }
}

let directEntry = false;
try {
  directEntry = Boolean(process.argv[1])
    && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
} catch { /* 被 import 时不启动 */ }
if (directEntry) {
  main().then((code) => { process.exitCode = code; }, (error) => {
    log(`未捕获异常：${error?.stack || error}`);
    process.exitCode = 1;
  });
}
