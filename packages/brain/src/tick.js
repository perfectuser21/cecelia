/**
 * Action Loop - Tick Mechanism
 * Implements automatic task progression through periodic ticks
 */

// D1.7b: executeTick body 移到 tick-runner.js 后，本文件保留：
// 入口/状态管理（getTickStatus / runTickSafe / startTickLoop / initTickLoop /
// enableTick / disableTick）+ test helpers + Codex immune。executeTick 用到的
// 50+ 模块在 tick-runner.js 内 import；本文件只保留 getTickStatus 等还在用的
// + re-export 给老 caller 的（dispatchNextTask / drainTick 等）。
import pool from './db.js';
import { checkServerResources, MAX_SEATS, INTERACTIVE_RESERVE } from './executor.js';
import { calculateSlotBudget } from './slot-allocator.js';
import { getAllStates } from './circuit-breaker.js';
import { getCurrentAlertness } from './alertness/index.js';
import { getQuarantineStats } from './quarantine.js';
// Phase D Part 1.1: 48h 系统简报搬出 tick.js（仅 re-export）
import { generate48hReport, check48hReport, REPORT_INTERVAL_MS } from './report-48h.js';
// Phase D Part 1.2: drain 子系统搬出 tick.js
import {
  drainTick,
  getDrainStatus,
  cancelDrain,
  isDraining,
  getDrainStartedAt,
  isPostDrainCooldown,
  _getDrainState,
  _resetDrainState,
} from './drain.js';
// Phase D Part 1.3: tick watchdog 搬出 tick.js
import {
  startTickWatchdog,
  stopTickWatchdog,
  isTickWatchdogActive,
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
// Phase D Part 1.7a: 14 个 lastXxxTime + 5 个 loop 控制态收口到 tick-state.js
import { tickState } from './tick-state.js';
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

// Tick log helper — adds [HH:MM:SS] prefix in Asia/Shanghai timezone
const { log: _tickWrite } = console;
// tickLog call counter for periodic summary
let _tickLogCallCount = 0;
function tickLog(...args) {
  const ts = new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  _tickWrite(`[${ts}]`, ...args);
  _tickLogCallCount++;
  if (_tickLogCallCount % 100 === 0) {
    _tickWrite(`[tick-summary] ${_tickLogCallCount} ticks completed`);
  }
}

// Phase D2.2: TICK_INTERVAL_MINUTES / TICK_LOOP_INTERVAL_MS / TICK_TIMEOUT_MS 已搬到 tick-loop.js
// 通过顶部 import 取得，下方 export 块照常 re-export 给老 caller

// Minimal Mode — 只保留心跳 + 手动任务派发，跳过所有自动调度（内容线/巡检/告警）
const MINIMAL_MODE = process.env.BRAIN_MINIMAL_MODE === 'true';
if (MINIMAL_MODE) {
  console.log('[Brain] BRAIN_MINIMAL_MODE=true — 所有自动调度已关闭，只保留心跳和手动任务派发');
}
const STALE_THRESHOLD_HOURS = 24; // Tasks in_progress for more than 24h are stale
const DISPATCH_TIMEOUT_MINUTES = parseInt(process.env.DISPATCH_TIMEOUT_MINUTES || '60', 10); // Auto-fail dispatched tasks after 60 min
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
const TICK_ENABLED_KEY = 'tick_enabled';
const TICK_LAST_KEY = 'tick_last';
const TICK_ACTIONS_TODAY_KEY = 'tick_actions_today';
const TICK_LAST_DISPATCH_KEY = 'tick_last_dispatch';
const TICK_STATS_KEY = 'tick_execution_stats';

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
// REPORT_INTERVAL_MS 已搬到 report-48h.js（Phase D Part 1.1），下方 import re-export

// Phase D Part 1.7a: Recovery timer 也收口到 tickState.recoveryTimer

// Drain state 已搬到 drain.js（Phase D Part 1.2）— 通过 isDraining()/getDrainStartedAt()/isPostDrainCooldown() getter 访问

// Tick watchdog 已搬到 tick-watchdog.js（Phase D Part 1.3）— 通过 isTickWatchdogActive() getter 访问

/**
 * Get tick status
 */
async function getTickStatus() {
  const result = await pool.query(`
    SELECT key, value_json FROM working_memory
    WHERE key IN ($1, $2, $3, $4, $5, $6, $7)
  `, [TICK_ENABLED_KEY, TICK_LAST_KEY, TICK_ACTIONS_TODAY_KEY, TICK_LAST_DISPATCH_KEY, 'startup_errors', 'recovery_attempts', TICK_STATS_KEY]);

  const memory = {};
  for (const row of result.rows) {
    memory[row.key] = row.value_json;
  }

  const enabled = memory[TICK_ENABLED_KEY]?.enabled ?? true;
  const lastTick = memory[TICK_LAST_KEY]?.timestamp || null;
  const actionsToday = memory[TICK_ACTIONS_TODAY_KEY]?.count || 0;

  // Calculate next tick time
  let nextTick = null;
  if (enabled && lastTick) {
    const lastTickDate = new Date(lastTick);
    nextTick = new Date(lastTickDate.getTime() + TICK_INTERVAL_MINUTES * 60 * 1000).toISOString();
  } else if (enabled) {
    nextTick = new Date(Date.now() + TICK_INTERVAL_MINUTES * 60 * 1000).toISOString();
  }

  const lastDispatch = memory[TICK_LAST_DISPATCH_KEY] || null;

  // startup_errors 可观测字段
  const startupErrors = memory['startup_errors'] || null;
  const startupErrorCount = startupErrors?.total_failures || 0;
  const startupOk = startupErrorCount === 0;

  // recovery_attempts 可观测字段
  const recoveryAttempts = memory['recovery_attempts'] || null;

  // Get quarantine stats
  let quarantineStats = { total: 0 };
  try {
    quarantineStats = await getQuarantineStats();
  } catch { /* ignore */ }

  // Get slot allocation budget
  let slotBudget = null;
  try {
    slotBudget = await calculateSlotBudget();
  } catch { /* ignore */ }

  const rawTickStats = memory[TICK_STATS_KEY] || null;
  const tickStats = {
    total_executions: rawTickStats?.total_executions ?? 0,
    last_executed_at: rawTickStats?.last_executed_at ?? null,
    last_duration_ms: rawTickStats?.last_duration_ms ?? null,
  };

  return {
    enabled,
    loop_running: tickState.loopTimer !== null,
    draining: isDraining(),
    drain_started_at: getDrainStartedAt(),
    post_drain_cooldown: isPostDrainCooldown(),
    tick_watchdog_active: isTickWatchdogActive(),
    interval_minutes: TICK_INTERVAL_MINUTES,
    loop_interval_ms: TICK_LOOP_INTERVAL_MS,
    last_tick: lastTick,
    next_tick: nextTick,
    actions_today: actionsToday,
    tick_running: tickState.tickRunning,
    last_dispatch: lastDispatch,
    startup_ok: startupOk,
    startup_error_count: startupErrorCount,
    recovery_timer_active: tickState.recoveryTimer !== null,
    recovery_attempts: recoveryAttempts,
    max_concurrent: MAX_CONCURRENT_TASKS,
    auto_dispatch_max: AUTO_DISPATCH_MAX,
    resources: checkServerResources(),
    slot_budget: slotBudget,
    dispatch_timeout_minutes: DISPATCH_TIMEOUT_MINUTES,
    circuit_breakers: getAllStates(),
    alertness: getCurrentAlertness(),
    quarantine: quarantineStats,
    tick_stats: tickStats,
  };
}

// Phase D2.2: runTickSafe / startTickLoop / stopTickLoop 实现搬到 tick-loop.js，
// 通过顶部 import 取得；下方 export 块统一 re-export，老 caller 不受影响。

// Phase D2.3: _recordRecoveryAttempt / tryRecoverTickLoop / initTickLoop /
// enableTick / disableTick 实现搬到 tick-recovery.js，下方 export 块统一 re-export
import {
  _recordRecoveryAttempt,
  tryRecoverTickLoop,
  initTickLoop,
  enableTick,
  disableTick,
} from './tick-recovery.js';


/**
 * Check if a task is stale (in_progress for too long)
 */
function isStale(task) {
  if (task.status !== 'in_progress') return false;
  if (!task.started_at) return false;

  const startedAt = new Date(task.started_at);
  const hoursElapsed = (Date.now() - startedAt.getTime()) / (1000 * 60 * 60);
  return hoursElapsed > STALE_THRESHOLD_HOURS;
}

// D1.7b: logTickDecision / incrementActionsToday 仅 executeTick body 用，已搬到 tick-runner.js

// Phase D Part 1.4: selectNextDispatchableTask / autoCreateTasksFromCortex / processCortexTask 实现搬到 dispatch-helpers.js，下方 import re-export。

// Phase D Part 1.5: dispatchNextTask 实现搬到 dispatcher.js，下方 import re-export

// Phase D Part 1.6: releaseBlockedTasks + autoFailTimedOutTasks 实现搬到 tick-helpers.js，下方 import

// Phase D Part 1.6: getRampedDispatchMax 实现搬到 tick-helpers.js，下方 import

/**
 * Execute a tick - the core self-driving loop
 *
 * 0. Evaluate alertness level
 * 1. Compare goal progress (Decision Engine)
 * 2. Generate and execute high-confidence decisions
 * 3. Get daily focus OKR
 * 4. Check related task status
 * 5. Auto-fail timed-out tasks
 * 6. Dispatch next task via dispatchNextTask()
 * 7. Log decision
 */

// Phase D Part 1.1: 48h 系统简报实现搬到 report-48h.js，下方 import re-export。
// Phase D Part 1.2: drain 子系统实现搬到 drain.js，下方 import re-export。

/**
 * 读取 working_memory 中的 startup_errors 数据
 * 用于 GET /api/brain/tick/startup-errors 端点
 * @returns {{ errors: Array, total_failures: number, last_error_at: string|null }}
 */
async function getStartupErrors() {
  const result = await pool.query(
    'SELECT value_json FROM working_memory WHERE key = $1',
    ['startup_errors']
  );
  const data = result.rows[0]?.value_json;
  if (!data) {
    return { errors: [], total_failures: 0, last_error_at: null };
  }
  return {
    errors: Array.isArray(data.errors) ? data.errors : [],
    total_failures: data.total_failures || 0,
    last_error_at: data.last_error_at || null
  };
}

// Phase D2.1: 9 个 _resetLastXxxTime 已下沉 tick-state.js
// 下方 export { ... } from './tick-state.js' 保留向后兼容（测试仍 import from './tick.js'）

/**
 * 确保每 20 小时触发一次 Codex 免疫检查
 * 查询最近一条 codex_qa 任务，若超过 20h（或从未有过），自动创建
 * @param {import('pg').Pool} dbPool
 */
export async function ensureCodexImmune(dbPool) {
  const IMMUNE_INTERVAL_MS = 20 * 60 * 60 * 1000; // 20 小时

  const result = await dbPool.query(`
    SELECT created_at FROM tasks
    WHERE task_type = 'codex_qa'
      AND status NOT IN ('cancelled', 'canceled')
    ORDER BY created_at DESC
    LIMIT 1
  `);

  const lastCreatedAt = result.rows[0]?.created_at;
  const elapsed = lastCreatedAt
    ? Date.now() - new Date(lastCreatedAt).getTime()
    : Infinity;

  if (elapsed < IMMUNE_INTERVAL_MS) {
    return { skipped: true, reason: 'too_soon', elapsed_ms: elapsed };
  }

  await dbPool.query(`
    INSERT INTO tasks (title, description, status, priority, task_type, trigger_source)
    VALUES ($1, $2, 'queued', 'P1', 'codex_qa', 'brain_auto')
  `, [
    'Codex 免疫检查 - cecelia-core',
    '/Users/administrator/perfect21/cecelia/quality/scripts/run-codex-immune.sh'
  ]);

  tickLog('[tick] Codex immune task created (last check: ' +
    (lastCreatedAt ? new Date(lastCreatedAt).toISOString() : 'never') + ')');
  return { created: true, elapsed_ms: elapsed };
}

// ═══════════════════════════════════════════════════════════════════════════
// C6: Brain v2 WORKFLOW_RUNTIME env gate
// Phase D Part 1.5: _dispatchViaWorkflowRuntime 实现搬到 dispatcher.js，下方 import re-export

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
