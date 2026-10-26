#!/usr/bin/env node
// coding workflow runner：每次调用至多新跑一条开关任务（task_type=coding_workflow；迁移窗口内兼容旧三件套
// task_type=data + payload.headed_manual="true" + payload.coding_workflow===true）：保留期清理 → 对账（本机丢失的 in_progress、带本机痕迹的 queued）
// → 自己开的 cw PR 有 CI 红则本轮只修它（lib/cifix.mjs）→ CI 绿的过AI QA 门（lib/qa-gate.mjs，PASS 才开自动合并）
// → 认领 → 建 worktree → 跑 coding 链 → 回写 Brain。
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
import { chainSpans, postSpans } from './lib/spans.mjs';
import { readReceipt, summarizeReceipt } from './lib/receipt.mjs';
import { failTask, finishSuccess, localSummary, lostSummary, settle, settleQueued } from './lib/terminal.mjs';
import { runCiFix } from './lib/cifix.mjs';
import { runQaGate } from './lib/qa-gate.mjs';
import { runMergeGate, settleHumanMerges } from './lib/merge-gate.mjs';
import { runCommander } from './lib/commander.mjs';
import { listOwnPrs } from './lib/cifix-scan.mjs';
import { idleLogDue } from './lib/session-log.mjs';
import { restoreStates, mirrorStates } from './lib/state-store.mjs';
import { prepareStateSync } from './lib/pr-sync.mjs';
import { settleClosedPrs } from './lib/pr-closure.mjs';
import { readyCandidates } from './lib/deps.mjs';
import { repoViews, taskView } from './lib/repos.mjs';
import { startLeaseHeartbeat } from './lib/lease.mjs';
import { commitAvailable, sameAuthority, validateAuthority } from '../lib/authority-refs.mjs';
import { git } from './lib/proc.mjs';

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
  return pickCandidates(queued, { enabled: cfg.repos.map((r) => r.key), log }).filter((task) => {
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
    // 空闲 tick 每 5 分钟一次：限频（默认每小时最多一行），免得刷满主日志
    if (idleLogDue(ctx.cfg)) log('没有可新跑的开关任务');
    return null;
  }
  for (const task of candidates) {
    const r = await ctx.brain.claim(task.id, ctx.cfg.claimer, ctx.cfg.leaseSeconds);
    if (r.ok) return { ...task, claimed_kind: r.body?.executor_kind ?? null };
    log(`认领 ${task.id} 失败（HTTP ${r.status}），换下一条`);
  }
  return null;
}

