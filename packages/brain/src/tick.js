/**
 * Action Loop - Tick Mechanism
 * Implements automatic task progression through periodic ticks
 */

// D1.7b: executeTick body 移到 tick-runner.js 后，本文件保留：
// 入口/状态管理（getTickStatus / runTickSafe / startTickLoop / initTickLoop /
// enableTick / disableTick）+ test helpers + Codex immune。executeTick 用到的
// 50+ 模块在 tick-runner.js 内 import；本文件只保留 getTickStatus 等还在用的
// + re-export 给老 caller 的（dispatchNextTask / drainTick 等）。
// Phase D2.4: pool 不再需要（getTickStatus / getStartupErrors 已搬到 tick-status.js，_recordRecoveryAttempt 已搬到 tick-recovery.js）
import { MAX_SEATS, INTERACTIVE_RESERVE } from './executor.js';
// Phase D2.4: checkServerResources / calculateSlotBudget / getAllStates / getCurrentAlertness
// / getQuarantineStats 跟 getTickStatus 一起搬到 tick-status.js
// Phase D2.3: initAlertness 随 initTickLoop 搬到 tick-recovery.js（不再 import）
// Phase D Part 1.1: 48h 系统简报搬出 tick.js（仅 re-export）
import { generate48hReport, check48hReport, REPORT_INTERVAL_MS } from './report-48h.js';
// Phase D Part 1.2: drain 子系统搬出 tick.js（仅 re-export 给老 caller / status route）
import {
  drainTick,
  getDrainStatus,
  cancelDrain,
  _getDrainState,
  _resetDrainState,
} from './drain.js';
// Phase D Part 1.3: tick watchdog 搬出 tick.js（仅 re-export，启动循环用 startTickWatchdog）
import {
  startTickWatchdog,
  stopTickWatchdog,
  TICK_WATCHDOG_INTERVAL_MS,
} from './tick-watchdog.js';
// Phase D Part 1.4: dispatch helpers 搬出 tick.js（仅 re-export）
import {
  selectNextDispatchableTask,
  processCortexTask,
} from './dispatch-helpers.js';
// Phase D Part 1.5: dispatchNextTask + _dispatchViaWorkflowRuntime 搬出 tick.js（仅 re-export）
import {
  dispatchNextTask,
  _dispatchViaWorkflowRuntime,
} from './dispatcher.js';
// Phase D Part 1.6: routeTask / autoFailTimedOutTasks / getRampedDispatchMax 搬出 tick.js（仅 re-export）
import {
  routeTask,
  autoFailTimedOutTasks,
  getRampedDispatchMax,
} from './tick-helpers.js';
// Phase D Part 1.7a: tickState 已收口到 tick-state.js；本文件无直接读写需求
// （test helper _resetLastXxxTime 通过下方 export {} from './tick-state.js' re-export）
// Phase D Part 1.7b: executeTick 抽到 tick-runner.js
import { executeTick } from './tick-runner.js';
// Phase D2.2: runTickSafe / startTickLoop / stopTickLoop + 3 个常量抽到 tick-loop.js
import {
  runTickSafe,
  startTickLoop,
  stopTickLoop,
  TICK_INTERVAL_MINUTES,
  TICK_LOOP_INTERVAL_MS,
  TICK_TIMEOUT_MS
} from './tick-loop.js';
// Phase D2.4: getTickStatus / isStale / getStartupErrors 抽到 tick-status.js（仅 re-export）
import { getTickStatus, isStale, getStartupErrors } from './tick-status.js';

// Phase D3: tickLog helper 已无 caller（所有用 tickLog 的函数都搬到子模块各自实现）

// Phase D2.2: TICK_INTERVAL_MINUTES / TICK_LOOP_INTERVAL_MS / TICK_TIMEOUT_MS 已搬到 tick-loop.js
// 通过顶部 import 取得，下方 export 块照常 re-export 给老 caller

// Minimal Mode — 只保留心跳 + 手动任务派发，跳过所有自动调度（内容线/巡检/告警）
const MINIMAL_MODE = process.env.BRAIN_MINIMAL_MODE === 'true';
if (MINIMAL_MODE) {
  console.log('[Brain] BRAIN_MINIMAL_MODE=true — 所有自动调度已关闭，只保留心跳和手动任务派发');
}
// Phase D2.4: STALE_THRESHOLD_HOURS 已随 isStale 搬到 tick-status.js
// 默认 100min = docker container hard timeout (CECELIA_DOCKER_TIMEOUT_MS 默认 90min)
// + 10min buffer for callback processing。
// 旧值 60min 比 docker timeout 小 30min，会在容器还在合法运行时把 task 杀掉。
const DISPATCH_TIMEOUT_MINUTES = parseInt(process.env.DISPATCH_TIMEOUT_MINUTES || '100', 10);
// MAX_SEATS imported from executor.js — calculated from actual resource capacity
const MAX_CONCURRENT_TASKS = MAX_SEATS;
// INTERACTIVE_RESERVE imported from executor.js (also used for threshold calculation)
const AUTO_DISPATCH_MAX = Math.max(MAX_SEATS - INTERACTIVE_RESERVE, 1);
const CLEANUP_INTERVAL_MS = parseInt(process.env.CECELIA_CLEANUP_INTERVAL_MS || String(60 * 60 * 1000), 10); // 1 hour
const ZOMBIE_CLEANUP_INTERVAL_MS = parseInt(process.env.CECELIA_ZOMBIE_CLEANUP_INTERVAL_MS || String(20 * 60 * 1000), 10); // 20 minutes

