/**
 * pipeline-patrol-loop.js — 独立巡航循环（接回 live tick）。
 *
 * 根因（2026-06-27 审计）：runPipelinePatrol（/dev 卡住会话救援）+ runHarnessInitiativePatrol
 * （harness initiative Planner/GAN 卡住 → 建 harness_intervention 任务）只挂在 Wave-2 废弃的
 * executeTick 上 → runScheduler 迁移后从不调用 → 干预通道整条死代码。仿 recovery-loop / harness-
 * watchdog-loop 用独立 setInterval 接回，不依赖 runScheduler 跑完（不被 circuit_open / no_goals 早 return 跳过）。
 */

import pool from './db.js';

const PATROL_INTERVAL_MS = Number(process.env.CECELIA_PATROL_LOOP_INTERVAL_MS) || 5 * 60 * 1000; // 默认 5 分钟

let _loopTimer = null;
let _isRunning = false;

/**
 * 跑一次巡航：dev 会话救援 + harness initiative 干预。两条彼此独立 try/catch，
 * 一条失败不拖累另一条，绝不让异常杀掉 interval。
 * @param {{ pool?: any, runPipelinePatrol?: Function, runHarnessInitiativePatrol?: Function }} [opts]
 * @returns {Promise<{devRescued: number, harnessIntervened: number}>}
 */
export async function runPipelinePatrolOnce(opts = {}) {
  const dbPool = opts.pool || pool;
  let devRescued = 0;
  let harnessIntervened = 0;

  try {
    const fn = opts.runPipelinePatrol
      || (await import('./pipeline-patrol.js')).runPipelinePatrol;
    const r = await fn(dbPool);
    devRescued = r?.rescued ?? 0;
  } catch (err) {
    console.warn(`[pipeline-patrol-loop] runPipelinePatrol failed (non-fatal): ${err.message}`);
  }

  try {
    const fn = opts.runHarnessInitiativePatrol
      || (await import('./harness-initiative-patrol.js')).runHarnessInitiativePatrol;
    const r = await fn(dbPool);
    harnessIntervened = r?.intervened ?? 0;
  } catch (err) {
    console.warn(`[pipeline-patrol-loop] runHarnessInitiativePatrol failed (non-fatal): ${err.message}`);
  }

  // 无条件可观测性：每次执行都打一行"我在跑"，即使全 0
  console.log(`[pipeline-patrol-loop] devRescued=${devRescued} harnessIntervened=${harnessIntervened}`);

  return { devRescued, harnessIntervened };
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