/** 建 worktree 并跑执行器；返回回执摘要。任一步失败抛 Error(reason_code)。ctx.cfg 是任务所在仓库的视图。 */
async function execute(ctx, task, job, signal) {
  const { cfg } = ctx;
  const names = taskNames(task.id);
  fs.mkdirSync(cfg.logDir, { recursive: true });
  const freezeFile = path.join(cfg.logDir, `${task.id}.initial-base.sha`);
  if (task.payload?.authority_required === true && task.payload?.base_sha === undefined && !fs.existsSync(freezeFile)) {
    const fetched = await git(cfg.repo, ['fetch', 'origin', 'main']);
    if (fetched.code !== 0) throw new Error('git_fetch_failed');
    const base = await git(cfg.repo, ['rev-parse', '--verify', 'origin/main^{commit}']);
    if (base.code !== 0 || !commitAvailable(cfg.repo, base.stdout.trim())) throw new Error('initial_base_unavailable');
    fs.writeFileSync(freezeFile, `${base.stdout.trim()}\n`, { flag: 'wx' });
  }
  if (task.payload?.base_sha === undefined && fs.existsSync(freezeFile)) {
    const frozen = fs.readFileSync(freezeFile, 'utf8').trim();
    if (!commitAvailable(cfg.repo, frozen)) throw new Error('initial_base_unavailable');
    task = { ...task, payload: { ...task.payload, base_sha: frozen } };
  }
  // worktree 来自任务所在仓库的 clone（cfg.repo）、建在它的 worktree 根
  const worktree = await prepareWorktree(cfg, task, names, job, signal);
  const head = await git(worktree, ['rev-parse', 'HEAD']);
  if (head.code !== 0) throw new Error('initial_base_unavailable');
  const initialBase = task.payload?.base_sha ?? head.stdout.trim();
  if (head.stdout.trim() !== initialBase) throw new Error('initial_base_mismatch');
  if (!commitAvailable(worktree, initialBase)) throw new Error('initial_base_unavailable');
  if (fs.existsSync(freezeFile) && fs.readFileSync(freezeFile, 'utf8').trim() !== initialBase) throw new Error('initial_base_mismatch');
  if (!fs.existsSync(freezeFile)) fs.writeFileSync(freezeFile, `${initialBase}\n`, { flag: 'wx' });
  if (task.payload?.authority_required === true) {
    for (const ref of task.payload.authority.refs) {
      if (!commitAvailable(worktree, ref.revision)) throw new Error('authority_revision_unavailable');
    }
  }
  // 判卷代码（契约、执行器、各活动）一律来自默认仓 runner 专用 clone（每轮自更新到 main），不来自任务 worktree / 任务仓库：
  // build 改过的 verify/chain_check 不能拿来判它自己（审计 P0 #1，对应旧 harness「judge 不在被评 worktree 跑」）
  const judgeRepo = cfg.trustedRepo ?? cfg.repo;
  const trusted = path.join(judgeRepo, WORKFLOW_REL);
  const contract = readContract(path.join(trusted, 'contract.json'));
  const envelope = {
    contract,
    input: {
      run_tag: names.runTag, task_id: task.id, worktree, sprint_dir: names.sprintDir, brain_url: cfg.brainUrl,
      ...(task.payload?.authority_required === true ? { authority: task.payload.authority, authority_required: true } : {}),
      initial_base_sha: initialBase,
      // 只透传任务登记值；不采用 .dev-mode 为兼容旧任务生成的豁免缺省。
      ...(task.payload?.gp_anchor !== undefined ? { gp_anchor: task.payload.gp_anchor } : {}),
      // 活动层按仓库参数化（C6）：版本碎片、CI 预检清单、本仓规矩提示词、QA 模式随任务所在仓库的 repos.json 条目走
      ...(cfg.repoProfile ? { repo_profile: cfg.repoProfile } : {}),
    },
  };
  log(`开跑 ${task.id}：worktree=${worktree} branch=${names.branch}`);
  const startedAt = Date.now();
  const r = await runExecutor({
    executor: cfg.executor ?? path.join(judgeRepo, EXECUTOR_REL),
    cwdDir: trusted,
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
  // 执行记录（决策 b34e346a）：每个活动的每次尝试一条 span
  await postSpans(ctx, chainSpans(receipt, { taskId: task.id, startedAt }));
  return summarizeReceipt(receipt);
}

/**
 * 门禁按仓库遍历（repos.json 顺序，C5）：每个已启用仓库用自己的视图（clone / worktree 根 / 状态命名空间 / GH_REPO）
 * 跑一遍各道门；任一仓库做了事返回 true（本轮到此，保持「一轮只做一件事」）。clone 不存在（runner.sh 没 clone 成）的仓库跳过。
 */
async function runGates(ctx, signal) {
  const { cfg } = ctx;
  if (!cfg.qaGate && !cfg.ciFix && !cfg.commander) return false;
  for (const view of repoViews(cfg)) {
    if (!fs.existsSync(view.repo)) {
      log(`仓库 ${view.repoKey} 的 clone ${view.repo} 不存在，本轮跳过它的门禁`);
      continue;
    }
    if (await runRepoGates({ ...ctx, cfg: view }, signal)) return true;
  }
  return false;
}

/**
 * 一个仓库的门：合并门 → commander → CI 修复 → QA 门；有一个做了事返回 true。
 * 状态外部真相（审计 #34）：跑之前本机缺状态文件的 PR 从 Brain 恢复，跑完把有变化的关键字段写回 Brain。
 */
async function runRepoGates(ctx, signal) {
  const { cfg } = ctx;
  const prs = await listOwnPrs(cfg).catch(() => null);
  await prepareStateSync(ctx, prs);
  await restoreStates(ctx, [...ctx.syncPrs.values()]);
  try {
    // 外部关闭（未合并）的 PR 收尾、重开恢复、已结束的停预览：不算本轮动作，不挡后面的门
    await settleClosedPrs(ctx, prs);
    // 不自动合并的仓库：等人合并的 PR 被人合并了 → 收账（不算本轮动作）
    if (cfg.qaGate) await settleHumanMerges(ctx);
    // 已批准的 PR：只合并被批准的 head（批准后又改了代码则撤销批准，本轮到此）
    if (cfg.qaGate && await runMergeGate(ctx)) return true;
    // 升级了的 PR：coding commander 裁决并解除（或上交主理人），本轮到此（决策 c167d6e3）
    if (cfg.commander && await runCommander(ctx, signal)) return true;
    // 先收尾再开新：自己开的 PR CI 红了，本轮只修它
    if (cfg.ciFix && await runCiFix(ctx, signal)) return true;
    // CI 绿了：AI QA 门（PASS 才开自动合并，FAIL 进修复环）
    return Boolean(cfg.qaGate && await runQaGate(ctx, signal));
  } finally {
    await mirrorStates(ctx, prs);
  }
}

export async function runOnce(cfg, signal) {
  await cleanupRetention(cfg).catch((error) => log(`保留期清理失败：${error.message}`));
  const ctx = { cfg, brain: brainClient(cfg.brainUrl, { listLimit: cfg.listLimit, log }), log };
  let task;
  try {
    await settleLost(ctx);
    if (await runGates(ctx, signal)) return 0;
    const fresh = await pickNew(ctx, await ctx.brain.listTasks('queued'));
    task = await claimFirst(ctx, await readyCandidates(ctx, fresh));
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
  // 任务所在仓库的视图：worktree 建在该仓库 clone，收尾删 worktree 也用它（日志目录 / 回执路径不变）
  const tctx = { ...ctx, cfg: taskView(cfg, task) };
  // Brain 没把 kind 记成 coding-workflow-runner（旧端点保留历史残留）：重启会被当本机执行体打回重跑，不跑链
  if (task.claimed_kind !== EXECUTOR_KIND) {
    const detail = `认领响应 executor_kind=${task.claimed_kind ?? '空'}，不是 ${EXECUTOR_KIND}`;
    log(`任务 ${task.id} ${detail}，不跑链`);
    return failTask(tctx, task, job, { status: 'failed', failed_activity: null, reason_code: 'executor_kind_mismatch', pr_url: null, detail });
  }
  const read = await ctx.brain.getTask(task.id);
  const current = read.body;
  if (!read.ok || current?.id !== task.id) {
    return failTask(tctx, task, job, { status: 'failed', failed_activity: 'intent',
      reason_code: 'task_receipt_unavailable', pr_url: null, detail: `无法核实任务 ${task.id} 的领单回执` });
  }
  const managed = task.payload?.authority_required === true || task.payload?.authority !== undefined
    || current.payload?.authority_required === true || current.payload?.authority !== undefined;
  if (managed) {
    if (current?.payload?.authority_required !== true
      || validateAuthority(current?.payload?.authority).length > 0
      || !sameAuthority(current.payload.authority, task.payload?.authority)
      || task.payload?.authority_required !== true || current.payload.repo !== task.repoKey) {
      return failTask(tctx, task, job, { status: 'failed', failed_activity: 'intent',
        reason_code: 'authority_receipt_mismatch', pr_url: null,
        detail: `受管声明或仓库路由回执不一致：task_id=${task.id}` });
    }
  }
  task = { ...current, repoKey: task.repoKey, claimed_kind: task.claimed_kind };
  let summary;
  // 统一领单租约：执行期间心跳续约；409 lease_lost → 中止执行器，Brain 已按租约语义处置，不再回写终态
  const leaseAbort = new AbortController();
  const onOuterAbort = () => leaseAbort.abort();
  signal?.addEventListener('abort', onOuterAbort, { once: true });
  const beat = startLeaseHeartbeat({
    brain: ctx.brain, taskId: task.id, claimer: cfg.claimer, leaseSeconds: cfg.leaseSeconds, intervalMs: cfg.heartbeatMs, log,
    onLost: () => leaseAbort.abort(),
  });
  try {
    summary = await execute(tctx, task, job, leaseAbort.signal);
  } catch (error) {
    summary = { status: 'failed', failed_activity: null, reason_code: error?.message || 'runner_error', pr_url: null };
  } finally {
    beat.stop();
    signal?.removeEventListener('abort', onOuterAbort);
  }
  if (beat.lost()) {
    log(`任务 ${task.id} 租约已被 Brain 回收（lease_lost）：执行器已中止，不回写终态；现场 ${job.worktree ?? '无'}`);
    return 1;
  }
  try {
    if (summary.status === 'completed' && !summary.reason_code) {
      return await finishSuccess(tctx, task, job, summary, { duration_s: Math.round((Date.now() - startedAt) / 1000) });
    }
    return await failTask(tctx, task, job, summary);
  } catch (error) {
    // 收尾本身出错也要尽力回写，不留 in_progress 孤儿
    log(`收尾异常：${error?.stack || error}`);
    return failTask(tctx, task, job, { ...summary, reason_code: 'runner_finalize_error' });
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
