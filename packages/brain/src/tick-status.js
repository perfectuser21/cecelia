/**
 * Tick Status — 3 个状态查询函数
 *
 * Phase D2.4: 抽自 tick.js
 * - getTickStatus  (原 tick.js L138-L219)
 * - isStale        (原 tick.js L545-L552)
 * - getStartupErrors (原 tick.js L585-L599)
 *
 * 与 tick.js 解耦，便于 GET /api/brain/tick/status 等只读端点 import
 * 而不拉入完整 tick loop 实现。
 */

import pool from './db.js';
import { checkServerResources, MAX_SEATS, INTERACTIVE_RESERVE } from './executor.js';
import { calculateSlotBudget } from './slot-allocator.js';
import { getAllStates } from './circuit-breaker.js';
import { getCurrentAlertness } from './alertness/index.js';
import { getQuarantineStats } from './quarantine.js';
import { tickState } from './tick-state.js';
import { isDraining, getDrainStartedAt, isPostDrainCooldown } from './drain.js';
import { isTickWatchdogActive } from './tick-watchdog.js';

// 常量（与 tick.js 同源；D2 阶段允许并存，后续可统一收口到 tick-constants.js）
const TICK_INTERVAL_MINUTES = 2;
const TICK_LOOP_INTERVAL_MS = parseInt(process.env.CECELIA_TICK_INTERVAL_MS || '5000', 10);
const DISPATCH_TIMEOUT_MINUTES = parseInt(process.env.DISPATCH_TIMEOUT_MINUTES || '60', 10);
const STALE_THRESHOLD_HOURS = 24;
const MAX_CONCURRENT_TASKS = MAX_SEATS;
const AUTO_DISPATCH_MAX = Math.max(MAX_SEATS - INTERACTIVE_RESERVE, 1);

// Working memory keys
const TICK_ENABLED_KEY = 'tick_enabled';
const TICK_LAST_KEY = 'tick_last';
const TICK_ACTIONS_TODAY_KEY = 'tick_actions_today';
const TICK_LAST_DISPATCH_KEY = 'tick_last_dispatch';
const TICK_STATS_KEY = 'tick_execution_stats';

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

export { getTickStatus, isStale, getStartupErrors };
