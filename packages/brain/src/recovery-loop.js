// packages/brain/src/recovery-loop.js
/**
 * recovery-loop.js — 独立任务恢复循环（与 tick 调度层彻底解耦）
 *
 * ── 根因背景（P0，2026-06-27 审计）──
 * Wave 2（2026-05-04）起 tick-loop.js 改调 runScheduler（tick-scheduler.js），executeTick()
 * 从不被调用。但三条任务恢复安全网当年只接在 executeTick 里，迁移时只有 harness-watchdog
 * 被重新接成独立 loop（harness-watchdog-loop.js，2026-06-13），这三条全断在死代码里：
 *   1. cleanupStaleClaims —— 只在 Brain 启动时跑一次（startup-recovery）。派发查询硬性
 *      `AND claimed_by IS NULL` → 任务被 claim 后 owner 崩了就永久卡 queued，除非重启 Brain。
 *   2. checkStuckPipelines —— pipeline 整体 spin（多子任务各自有心跳但链条不前进）6h 检测+cancel，
 *      只被废弃 executeTick 引用 → 完全不跑。
 *   3. autoFailTimedOutTasks —— in_progress 超 DISPATCH_TIMEOUT_MINUTES wall-clock 超时收尾，
 *      同样断在 executeTick。
 *
 * ── 修复设计（仿 harness-watchdog-loop.js）──
 *   - 独立 setInterval，不依赖 runScheduler 跑完（不被 circuit_open / no_goals 早 return 跳过）。
 *   - 四条网各自独立 try-catch，一条抛错不影响另三条。
 *   - 每次无条件 log 一行可观测输出，即使全 0 也打（证明"我在跑"）。
 *   - 不受任何 LLM 门控 —— 纯恢复安全网，任何时候都该跑。
 *   4. probeTaskLiveness —— 运行时孤儿回收（P0-v2，2026-07-13）：进程死亡但任务仍
 *      in_progress 时，双确认后自动重排队。harness_* 已在 executor.js 内豁免，
 *      不会与 harness-watchdog-loop 的心跳判据冲突。
 *
 * ── 关键不变量 ──
 *   autoFailTimedOutTasks 是 wall-clock 超时，会误杀**长跑的活跃 harness 任务**（planner +
 *   多轮 GAN + generator + evaluator 合法可达 1+ 小时）。harness 任务由 harness-watchdog
 *   用**心跳判据**专管 → 这里必须排除 harness_* 任务类型，避免两个看门狗打架误杀。
 */
import pool from './db.js';

const RECOVERY_INTERVAL_MS = parseInt(
  process.env.CECELIA_RECOVERY_LOOP_INTERVAL_MS || String(5 * 60 * 1000),
  10
);

// harness 任务由 harness-watchdog（心跳判据）专管，排除出 wall-clock 超时管辖。
// 与 zombie-reaper 豁免列表 + pipeline-watchdog HARNESS_TASK_TYPES 对齐（含两种历史拼写）。
const HARNESS_TASK_TYPES = new Set([
  'harness_initiative', 'harness_task', 'harness_evaluate',
  'harness_contract_propose', 'harness_contract_review',
  'harness_planner', 'harness_generator', 'harness_generate', 'harness_fix',
]);

let _loopTimer = null;
let _isRunning = false;

async function defaultFetchInProgress(dbPool) {
  const r = await dbPool.query(
    `SELECT id, title, status, priority, started_at, updated_at, payload, task_type
     FROM tasks WHERE status = 'in_progress'`
  );
  return r.rows;
}

/**
 * 单次恢复执行：四条网各自独立 try-catch，末尾无条件 log 可观测行。
 * 函数依赖可注入（测试用）；生产默认走动态 import。
 *
 * @param {object} [opts]
 * @param {import('pg').Pool} [opts.pool]
 * @param {Function} [opts.cleanupStaleClaims]
 * @param {Function} [opts.checkStuckPipelines]
 * @param {Function} [opts.autoFailTimedOutTasks]
 * @param {Function} [opts.fetchInProgress]
 * @param {Function} [opts.probeTaskLiveness]
 * @returns {Promise<{staleReleased:number, pipelinesCancelled:number, tasksTimedOut:number, orphansRequeued:number}>}
 */
