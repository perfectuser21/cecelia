// packages/brain/src/harness-watchdog-loop.js
/**
 * harness-watchdog-loop.js — 独立 harness 看门狗循环（与 tick 调度层彻底解耦）
 *
 * ── 根因背景（P1，2026-06-13）──
 * harness watchdog（scanStuckHarness + resumeStalledHarnessDrivers）原先只接在
 * tick-runner.js 的 executeTick()。但 Wave 2（2026-05-04）起 tick-loop.js 改调
 * runScheduler（tick-scheduler.js），executeTick 从不被调用 → watchdog 函数本身正确
 * （手动 invoke 立刻捞起卡死任务），但生产中**从未被调用** → GAN/planner 阶段静默卡死
 * 无人自救，「全自动总差最后一口气」。#3376 的 watchdog 函数形同虚设。
 *
 * ── 修复设计 ──
 * 把 watchdog 接到**独立 setInterval**（仿 consciousness-loop.js 模式），由 startTickLoop()
 * 启动。关键不变量：
 *   1. 独立 timer，不依赖任何 tick body（runScheduler）跑完 —— 不会被 runScheduler 的
 *      circuit_open / no_goals 早 return 或异常跳过。
 *   2. scan / resume 各自独立 try-catch —— 一个抛错不影响另一个。
 *   3. 每次执行**无条件** log `[harness-watchdog] scanned=N flagged=F resumed=M`，
 *      即使 resumed=0 也打 —— 提供「我在跑」的可观测输出（杜绝 grep watchdog=0 既不能
 *      证明跑了也不能证明没跑的盲区）。
 *   4. 不受 CONSCIOUSNESS_ENABLED 门控 —— 这是纯恢复安全网（无 LLM），任何时候都该跑。
 */
import pool from './db.js';

const HARNESS_WATCHDOG_INTERVAL_MS = parseInt(
  process.env.CECELIA_HARNESS_WATCHDOG_INTERVAL_MS || String(5 * 60 * 1000),
  10
);

let _loopTimer = null;
let _isRunning = false;

/**
 * 单次看门狗执行：scan（标逾期 failed）+ resume（重排驱动器已死的 parked 任务）。
 * scan 与 resume 各自独立 try-catch，互不影响；末尾无条件 log 可观测行。
 *
 * @param {{ pool?: import('pg').Pool }} [opts]
 * @returns {Promise<{ scanned: number, flagged: number, resumed: number }>}
 */
export async function runHarnessWatchdogOnce({ pool: dbPool = pool } = {}) {
  let scanned = 0;
  let flagged = 0;
  let resumed = 0;

  // 1. scanStuckHarness — 标 deadline_at 逾期 + completed_at IS NULL 的 initiative_run 为 failed
  try {
    const { scanStuckHarness } = await import('./harness-watchdog.js');
    const r = await scanStuckHarness({ pool: dbPool, notifier: undefined });
    scanned += r?.scanned || 0;
    flagged = r?.flagged?.length || 0;
  } catch (err) {
    console.warn(`[harness-watchdog] scan failed (non-fatal): ${err.message}`);
  }

  // 2. resumeStalledHarnessDrivers — 重排「驱动器已死」的 parked harness 任务
  //    （含 B 阶段心跳判据 + A 阶段 planner/GAN 活动复合判据，默认 staleMinutesA=20）
  try {
    const { resumeStalledHarnessDrivers } = await import('./harness-watchdog.js');
    const r = await resumeStalledHarnessDrivers({ pool: dbPool });
    scanned += r?.scanned || 0;
    resumed = r?.resumed?.length || 0;
  } catch (err) {
    console.warn(`[harness-watchdog] resume failed (non-fatal): ${err.message}`);
  }

  // 3. 无条件可观测性：每次执行都打一行「我在跑」，即使 scanned=0 resumed=0
  console.log(`[harness-watchdog] scanned=${scanned} flagged=${flagged} resumed=${resumed}`);

  return { scanned, flagged, resumed };
}

/**
 * 启动独立看门狗循环（默认每 5 分钟，env CECELIA_HARNESS_WATCHDOG_INTERVAL_MS 可覆盖）。
 * @param {{ intervalMs?: number }} [opts]
 * @returns {boolean} false 表示已在运行
 */
export function startHarnessWatchdogLoop({ intervalMs = HARNESS_WATCHDOG_INTERVAL_MS } = {}) {
  if (_loopTimer) {
    console.log('[harness-watchdog] 循环已在运行，跳过重复启动');
    return false;
  }

  _loopTimer = setInterval(async () => {
    if (_isRunning) {
      // 重入保护：上一轮 scan/resume 还没跑完（极少见，SQL 慢），跳过本轮
      console.warn('[harness-watchdog] 上次看门狗未完成，跳过本次');
      return;
    }
    _isRunning = true;
    try {
      await runHarnessWatchdogOnce();
    } catch (err) {
      // runHarnessWatchdogOnce 内部已 swallow，这里是最后兜底，绝不让异常杀掉 interval
      console.warn(`[harness-watchdog] loop tick failed (non-fatal): ${err.message}`);
    } finally {
      _isRunning = false;
    }
  }, intervalMs);

  // 不阻止进程退出
  if (_loopTimer.unref) _loopTimer.unref();

  console.log(`[harness-watchdog] 独立看门狗循环已启动（间隔 ${Math.round(intervalMs / 60000)} 分钟）`);
  return true;
}

/**
 * 停止看门狗循环（测试用 / 关闭用）。
 */
export function stopHarnessWatchdogLoop() {
  if (_loopTimer) {
    clearInterval(_loopTimer);
    _loopTimer = null;
  }
  _isRunning = false;
}

export default {
  runHarnessWatchdogOnce,
  startHarnessWatchdogLoop,
  stopHarnessWatchdogLoop,
};
