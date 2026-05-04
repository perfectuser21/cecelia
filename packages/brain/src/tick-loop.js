/**
 * tick-loop.js — Brain v2 Phase D2.2
 *
 * 收口 tick.js 的 3 个 loop 控制函数（runTickSafe / startTickLoop / stopTickLoop）+
 * 3 个相关常量（TICK_INTERVAL_MINUTES / TICK_LOOP_INTERVAL_MS / TICK_TIMEOUT_MS）。
 *
 * 设计原则：
 *  - executeTick 注入：runTickSafe(source, tickFn?) 默认用 tick-runner 的 executeTick，
 *    测试可注入 mock。
 *  - tickState 来自 tick-state.js（D1.7a）— loopTimer / tickRunning / tickLockTime / lastExecuteTime
 *  - tickLog 本地复刻（与 tick.js / tick-runner.js 同形态）；计数器独立，
 *    每模块各自满 100 条打 [tick-summary]，互不污染。
 *
 * tick.js 通过 `import { ... } from './tick-loop.js'` 在 export 块统一 re-export，
 * 老 caller (routes/tick.js, __tests__/tick-throttle.test.js 等) 不受影响。
 */
import { tickState } from './tick-state.js';
import { executeTick } from './tick-runner.js';
import { runScheduler } from './tick-scheduler.js';
import { startConsciousnessLoop } from './consciousness-loop.js';
import { publishCognitiveState } from './events/taskEvents.js';

// ───── tickLog: [HH:MM:SS] 前缀 + 每 100 条打一次 summary ─────
const { log: _tickWrite } = console;
let _tickLogCallCount = 0;
function tickLog(...args) {
  const ts = new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  _tickWrite(`[${ts}]`, ...args);
  _tickLogCallCount++;
  if (_tickLogCallCount % 100 === 0) {
    _tickWrite(`[tick-loop-summary] ${_tickLogCallCount} ticks completed`);
  }
}

// ───── Tick configuration ─────
export const TICK_INTERVAL_MINUTES = 2;
export const TICK_LOOP_INTERVAL_MS = parseInt(process.env.CECELIA_TICK_INTERVAL_MS || '5000', 10); // 5 seconds between loop ticks
export const TICK_TIMEOUT_MS = 60 * 1000; // 60 seconds max execution time

/**
 * Run tick with reentry guard and timeout protection
 * @param {string} source - who triggered this tick
 * @param {Function} [tickFn] - optional tick function override (for testing)
 */
export async function runTickSafe(source = 'loop', tickFn) {
  // Wave 2: 默认调度器改为 runScheduler（纯调度，无 LLM）。
  // executeTick 仍 import 以兼容显式注入 / 回滚 — 见 tick-runner.js 顶部废弃说明。
  void executeTick;
  const doTick = tickFn || runScheduler;

  // Throttle: loop ticks only execute once per TICK_INTERVAL_MINUTES
  if (source === 'loop') {
    const elapsed = Date.now() - tickState.lastExecuteTime;
    const intervalMs = TICK_INTERVAL_MINUTES * 60 * 1000;
    if (tickState.lastExecuteTime > 0 && elapsed < intervalMs) {
      return { skipped: true, reason: 'throttled', source, next_in_ms: intervalMs - elapsed };
    }
  }

  // Reentry guard: check if already running
  if (tickState.tickRunning) {
    // Timeout protection: if tick has been running > TICK_TIMEOUT_MS, force-release the lock
    // 根因：doTick() 内部有 unresolved promise 时，finally 永远不执行，锁永不释放
    // 修复：超时后强制释放，让下一轮 tick 能正常执行
    if (tickState.tickLockTime && (Date.now() - tickState.tickLockTime > TICK_TIMEOUT_MS)) {
      console.warn(`[tick-loop] Tick stuck for ${Math.round((Date.now() - tickState.tickLockTime) / 1000)}s (>${TICK_TIMEOUT_MS / 1000}s), FORCE-RELEASING lock (source: ${source})`);
      tickState.tickRunning = false;
      tickState.tickLockTime = null;
      // 不 return — 继续执行本轮 tick
    } else {
      tickLog(`[tick-loop] Tick already running, skipping (source: ${source})`);
      return { skipped: true, reason: 'already_running', source };
    }
  }

  tickState.tickRunning = true;
  tickState.tickLockTime = Date.now();

  // 保底 setTimeout：无论 doTick() 是否 resolve，TICK_TIMEOUT_MS 后强制释放锁
  // 解决 tickState.tickLockTime 被清但 tickState.tickRunning 未清的边界情况
  const _forceReleaseTimer = setTimeout(() => {
    if (tickState.tickRunning) {
      console.warn(`[tick-loop] FORCE-RELEASE via setTimeout (${TICK_TIMEOUT_MS / 1000}s safety net, source: ${source})`);
      tickState.tickRunning = false;
      tickState.tickLockTime = null;
    }
  }, TICK_TIMEOUT_MS);

  try {
    const result = await doTick();
    tickState.lastExecuteTime = Date.now();
    tickLog(`[tick-loop] Tick completed (source: ${source}), actions: ${result.actions_taken?.length || 0}`);
    return result;
  } catch (err) {
    console.error(`[tick-loop] Tick failed (source: ${source}):`, err.message);
    return { success: false, error: err.message, source };
  } finally {
    clearTimeout(_forceReleaseTimer);
    tickState.tickRunning = false;
    tickState.tickLockTime = null;
  }
}

