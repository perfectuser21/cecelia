// packages/brain/src/recovery-loop.js
/**
 * 独立任务恢复循环：释放失效claim、超时收尾、孤儿回收和到期解封。
 * 各条恢复网独立捕获异常，不依赖调度tick或LLM。
 * 退役开发类型只保留历史记录，不进入现役超时重排队。
 */
import pool from './db.js';
import { isRetiredDevelopmentTask } from './lib/task-type-registry.js';

const RECOVERY_INTERVAL_MS = parseInt(
  process.env.CECELIA_RECOVERY_LOOP_INTERVAL_MS || String(5 * 60 * 1000),
  10
);

// 每轮最多解封几个 blocked 任务。沿用死代码里的 5（tick-runner.js:179）：
// 解封是把任务放回 queued，一次放太多会让派发层瞬间被打满。
// 积压 200+ 时按每 5 分钟 5 个的速度疏通，几小时排空，不会冲垮下游。
const UNBLOCK_BATCH_LIMIT = 5;


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
 * 单次恢复执行：现役恢复网各自独立 try-catch，末尾无条件 log 可观测行。
 * 函数依赖可注入（测试用）；生产默认走动态 import。
 *
 * @param {object} [opts]
 * @param {import('pg').Pool} [opts.pool]
 * @param {Function} [opts.cleanupStaleClaims]
 * @param {Function} [opts.autoFailTimedOutTasks]
 * @param {Function} [opts.fetchInProgress]
 * @param {Function} [opts.probeTaskLiveness]
 * @param {Function} [opts.sweepStaleDeviceLocks]
 * @returns {Promise<{staleReleased:number, tasksTimedOut:number, orphansRequeued:number}>}
 */
export async function runRecoveryOnce(opts = {}) {
  const dbPool = opts.pool || pool;
  let staleReleased = 0;
  let tasksTimedOut = 0;
  let orphansRequeued = 0;
  let blockedRecovered = 0;

  // 1. cleanupStaleClaims — 周期释放 stale claim（原仅 Brain 启动时跑一次）
  try {
    const fn = opts.cleanupStaleClaims
      || (await import('./startup-recovery.js')).cleanupStaleClaims;
    const r = await fn(dbPool);
    staleReleased = r?.cleaned ?? r?.cleared ?? r?.rowCount ?? 0;
  } catch (err) {
    console.warn(`[recovery-loop] cleanupStaleClaims failed (non-fatal): ${err.message}`);
  }

  // 3. autoFailTimedOutTasks — wall-clock 超时收尾（不重派退役历史任务）
  try {
    const fetchFn = opts.fetchInProgress || defaultFetchInProgress;
    const inProgress = await fetchFn(dbPool);
    const currentTasks = (inProgress || []).filter((t) => !isRetiredDevelopmentTask(t));
    const fn = opts.autoFailTimedOutTasks
      || (await import('./tick-helpers.js')).autoFailTimedOutTasks;
    const actions = await fn(currentTasks);
    tasksTimedOut = Array.isArray(actions) ? actions.length : 0;
  } catch (err) {
    console.warn(`[recovery-loop] autoFailTimedOutTasks failed (non-fatal): ${err.message}`);
  }

  // 4. probeTaskLiveness — 运行时孤儿回收：进程已死但任务仍 in_progress → 双确认后重排队
  try {
    const fn = opts.probeTaskLiveness
      || (await import('./executor.js')).probeTaskLiveness;
    const actions = await fn();
    orphansRequeued = Array.isArray(actions) ? actions.length : 0;
  } catch (err) {
    console.warn(`[recovery-loop] probeTaskLiveness failed (non-fatal): ${err.message}`);
  }

  // 5. unblockExpiredTasks — blocked_until 到期 → 回 queued
  //    第五条断在 executeTick 里的安全网。前四条 2026-06-27 审计时被接回来了，
  //    这条漏掉，于是从 Wave 2（2026-05-04）起再没跑过——09-07 实测积压 217 个
  //    blocked，其中 15 个 TTL 早已过期。没有它，被阻塞的任务就只能等人工去捞。
  try {
    const fn = opts.unblockExpiredTasks
      || (await import('./task-updater.js')).unblockExpiredTasks;
    const recovered = await fn({ limit: UNBLOCK_BATCH_LIMIT });
    blockedRecovered = Array.isArray(recovered) ? recovered.length : (recovered || 0);
  } catch (err) {
    console.warn(`[recovery-loop] unblockExpiredTasks failed (non-fatal): ${err.message}`);
  }

  // 6. 设备锁对账（G5 横切件）：释放持有任务已非活跃的锁——正确性主保证，
  //    覆盖 executor 多处终态直写 / psql 直设 / task 被删等一切回写旁路。
  //    只回收 uuid 形状持有者：手工/脚本身份（非 task id）的锁不被秒扫，
  //    由 TTL 过期 + acquire 双重判据自然解开。
  try {
    const sweep = opts.sweepStaleDeviceLocks
      || (await import('./device-lock-helpers.js')).sweepStaleDeviceLocks;
    const swept = await sweep();
    if (swept > 0) console.log(`[recovery-loop] released ${swept} stale device lock(s)`);
  } catch (err) {
    console.warn(`[recovery-loop] sweepStaleDeviceLocks failed (non-fatal): ${err.message}`);
  }

  // 7. 无条件可观测性：每次执行都打一行"我在跑"，即使全 0
  console.log(
    `[recovery-loop] staleReleased=${staleReleased} tasksTimedOut=${tasksTimedOut} orphansRequeued=${orphansRequeued} blockedRecovered=${blockedRecovered}`
  );

  return { staleReleased, tasksTimedOut, orphansRequeued, blockedRecovered };
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
