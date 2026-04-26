/**
 * tick-state.js — Brain v2 Phase D1.7a
 *
 * 收口 tick.js 模块级 in-memory 状态：
 *  - 14 个 _lastXxxTime 节流计时器（之前散落在 tick.js L159-L173）
 *  - 5 个 loop 控制态（loopTimer / recoveryTimer / tickRunning / tickLockTime / lastConsciousnessReload）
 *
 * 设计原则：
 *  - 单例对象（不是工厂）：tick.js 多处直接读写 tickState.lastXxxTime，
 *    保持原 `let _lastXxxTime` 的同址语义
 *  - 纯数据，无方法（除 reset）：避免行为漂移
 *  - resetTickStateForTests() 把所有时间字段归 0，timer 清空，便于测试隔离
 *
 * Phase D1.7b/D1.7c 后，executeTick 抽出与 plugin 拆分都通过 tickState 统一访问。
 */

export const tickState = {
  // === 14 个节流计时器（毫秒时间戳）===
  lastExecuteTime: 0,           // 全 tick 节流（throttling）
  lastCleanupTime: 0,           // run_periodic_cleanup
  lastHealthCheckTime: 0,       // Layer 2 health check
  lastKrProgressSyncTime: 0,    // KR 进度同步
  lastHeartbeatTime: 0,         // 心跳巡检
  lastGoalEvalTime: 0,          // goal outer loop evaluation
  lastZombieSweepTime: 0,       // zombie sweep
  lastZombieCleanupTime: 0,     // zombie 资源回收
  lastPipelinePatrolTime: 0,    // pipeline patrol
  lastPipelineWatchdogTime: 0,  // pipeline-level stuck watchdog
  lastKrHealthDailyTime: 0,     // 每日 KR health
  lastCredentialCheckTime: 0,   // credential 过期检查
  lastCleanupWorkerTime: 0,     // R4 orphan worktree cleanup
  lastOrphanPrWorkerTime: 0,    // Phase 1 orphan PR scan

  // === 5 个 loop / consciousness 控制态 ===
  loopTimer: null,              // setInterval 主循环句柄
  recoveryTimer: null,          // 后台恢复 timer
  tickRunning: false,           // tick 互斥锁
  tickLockTime: null,           // 锁起始时间（用于 stuck 检测）
  lastConsciousnessReload: 0    // Phase 2: consciousness cache reload
};

/**
 * 测试专用：把所有 lastXxxTime 归 0，timer 清空，互斥锁释放。
 * 不要在生产代码调用——会清空 setInterval 句柄但不 clearInterval。
 */
export function resetTickStateForTests() {
  tickState.lastExecuteTime = 0;
  tickState.lastCleanupTime = 0;
  tickState.lastHealthCheckTime = 0;
  tickState.lastKrProgressSyncTime = 0;
  tickState.lastHeartbeatTime = 0;
  tickState.lastGoalEvalTime = 0;
  tickState.lastZombieSweepTime = 0;
  tickState.lastZombieCleanupTime = 0;
  tickState.lastPipelinePatrolTime = 0;
  tickState.lastPipelineWatchdogTime = 0;
  tickState.lastKrHealthDailyTime = 0;
  tickState.lastCredentialCheckTime = 0;
  tickState.lastCleanupWorkerTime = 0;
  tickState.lastOrphanPrWorkerTime = 0;
  tickState.loopTimer = null;
  tickState.recoveryTimer = null;
  tickState.tickRunning = false;
  tickState.tickLockTime = null;
  tickState.lastConsciousnessReload = 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase D2.1: 9 个 _resetLastXxxTime 测试 helper 从 tick.js 收口到这里
// 单字段归零，避免 resetTickStateForTests 全清的副作用（测试里只想 reset 一项）
// tick.js 通过 `export { ... } from './tick-state.js'` 做 backwards-compat re-export
// ═══════════════════════════════════════════════════════════════════════════

/** Reset throttle state — for testing only */
export function _resetLastExecuteTime() { tickState.lastExecuteTime = 0; }
/** Reset cleanup timer — for testing only */
export function _resetLastCleanupTime() { tickState.lastCleanupTime = 0; }
/** Reset zombie cleanup timer — for testing only */
export function _resetLastZombieCleanupTime() { tickState.lastZombieCleanupTime = 0; }
/** Reset Layer 2 health check timer — for testing only */
export function _resetLastHealthCheckTime() { tickState.lastHealthCheckTime = 0; }
/** Reset KR progress sync timer — for testing only */
export function _resetLastKrProgressSyncTime() { tickState.lastKrProgressSyncTime = 0; }
/** Reset heartbeat timer — for testing only */
export function _resetLastHeartbeatTime() { tickState.lastHeartbeatTime = 0; }
/** Reset goal eval timer — for testing only */
export function _resetLastGoalEvalTime() { tickState.lastGoalEvalTime = 0; }
/** Reset zombie sweep timer — for testing only */
export function _resetLastZombieSweepTime() { tickState.lastZombieSweepTime = 0; }
/** Reset pipeline patrol timer — for testing only */
export function _resetLastPipelinePatrolTime() { tickState.lastPipelinePatrolTime = 0; }

export default {
  tickState,
  resetTickStateForTests,
  _resetLastExecuteTime,
  _resetLastCleanupTime,
  _resetLastZombieCleanupTime,
  _resetLastHealthCheckTime,
  _resetLastKrProgressSyncTime,
  _resetLastHeartbeatTime,
  _resetLastGoalEvalTime,
  _resetLastZombieSweepTime,
  _resetLastPipelinePatrolTime
};