// D1.7b: AUTO_EXECUTE_CONFIDENCE / UNBLOCK_BATCH_LIMIT / QUARANTINE_RELEASE_LIMIT /
// MAX_REQUEUE_PER_TICK / RECOVERY_DISPATCH_CAP 仅 executeTick body 用，已搬到 tick-runner.js
const MAX_NEW_DISPATCHES_PER_TICK = 2; // burst limiter（仅 re-export，executeTick body 在 tick-runner.js 用）

// Phase D2.3: TICK_AUTO_RECOVER_MINUTES + INIT_RECOVERY_INTERVAL_MS 已搬到 tick-recovery.js

// Phase D Part 1.6: routeTask + TASK_TYPE_AGENT_MAP / PLATFORM_SKILL_MAP 实现搬到 tick-helpers.js，下方 import

// Working memory keys
// Phase D2.4: TICK_LAST_KEY / TICK_ACTIONS_TODAY_KEY / TICK_LAST_DISPATCH_KEY / TICK_STATS_KEY
// 仅 getTickStatus 用，已随其搬到 tick-status.js
// Phase D2.3: TICK_ENABLED_KEY 随 initTickLoop / enableTick / disableTick 搬到 tick-recovery.js

// Phase D Part 1.7a: Loop state + 14 个 lastXxxTime + lastConsciousnessReload 全部收口到 tick-state.js
// 通过 tickState.loopTimer / tickState.tickRunning / tickState.tickLockTime / tickState.recoveryTimer
// 与 tickState.lastXxxTime 访问；下方 _resetLastXxxTime 仅作 backwards-compat 测试导出
// _lastDispatchTime 已搬到 dispatcher.js（Phase D Part 1.5）— 私有计时器
// _lastReportTime 已搬到 report-48h.js（Phase D Part 1.1）

// D1.7b: CONSCIOUSNESS_RELOAD_INTERVAL_MS / CREDENTIAL_CHECK_INTERVAL_MS /
// PIPELINE_WATCHDOG_INTERVAL_MS / CLEANUP_WORKER_INTERVAL_MS / ORPHAN_PR_WORKER_INTERVAL_MS
// 仅 executeTick body 用，已搬到 tick-runner.js
const ZOMBIE_SWEEP_INTERVAL_MS = parseInt(process.env.CECELIA_ZOMBIE_SWEEP_INTERVAL_MS || String(30 * 60 * 1000), 10); // 30 minutes（仅 re-export）
const PIPELINE_PATROL_INTERVAL_MS = parseInt(process.env.CECELIA_PIPELINE_PATROL_INTERVAL_MS || String(5 * 60 * 1000), 10); // 5 minutes（仅 re-export）

const GOAL_EVAL_INTERVAL_MS = parseInt(process.env.CECELIA_GOAL_EVAL_INTERVAL_MS || String(24 * 60 * 60 * 1000), 10); // 24 hours（仅 re-export）
// D 阶段抽出汇总（详见 git log）：
//   D1.1 report-48h.js / D1.2 drain.js / D1.3 tick-watchdog.js
//   D1.4 dispatch-helpers.js / D1.5 dispatcher.js / D1.6 tick-helpers.js
//   D1.7a tick-state.js / D1.7b tick-runner.js (executeTick body)
//   D1.7c plugin1+plugin2 (8 scheduled jobs)
//   D2.1 reset helpers → tick-state.js / D2.2 tick-loop.js
//   D2.3 tick-recovery.js / D2.4 tick-status.js
//   D3 codex-immune.js
import {
  _recordRecoveryAttempt,
  tryRecoverTickLoop,
  initTickLoop,
  enableTick,
  disableTick,
} from './tick-recovery.js';
import { ensureCodexImmune } from './codex-immune.js';

export {
  getTickStatus,
  enableTick,
  disableTick,
  executeTick,
  isStale,
  runTickSafe,
  startTickLoop,
  stopTickLoop,
  initTickLoop,
  tryRecoverTickLoop,
  _recordRecoveryAttempt,
  ensureCodexImmune,
  dispatchNextTask,
  _dispatchViaWorkflowRuntime,
  processCortexTask,
  selectNextDispatchableTask,
  autoFailTimedOutTasks,
  routeTask,
  // Drain mode
  drainTick,
  getDrainStatus,
  cancelDrain,
  _getDrainState,
  _resetDrainState,
  // Tick watchdog
  startTickWatchdog,
  stopTickWatchdog,
  TICK_WATCHDOG_INTERVAL_MS,
  getRampedDispatchMax,
  TICK_INTERVAL_MINUTES,
  TICK_LOOP_INTERVAL_MS,
  TICK_TIMEOUT_MS,
  DISPATCH_TIMEOUT_MINUTES,
  MAX_CONCURRENT_TASKS,
  AUTO_DISPATCH_MAX,
  MAX_NEW_DISPATCHES_PER_TICK,
  getStartupErrors,
  CLEANUP_INTERVAL_MS,
  ZOMBIE_SWEEP_INTERVAL_MS,
  ZOMBIE_CLEANUP_INTERVAL_MS,
  PIPELINE_PATROL_INTERVAL_MS,
  GOAL_EVAL_INTERVAL_MS,
  // 48h 简报
  check48hReport,
  generate48hReport,
  REPORT_INTERVAL_MS
};

// Phase D2.1: Test helper re-export (实现已下沉 tick-state.js，保留 tick.js 兼容入口)
export {
  _resetLastExecuteTime,
  _resetLastCleanupTime,
  _resetLastZombieCleanupTime,
  _resetLastHealthCheckTime,
  _resetLastKrProgressSyncTime,
  _resetLastHeartbeatTime,
  _resetLastGoalEvalTime,
  _resetLastZombieSweepTime,
  _resetLastPipelinePatrolTime
} from './tick-state.js';