/**
 * Start the tick loop (setInterval)
 */
export function startTickLoop() {
  if (tickState.loopTimer) {
    tickLog('[tick-loop] Loop already running, skipping start');
    return false;
  }

  // 微心跳计数器：每 6 次循环（约 30s）推送一次 idle 状态
  let _microHeartbeatCounter = 0;
  const MICRO_HEARTBEAT_INTERVAL = 6; // 6 × 5s = 30s

  tickState.loopTimer = setInterval(async () => {
    try {
      const result = await runTickSafe('loop');
      // 微心跳：tick 被节流时，定期推送 idle 认知状态
      if (result?.skipped && result?.reason === 'throttled') {
        _microHeartbeatCounter++;
        if (_microHeartbeatCounter >= MICRO_HEARTBEAT_INTERVAL) {
          _microHeartbeatCounter = 0;
          const nextInMs = result.next_in_ms || 0;
          const nextInMin = Math.ceil(nextInMs / 60000);
          publishCognitiveState({
            phase: 'idle',
            detail: nextInMin > 0 ? `等待下次 tick（${nextInMin}分钟后）` : '空闲中',
            meta: { next_in_ms: nextInMs },
          });
        }
      } else {
        _microHeartbeatCounter = 0; // tick 执行了，重置计数器
      }
    } catch (err) {
      console.error('[tick-loop] Unexpected error in loop:', err.message);
    }
  }, TICK_LOOP_INTERVAL_MS);

  // Don't prevent process exit
  if (tickState.loopTimer.unref) {
    tickState.loopTimer.unref();
  }

  // Wave 2: 启动 LLM 意识循环（每 20 分钟）。CONSCIOUSNESS_ENABLED=false 时返回 false 不建定时器。
  startConsciousnessLoop();

  tickLog(`[tick-loop] Started (interval: ${TICK_LOOP_INTERVAL_MS}ms)`);
  return true;
}

/**
 * Stop the tick loop
 */
export function stopTickLoop() {
  if (!tickState.loopTimer) {
    tickLog('[tick-loop] No loop running, skipping stop');
    return false;
  }

  clearInterval(tickState.loopTimer);
  tickState.loopTimer = null;
  tickLog('[tick-loop] Stopped');
  return true;
}

export default {
  runTickSafe,
  startTickLoop,
  stopTickLoop,
  TICK_INTERVAL_MINUTES,
  TICK_LOOP_INTERVAL_MS,
  TICK_TIMEOUT_MS
};