export async function runRecoveryOnce(opts = {}) {
  const dbPool = opts.pool || pool;
  let staleReleased = 0;
  let pipelinesCancelled = 0;
  let tasksTimedOut = 0;
  let orphansRequeued = 0;

  // 1. cleanupStaleClaims — 周期释放 stale claim（原仅 Brain 启动时跑一次）
  try {
    const fn = opts.cleanupStaleClaims
      || (await import('./startup-recovery.js')).cleanupStaleClaims;
    const r = await fn(dbPool);
    staleReleased = r?.cleaned ?? r?.cleared ?? r?.rowCount ?? 0;
  } catch (err) {
    console.warn(`[recovery-loop] cleanupStaleClaims failed (non-fatal): ${err.message}`);
  }

  // 2. checkStuckPipelines — pipeline 整体 spin 6h 检测+cancel
  try {
    const fn = opts.checkStuckPipelines
      || (await import('./pipeline-watchdog.js')).checkStuckPipelines;
    const r = await fn(dbPool);
    const canceled = r?.canceled ?? r?.cancelled ?? [];
    pipelinesCancelled = Array.isArray(canceled) ? canceled.length : (canceled || 0);
  } catch (err) {
    console.warn(`[recovery-loop] checkStuckPipelines failed (non-fatal): ${err.message}`);
  }

  // 3. autoFailTimedOutTasks — wall-clock 超时收尾（排除 harness，harness 由 harness-watchdog 管）
  try {
    const fetchFn = opts.fetchInProgress || defaultFetchInProgress;
    const inProgress = await fetchFn(dbPool);
    const nonHarness = (inProgress || []).filter((t) => !HARNESS_TASK_TYPES.has(t.task_type));
    const fn = opts.autoFailTimedOutTasks
      || (await import('./tick-helpers.js')).autoFailTimedOutTasks;
    const actions = await fn(nonHarness);
    tasksTimedOut = Array.isArray(actions) ? actions.length : 0;
  } catch (err) {
    console.warn(`[recovery-loop] autoFailTimedOutTasks failed (non-fatal): ${err.message}`);
  }

  // 4. probeTaskLiveness — 运行时孤儿回收：进程已死但任务仍 in_progress → 双确认后重排队
  //    harness 任务由 harness-watchdog-loop（心跳判据）专管，在 executor.probeTaskLiveness
  //    内部已豁免（HARNESS_LIVENESS_EXEMPT_TYPES），此处无需再过滤。
  try {
    const fn = opts.probeTaskLiveness
      || (await import('./executor.js')).probeTaskLiveness;
    const actions = await fn();
    orphansRequeued = Array.isArray(actions) ? actions.length : 0;
  } catch (err) {
    console.warn(`[recovery-loop] probeTaskLiveness failed (non-fatal): ${err.message}`);
  }

  // 5. 无条件可观测性：每次执行都打一行"我在跑"，即使全 0
  console.log(
    `[recovery-loop] staleReleased=${staleReleased} pipelinesCancelled=${pipelinesCancelled} tasksTimedOut=${tasksTimedOut} orphansRequeued=${orphansRequeued}`
  );

  return { staleReleased, pipelinesCancelled, tasksTimedOut, orphansRequeued };
}

/**
 * 启动独立恢复循环（默认每 5 分钟，env CECELIA_RECOVERY_LOOP_INTERVAL_MS 可覆盖）。
 * @param {{ intervalMs?: number }} [opts]
 * @returns {boolean} false=已在运行
 */
export function startRecoveryLoop({ intervalMs = RECOVERY_INTERVAL_MS } = {}) {
  if (_loopTimer) {
    console.log('[recovery-loop] 循环已在运行，跳过重复启动');
    return false;
  }

  _loopTimer = setInterval(async () => {
    if (_isRunning) {
      console.warn('[recovery-loop] 上次恢复未完成，跳过本次');
      return;
    }
    _isRunning = true;
    try {
      await runRecoveryOnce();
    } catch (err) {
      // runRecoveryOnce 内部已 swallow，这里最后兜底，绝不让异常杀掉 interval
      console.warn(`[recovery-loop] loop tick failed (non-fatal): ${err.message}`);
    } finally {
      _isRunning = false;
    }
  }, intervalMs);

  if (_loopTimer.unref) _loopTimer.unref();

  console.log(`[recovery-loop] 独立恢复循环已启动（间隔 ${Math.round(intervalMs / 60000)} 分钟）`);
  return true;
}

/** 停止恢复循环（测试用 / 关闭用）。 */
export function stopRecoveryLoop() {
  if (_loopTimer) {
    clearInterval(_loopTimer);
    _loopTimer = null;
  }
  _isRunning = false;
}

export default {
  runRecoveryOnce,
  startRecoveryLoop,
  stopRecoveryLoop,
};
