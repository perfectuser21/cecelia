#!/usr/bin/env node
// coding workflow runner：每次调用至多处理一条带开关的 Brain 任务
// （payload.coding_workflow === true）：认领 → 建 worktree → 跑七活动 coding 链 → 回写 Brain。
// 退出码：0 = 无任务 / 上一轮仍在跑 / 任务完成；1 = 任务失败或 runner 自身出错。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './lib/config.mjs';
import { acquireLock } from './lib/lock.mjs';
import { brainClient } from './lib/brain.mjs';
import { pickCandidates, taskNames, runTimeoutMs } from './lib/plan.mjs';
import { prepareWorktree, removeWorktree, pruneWorktrees } from './lib/worktree.mjs';
import { runExecutor } from './lib/executor.mjs';
import { readReceipt, summarizeReceipt } from './lib/receipt.mjs';
import { run } from './lib/proc.mjs';

const WORKFLOW_REL = 'packages/brain/scripts/coding-workflow';
const EXECUTOR_REL = 'packages/brain/scripts/activity-contract-run.js';
const GH_TIMEOUT_MS = 2 * 60 * 1000;

const log = (...args) => console.error(`[${new Date().toISOString()}] [coding-workflow-runner]`, ...args);

/** 列 queued → 筛候选 → 依次认领，409 等失败换下一条。返回认领到的任务或 null。 */
async function findAndClaim(cfg, brain) {
  const candidates = pickCandidates(await brain.listQueued());
  if (candidates.length === 0) {
    log('没有带开关的 queued 任务');
    return null;
  }
  for (const task of candidates) {
    const r = await brain.claim(task.id, cfg.claimer);
    if (r.ok) return task;
    log(`认领 ${task.id} 失败（HTTP ${r.status}），换下一条`);
  }
  return null;
}

function readContract(worktree) {
  try {
    return JSON.parse(fs.readFileSync(path.join(worktree, WORKFLOW_REL, 'contract.json'), 'utf8'));
  } catch {
    throw new Error('contract_unreadable');
  }
}

/** 建 worktree 并跑执行器；返回回执摘要。任一步失败抛 Error(reason_code)。 */
async function execute(cfg, task, ctx, signal) {
  const names = taskNames(task.id);
  const worktree = await prepareWorktree(cfg, task, names, ctx);
  const contract = readContract(worktree);
  const envelope = {
    contract,
    input: {
      run_tag: names.runTag,
      task_id: task.id,
      worktree,
      sprint_dir: names.sprintDir,
      brain_url: cfg.brainUrl,
    },
  };
  log(`开跑 ${task.id}：worktree=${worktree} branch=${names.branch}`);
  const r = await runExecutor({
    executor: cfg.executor ?? path.join(worktree, EXECUTOR_REL),
    cwdDir: path.join(worktree, WORKFLOW_REL),
    worktree,
    envelope,
    receiptPath: ctx.receiptPath,
    logPath: path.join(cfg.logDir, `${task.id}.log`),
    timeoutMs: cfg.runTimeoutMs ?? runTimeoutMs(contract),
    killGraceMs: cfg.killGraceMs,
    signal,
  });
  if (r.aborted) throw new Error('runner_terminated');
  if (r.timedOut) throw new Error('executor_timeout');
  const receipt = readReceipt(r.stdout, ctx.receiptPath);
  if (!receipt) throw new Error('executor_crashed');
  return summarizeReceipt(receipt);
}

/** gh pr ready + gh pr merge --auto --squash；失败只记录，不影响任务完成。 */
async function automerge(cfg, prUrl, cwd) {
  const ready = await run(cfg.ghBin, ['pr', 'ready', prUrl], { cwd, timeoutMs: GH_TIMEOUT_MS });
  const merge = await run(cfg.ghBin, ['pr', 'merge', prUrl, '--auto', '--squash'], { cwd, timeoutMs: GH_TIMEOUT_MS });
  if (merge.code !== 0) log(`automerge 失败：${merge.stderr.trim().split('\n').pop() || merge.code}`);
  return { ready: ready.code === 0, merge: merge.code === 0 };
}

/** 回写 failed；保留 worktree 供排查。 */
async function failTask(cfg, brain, task, ctx, summary) {
  const info = {
    status: summary.status,
    failed_activity: summary.failed_activity,
    reason_code: summary.reason_code,
    receipt_path: ctx.receiptPath,
    host: cfg.host,
  };
  const r = await brain.patch(task.id, { status: 'failed', result: { coding_workflow_runner: info } });
  if (!r.ok) log(`回写 failed 失败（HTTP ${r.status}），任务 ${task.id} 需人工收账`);
  log(`任务 ${task.id} 失败：${summary.failed_activity ?? '-'} / ${summary.reason_code}；现场 ${ctx.worktree ?? '未建'}`);
  return 1;
}

async function finishSuccess(cfg, brain, task, ctx, summary, startedAt) {
  const runner = {
    receipt_path: ctx.receiptPath,
    host: cfg.host,
    duration_s: Math.round((Date.now() - startedAt) / 1000),
  };
  if (cfg.automerge) runner.automerge = await automerge(cfg, summary.pr_url, ctx.worktree);
  const r = await brain.patch(task.id, { status: 'completed', result: { runner } });
  if (!r.ok) {
    log(`Brain 拒绝 completed（HTTP ${r.status}）`);
    return failTask(cfg, brain, task, ctx, { ...summary, reason_code: 'complete_rejected' });
  }
  if (!(await removeWorktree(cfg, ctx.worktree, ctx.branch))) log(`删除 worktree ${ctx.worktree} 失败，留待 prune`);
  log(`任务 ${task.id} 完成：${summary.pr_url}`);
  return 0;
}

export async function runOnce(cfg, signal) {
  await pruneWorktrees(cfg).catch(() => {});
  const brain = brainClient(cfg.brainUrl);
  let task;
  try {
    task = await findAndClaim(cfg, brain);
  } catch (error) {
    log(`查询/认领任务失败：${error.message}`);
    return 1;
  }
  if (!task) return 0;

  const startedAt = Date.now();
  const started = await brain.patch(task.id, { status: 'in_progress' });
  if (!started.ok) {
    log(`已认领 ${task.id} 但置 in_progress 失败（HTTP ${started.status}），不开跑`);
    return 1;
  }

  const ctx = { worktree: null, branch: null, receiptPath: path.join(cfg.logDir, `${task.id}.json`) };
  let summary;
  try {
    summary = await execute(cfg, task, ctx, signal);
  } catch (error) {
    summary = { status: 'failed', failed_activity: null, reason_code: error?.message || 'runner_error', pr_url: null };
  }
  try {
    if (summary.status === 'completed' && !summary.reason_code) {
      return await finishSuccess(cfg, brain, task, ctx, summary, startedAt);
    }
    return await failTask(cfg, brain, task, ctx, summary);
  } catch (error) {
    // 收尾本身出错也要尽力回写，不留 in_progress 孤儿
    log(`收尾异常：${error?.stack || error}`);
    return failTask(cfg, brain, task, ctx, { ...summary, reason_code: 'runner_finalize_error' });
  }
}

export async function main(env = process.env) {
  const cfg = loadConfig(env);
  let lock;
  try {
    lock = acquireLock(cfg.lockDir);
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
