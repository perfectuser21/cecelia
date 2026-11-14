/** 现役开发会话救援的独立巡航循环。 */

import pool from './db.js';

const PATROL_INTERVAL_MS = Number(process.env.CECELIA_PATROL_LOOP_INTERVAL_MS) || 5 * 60 * 1000; // 默认 5 分钟

let _loopTimer = null;
let _isRunning = false;

/** 执行开发会话救援；失败不终止后续巡航。 */
export async function runPipelinePatrolOnce(opts = {}) {
  const dbPool = opts.pool || pool;
  let devRescued = 0;

  try {
    const fn = opts.runPipelinePatrol
      || (await import('./pipeline-patrol.js')).runPipelinePatrol;
    const r = await fn(dbPool);
    devRescued = r?.rescued ?? 0;
  } catch (err) {
    console.warn(`[pipeline-patrol-loop] runPipelinePatrol failed (non-fatal): ${err.message}`);
  }

  // 无条件可观测性：每次执行都打一行"我在跑"，即使全 0
  console.log(`[pipeline-patrol-loop] devRescued=${devRescued}`);

  return { devRescued };
}

/**
 * 启动独立巡航循环（默认每 5 分钟，env CECELIA_PATROL_LOOP_INTERVAL_MS 可覆盖）。
 * @param {{ intervalMs?: number }} [opts]
 * @returns {boolean} false=已在运行
 */
export function startPipelinePatrolLoop({ intervalMs = PATROL_INTERVAL_MS } = {}) {
  if (_loopTimer) {
    console.log('[pipeline-patrol-loop] 循环已在运行，跳过重复启动');
    return false;
  }

  _loopTimer = setInterval(async () => {
    if (_isRunning) {
      console.warn('[pipeline-patrol-loop] 上次巡航未完成，跳过本次');
      return;
    }
    _isRunning = true;
    try {
      await runPipelinePatrolOnce();
    } catch (err) {
      console.warn(`[pipeline-patrol-loop] loop tick failed (non-fatal): ${err.message}`);
    } finally {
      _isRunning = false;
    }
  }, intervalMs);

  if (_loopTimer.unref) _loopTimer.unref();

  console.log(`[pipeline-patrol-loop] 独立巡航循环已启动（间隔 ${Math.round(intervalMs / 60000)} 分钟）`);
  return true;
}

/** 停止巡航循环（测试用 / 关闭用）。 */
export function stopPipelinePatrolLoop() {
  if (_loopTimer) {
    clearInterval(_loopTimer);
    _loopTimer = null;
  }
  _isRunning = false;
}

export default {
  runPipelinePatrolOnce,
  startPipelinePatrolLoop,
  stopPipelinePatrolLoop,
};
