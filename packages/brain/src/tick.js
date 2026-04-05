/**
 * Action Loop - Tick Mechanism
 * Implements automatic task progression through periodic ticks
 */

import crypto from 'crypto';
import pool from './db.js';
import { isGlobalQuotaCooling, getQuotaCoolingState } from './quota-cooling.js';
import { getDailyFocus } from './focus.js';
import { updateTask, createTask } from './actions.js';
import { triggerCeceliaRun, checkCeceliaRunAvailable, getActiveProcessCount, killProcess, checkServerResources, probeTaskLiveness, syncOrphanTasksOnStartup, killProcessTwoStage, requeueTask, MAX_SEATS, INTERACTIVE_RESERVE, getBillingPause } from './executor.js';
import { calculateSlotBudget } from './slot-allocator.js';
import { shouldDowngrade } from './token-budget-planner.js';
import { compareGoalProgress, generateDecision, executeDecision, splitActionsBySafety } from './decision.js';
import { planNextTask } from './planner.js';
import { emit } from './event-bus.js';
import { isAllowed, recordSuccess, recordFailure, getAllStates } from './circuit-breaker.js';
import { publishTaskStarted, publishExecutorStatus } from './events/taskEvents.js';
import { processEvent as thalamusProcessEvent, EVENT_TYPES } from './thalamus.js';
import { executeDecision as executeThalamusDecision, expireStaleProposals } from './decision-executor.js';
import { initAlertness, evaluateAlertness, getCurrentAlertness, canDispatch, canPlan, getDispatchRate, ALERTNESS_LEVELS, LEVEL_NAMES } from './alertness/index.js';
import { getRecoveryStatus } from './alertness/healing.js';
import { recordTickTime, recordOperation } from './alertness/metrics.js';
import { handleTaskFailure, getQuarantineStats, checkExpiredQuarantineTasks } from './quarantine.js';
import { recordDispatchResult, getDispatchStats } from './dispatch-stats.js';
import { runLayer2HealthCheck } from './health-monitor.js';
import { triggerDeptHeartbeats } from './dept-heartbeat.js';
import { triggerDailyReview, triggerContractScan, triggerArchReview } from './daily-review-scheduler.js';
import { generateDailyDiaryIfNeeded } from './diary-scheduler.js';
import { runConversationDigest } from './conversation-digest.js';
import { runCaptureDigestion } from './capture-digestion.js';
import { triggerDailyTopicSelection } from './topic-selection-scheduler.js';
import { triggerDailyPublish } from './daily-publish-scheduler.js';
import { generateDailyReport } from './daily-report-generator.js';
import { generateWeeklyReport } from './weekly-report-generator.js';
import { monitorPublishQueue } from './publish-monitor.js';
import { schedulePostPublishCollection } from './post-publish-data-collector.js';
import { runDesireSystem } from './desire/index.js';
import { runRumination } from './rumination.js';
import { runSynthesisSchedulerIfNeeded } from './rumination-scheduler.js';
import { runSuggestionCycle } from './suggestion-cycle.js';
import { runConversationConsolidator } from './conversation-consolidator.js';
import { feedDailyIfNeeded } from './notebook-feeder.js';
import { publishCognitiveState } from './events/taskEvents.js';
import { evaluateEmotion, getCurrentEmotion, updateSubjectiveTime, getSubjectiveTime, getParallelAwareness, getTrustScores, updateNarrative, recordTickEvent, getCognitiveSnapshot } from './cognitive-core.js';
import { collectSelfReport } from './self-report-collector.js';
import { runDailyConsolidationIfNeeded } from './consolidation.js';
import { sortTasksByWeight } from './task-weight.js';
import { flushAlertsIfNeeded } from './alerting.js';
import { scanEvolutionIfNeeded, synthesizeEvolutionIfNeeded } from './evolution-scanner.js';
import { triggerCodeQualityScan, getScannerStatus } from './task-generator-scheduler.js';
import { zombieSweep } from './zombie-sweep.js';
import { runPipelinePatrol } from './pipeline-patrol.js';
import { memorySyncIfNeeded } from './memory-sync.js';

// Tick configuration
const TICK_INTERVAL_MINUTES = 2;
const TICK_LOOP_INTERVAL_MS = parseInt(process.env.CECELIA_TICK_INTERVAL_MS || '5000', 10); // 5 seconds between loop ticks
const TICK_TIMEOUT_MS = 60 * 1000; // 60 seconds max execution time
const STALE_THRESHOLD_HOURS = 24; // Tasks in_progress for more than 24h are stale
const DISPATCH_TIMEOUT_MINUTES = parseInt(process.env.DISPATCH_TIMEOUT_MINUTES || '60', 10); // Auto-fail dispatched tasks after 60 min
// MAX_SEATS imported from executor.js — calculated from actual resource capacity
const MAX_CONCURRENT_TASKS = MAX_SEATS;
// INTERACTIVE_RESERVE imported from executor.js (also used for threshold calculation)
const AUTO_DISPATCH_MAX = Math.max(MAX_SEATS - INTERACTIVE_RESERVE, 1);
const AUTO_EXECUTE_CONFIDENCE = 0.8; // Auto-execute decisions with confidence >= this
const CLEANUP_INTERVAL_MS = parseInt(process.env.CECELIA_CLEANUP_INTERVAL_MS || String(60 * 60 * 1000), 10); // 1 hour
const ZOMBIE_CLEANUP_INTERVAL_MS = parseInt(process.env.CECELIA_ZOMBIE_CLEANUP_INTERVAL_MS || String(20 * 60 * 1000), 10); // 20 minutes

// 恢复流控：每次 tick 批量释放上限，防止瞬间释放大量任务导致系统过载
const UNBLOCK_BATCH_LIMIT = 5;      // blocked 任务每 tick 最多释放 5 个
const QUARANTINE_RELEASE_LIMIT = 2; // quarantine 任务每 tick 最多释放 2 个
const MAX_REQUEUE_PER_TICK = 2;     // quota_exhausted 任务每 tick 最多梯度 requeue 数量（与 Burst Limiter 协调）
const RECOVERY_DISPATCH_CAP = 0.5;  // 自愈恢复期间派发速率上限（50%）
const MAX_NEW_DISPATCHES_PER_TICK = 2; // burst limiter：单次 tick 最多新派发 N 个，防队列积压后雪崩

// Tick 自动恢复：Brain 重启时若 tick 已 disabled 超过此时长，自动 enable
const TICK_AUTO_RECOVER_MINUTES = parseInt(process.env.TICK_AUTO_RECOVER_MINUTES || '60', 10);

// 后台恢复配置（initTickLoop 所有重试耗尽后使用）
const INIT_RECOVERY_INTERVAL_MS = parseInt(
  process.env.CECELIA_INIT_RECOVERY_INTERVAL_MS || String(5 * 60 * 1000),
  10
);

// Task type to agent skill mapping
const TASK_TYPE_AGENT_MAP = {
  'dev': '/dev',           // Caramel - 编程
  'talk': '/talk',         // 对话任务 → HK MiniMax
  'qa': '/code-review',    // 旧类型 → 已迁移到 /code-review
  'audit': '/code-review', // 旧类型 → 已迁移到 /code-review
  'research': null         // 需要人工/Opus 处理
};

/**
 * Route a task to the appropriate agent based on task_type
 * @param {Object} task - Task object with task_type field
 * @returns {string|null} - Agent skill path or null if requires manual handling
 */
function routeTask(task) {
  const taskType = task.task_type || 'dev';
  const agent = TASK_TYPE_AGENT_MAP[taskType];

  if (agent === undefined) {
    console.warn(`[routeTask] Unknown task_type: ${taskType}, defaulting to /dev`);
    return '/dev';
  }

  return agent;
}

// Working memory keys
const TICK_ENABLED_KEY = 'tick_enabled';
const TICK_LAST_KEY = 'tick_last';
const TICK_ACTIONS_TODAY_KEY = 'tick_actions_today';
const TICK_LAST_DISPATCH_KEY = 'tick_last_dispatch';

// Loop state (in-memory)
let _loopTimer = null;
let _tickRunning = false;
let _tickLockTime = null;
let _lastDispatchTime = 0; // track last dispatch time for logging
let _lastExecuteTime = 0; // track last full executeTick() time for throttling
let _lastCleanupTime = 0; // track last run_periodic_cleanup() call time
let _lastHealthCheckTime = 0; // track last Layer 2 health check time
let _lastKrProgressSyncTime = 0; // track last KR progress sync time
let _lastHeartbeatTime = 0; // track last heartbeat inspection time
let _lastGoalEvalTime = 0; // track last goal outer loop evaluation time
let _lastReportTime = 0; // track last 48h system report generation time
let _lastZombieSweepTime = 0; // track last zombie sweep time
let _lastZombieCleanupTime = 0; // track last zombie resource cleanup time
let _lastPipelinePatrolTime = 0; // track last pipeline patrol time

const ZOMBIE_SWEEP_INTERVAL_MS = parseInt(process.env.CECELIA_ZOMBIE_SWEEP_INTERVAL_MS || String(30 * 60 * 1000), 10); // 30 minutes
const PIPELINE_PATROL_INTERVAL_MS = parseInt(process.env.CECELIA_PIPELINE_PATROL_INTERVAL_MS || String(5 * 60 * 1000), 10); // 5 minutes

const GOAL_EVAL_INTERVAL_MS = parseInt(process.env.CECELIA_GOAL_EVAL_INTERVAL_MS || String(24 * 60 * 60 * 1000), 10); // 24 hours
const REPORT_INTERVAL_MS = parseInt(process.env.CECELIA_REPORT_INTERVAL_MS || String(48 * 60 * 60 * 1000), 10); // 48 hours

// Recovery state (in-memory) — 后台恢复 timer
let _recoveryTimer = null;

// Drain state (in-memory)
let _draining = false;
let _drainStartedAt = null;
let _postDrainCooldown = false;
let _postDrainCooldownTimer = null;

// Tick watchdog timer (in-memory)
let _tickWatchdogTimer = null;
const TICK_WATCHDOG_INTERVAL_MS = parseInt(process.env.CECELIA_TICK_WATCHDOG_INTERVAL_MS || String(5 * 60 * 1000), 10); // 5 minutes

/**
 * Get tick status
 */
async function getTickStatus() {
  const result = await pool.query(`
    SELECT key, value_json FROM working_memory
    WHERE key IN ($1, $2, $3, $4, $5, $6)
  `, [TICK_ENABLED_KEY, TICK_LAST_KEY, TICK_ACTIONS_TODAY_KEY, TICK_LAST_DISPATCH_KEY, 'startup_errors', 'recovery_attempts']);

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

  return {
    enabled,
    loop_running: _loopTimer !== null,
    draining: _draining,
    drain_started_at: _drainStartedAt,
    post_drain_cooldown: _postDrainCooldown,
    tick_watchdog_active: _tickWatchdogTimer !== null,
    interval_minutes: TICK_INTERVAL_MINUTES,
    loop_interval_ms: TICK_LOOP_INTERVAL_MS,
    last_tick: lastTick,
    next_tick: nextTick,
    actions_today: actionsToday,
    tick_running: _tickRunning,
    last_dispatch: lastDispatch,
    startup_ok: startupOk,
    startup_error_count: startupErrorCount,
    recovery_timer_active: _recoveryTimer !== null,
    recovery_attempts: recoveryAttempts,
    max_concurrent: MAX_CONCURRENT_TASKS,
    auto_dispatch_max: AUTO_DISPATCH_MAX,
    resources: checkServerResources(),
    slot_budget: slotBudget,
    dispatch_timeout_minutes: DISPATCH_TIMEOUT_MINUTES,
    circuit_breakers: getAllStates(),
    alertness: getCurrentAlertness(),
    quarantine: quarantineStats
  };
}

/**
 * Run tick with reentry guard and timeout protection
 * @param {string} source - who triggered this tick
 * @param {Function} [tickFn] - optional tick function override (for testing)
 */
async function runTickSafe(source = 'loop', tickFn) {
  const doTick = tickFn || executeTick;

  // Throttle: loop ticks only execute once per TICK_INTERVAL_MINUTES
  if (source === 'loop') {
    const elapsed = Date.now() - _lastExecuteTime;
    const intervalMs = TICK_INTERVAL_MINUTES * 60 * 1000;
    if (_lastExecuteTime > 0 && elapsed < intervalMs) {
      return { skipped: true, reason: 'throttled', source, next_in_ms: intervalMs - elapsed };
    }
  }

  // Reentry guard: check if already running
  if (_tickRunning) {
    // Timeout protection: skip this round to prevent concurrent ticks
    if (_tickLockTime && (Date.now() - _tickLockTime > TICK_TIMEOUT_MS)) {
      console.warn(`[tick-loop] Tick still running after ${TICK_TIMEOUT_MS}ms timeout, skipping this round (source: ${source})`);
      return { skipped: true, reason: 'tick_timeout_still_running', source };
    } else {
      console.log(`[tick-loop] Tick already running, skipping (source: ${source})`);
      return { skipped: true, reason: 'already_running', source };
    }
  }

  _tickRunning = true;
  _tickLockTime = Date.now();

  try {
    const result = await doTick();
    _lastExecuteTime = Date.now();
    console.log(`[tick-loop] Tick completed (source: ${source}), actions: ${result.actions_taken?.length || 0}`);
    return result;
  } catch (err) {
    console.error(`[tick-loop] Tick failed (source: ${source}):`, err.message);
    return { success: false, error: err.message, source };
  } finally {
    _tickRunning = false;
    _tickLockTime = null;
  }
}

/**
 * Start the tick loop (setInterval)
 */
function startTickLoop() {
  if (_loopTimer) {
    console.log('[tick-loop] Loop already running, skipping start');
    return false;
  }

  // 微心跳计数器：每 6 次循环（约 30s）推送一次 idle 状态
  let _microHeartbeatCounter = 0;
  const MICRO_HEARTBEAT_INTERVAL = 6; // 6 × 5s = 30s

  _loopTimer = setInterval(async () => {
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
  if (_loopTimer.unref) {
    _loopTimer.unref();
  }

  console.log(`[tick-loop] Started (interval: ${TICK_LOOP_INTERVAL_MS}ms)`);
  return true;
}

/**
 * Stop the tick loop
 */
function stopTickLoop() {
  if (!_loopTimer) {
    console.log('[tick-loop] No loop running, skipping stop');
    return false;
  }

  clearInterval(_loopTimer);
  _loopTimer = null;
  console.log('[tick-loop] Stopped');
  return true;
}

/**
 * 记录恢复尝试到 working_memory recovery_attempts（尽力写入，失败不影响主流程）
 * @param {boolean} success - 本次恢复是否成功
 * @param {string} [errMessage] - 失败时的错误信息
 */
async function _recordRecoveryAttempt(success, errMessage) {
  try {
    const result = await pool.query(
      'SELECT value_json FROM working_memory WHERE key = $1',
      ['recovery_attempts']
    );
    const existing = result.rows[0]?.value_json || { attempts: [], total_attempts: 0, last_success_at: null };
    const attempts = Array.isArray(existing.attempts) ? existing.attempts : [];
    attempts.push({
      ts: new Date().toISOString(),
      success,
      error: success ? undefined : errMessage
    });
    const updated = {
      attempts: attempts.slice(-50), // 只保留最近50条
      total_attempts: (existing.total_attempts || 0) + 1,
      last_success_at: success ? new Date().toISOString() : existing.last_success_at,
      last_attempt_at: new Date().toISOString()
    };
    await pool.query(`
      INSERT INTO working_memory (key, value_json, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
    `, ['recovery_attempts', updated]);
  } catch {
    // 尽力写入，失败不阻断恢复流程
  }
}

/**
 * 尝试一次恢复启动 tick loop（被后台 timer 调用）
 * 成功时清除 recovery timer；失败时记录并等待下次 timer 触发
 */
async function tryRecoverTickLoop() {
  // 如果 tick loop 已经在运行，停止恢复
  if (_loopTimer) {
    console.log('[tick-loop] Recovery: tick loop already running, clearing recovery timer');
    if (_recoveryTimer) {
      clearInterval(_recoveryTimer);
      _recoveryTimer = null;
    }
    return;
  }

  console.log('[tick-loop] Recovery: attempting to start tick loop...');

  try {
    const { ensureEventsTable } = await import('./event-bus.js');
    await ensureEventsTable();

    const envEnabled = process.env.CECELIA_TICK_ENABLED;
    if (envEnabled === 'true') {
      await enableTick();
    } else {
      const status = await getTickStatus();
      if (status.enabled) {
        startTickLoop();
      } else {
        console.log('[tick-loop] Recovery: tick disabled in DB, skipping');
        await _recordRecoveryAttempt(false, 'tick_disabled_in_db');
        return;
      }
    }

    // 成功：清除恢复 timer 并记录
    console.log('[tick-loop] Recovery: tick loop started successfully, clearing recovery timer');
    if (_recoveryTimer) {
      clearInterval(_recoveryTimer);
      _recoveryTimer = null;
    }
    await _recordRecoveryAttempt(true);
  } catch (err) {
    console.error(`[tick-loop] Recovery attempt failed: ${err.message}`);
    await _recordRecoveryAttempt(false, err.message);
  }
}

/**
 * Initialize tick loop on server startup
 * Checks DB state and starts loop if tick is enabled.
 * If initialization fails, starts a background recovery timer that retries
 * every INIT_RECOVERY_INTERVAL_MS until tick loop is successfully started.
 */
async function initTickLoop() {
  try {
    // Initialize alertness system
    try {
      await initAlertness();
      console.log(`[tick-loop] Alertness system initialized`);
    } catch (alertErr) {
      console.error('[tick-loop] Alertness init failed:', alertErr.message);
    }

    // Ensure EventBus table exists
    const { ensureEventsTable } = await import('./event-bus.js');
    await ensureEventsTable();

    // Auto-enable tick from env var if set
    const envEnabled = process.env.CECELIA_TICK_ENABLED;
    if (envEnabled === 'true') {
      console.log('[tick-loop] CECELIA_TICK_ENABLED=true, auto-enabling tick');
      await enableTick();
      return;
    }

    const status = await getTickStatus();
    if (status.enabled) {
      console.log('[tick-loop] Tick is enabled in DB, starting loop on startup');
      startTickLoop();
    } else {
      // Check if tick has been disabled for too long — auto-recover
      const tickMem = await pool.query(
        `SELECT value_json FROM working_memory WHERE key = $1`,
        [TICK_ENABLED_KEY]
      );
      const tickData = tickMem.rows[0]?.value_json || {};
      const disabledAt = tickData.disabled_at ? new Date(tickData.disabled_at) : null;
      const minutesDisabled = disabledAt
        ? (Date.now() - disabledAt.getTime()) / (1000 * 60)
        : Infinity; // no timestamp = unknown, treat as expired

      if (minutesDisabled >= TICK_AUTO_RECOVER_MINUTES) {
        console.warn(`[tick-loop] Tick disabled for ${Math.round(minutesDisabled)}min (>= ${TICK_AUTO_RECOVER_MINUTES}min threshold), auto-recovering`);
        await enableTick();
        // Write P1 alert event
        try {
          await pool.query(
            `INSERT INTO cecelia_events (event_type, source, payload)
             VALUES ('tick_auto_recover', 'tick', $1)`,
            [JSON.stringify({
              reason: 'tick_was_disabled_too_long',
              disabled_at: disabledAt?.toISOString() || null,
              minutes_disabled: Math.round(minutesDisabled),
              auto_recovered: true,
            })]
          );
        } catch { /* event logging is best-effort */ }
        console.log('[tick-loop] tick_auto_recover: tick re-enabled after extended disable period');
      } else {
        console.log(`[tick-loop] Tick is disabled in DB (${Math.round(minutesDisabled)}min, threshold ${TICK_AUTO_RECOVER_MINUTES}min), not starting loop`);
      }
    }

    // Start tick watchdog — independent timer that checks every 5 minutes
    // If tick is disabled by non-manual source (drain/alertness), auto-recover
    startTickWatchdog();
  } catch (err) {
    console.error('[tick-loop] Failed to init tick loop:', err.message);

    // 启动后台恢复 timer（每 INIT_RECOVERY_INTERVAL_MS 重试一次）
    if (!_recoveryTimer) {
      console.log(`[tick-loop] Starting background recovery timer (interval: ${INIT_RECOVERY_INTERVAL_MS}ms)`);
      _recoveryTimer = setInterval(tryRecoverTickLoop, INIT_RECOVERY_INTERVAL_MS);
      // 允许进程在没有其他活跃引用时正常退出
      if (_recoveryTimer.unref) {
        _recoveryTimer.unref();
      }
    }
  }
}

/**
 * Start tick watchdog — independent timer that periodically checks tick health.
 * If tick is disabled by a non-manual source (drain/alertness), auto-recovers.
 * Only manual disables are respected; all other disables are transient.
 */
function startTickWatchdog() {
  if (_tickWatchdogTimer) {
    console.log('[tick-watchdog] Already running, skipping start');
    return;
  }

  _tickWatchdogTimer = setInterval(async () => {
    try {
      const tickMem = await pool.query(
        `SELECT value_json FROM working_memory WHERE key = $1`,
        [TICK_ENABLED_KEY]
      );
      const tickData = tickMem.rows[0]?.value_json || {};

      if (tickData.enabled === false) {
        const source = tickData.source || 'unknown';

        // Only auto-recover non-manual disables
        if (source === 'manual') {
          // Manual disable — respect it, do not auto-recover
          return;
        }

        console.warn(`[tick-watchdog] Tick is disabled (source: ${source}), auto-recovering...`);
        await enableTick();

        // Log recovery event
        try {
          await pool.query(
            `INSERT INTO cecelia_events (event_type, source, payload)
             VALUES ('tick_watchdog_recover', 'tick_watchdog', $1)`,
            [JSON.stringify({
              reason: 'tick_disabled_by_non_manual_source',
              original_source: source,
              disabled_at: tickData.disabled_at || null,
              recovered_at: new Date().toISOString(),
            })]
          );
        } catch { /* event logging is best-effort */ }
      }
    } catch (err) {
      console.error('[tick-watchdog] Error checking tick status:', err.message);
    }
  }, TICK_WATCHDOG_INTERVAL_MS);

  if (_tickWatchdogTimer.unref) {
    _tickWatchdogTimer.unref();
  }

  console.log(`[tick-watchdog] Started (interval: ${TICK_WATCHDOG_INTERVAL_MS}ms)`);
}

/**
 * Stop tick watchdog timer
 */
function stopTickWatchdog() {
  if (_tickWatchdogTimer) {
    clearInterval(_tickWatchdogTimer);
    _tickWatchdogTimer = null;
    console.log('[tick-watchdog] Stopped');
  }
}

/**
 * Enable automatic tick
 */
async function enableTick() {
  await pool.query(`
    INSERT INTO working_memory (key, value_json, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
  `, [TICK_ENABLED_KEY, { enabled: true }]);

  startTickLoop();

  return { success: true, enabled: true, loop_running: true };
}

/**
 * Disable automatic tick
 * @param {string} source - 'manual' | 'drain' | 'alertness' — watchdog 只恢复非 manual 的
 */
async function disableTick(source = 'manual') {
  await pool.query(`
    INSERT INTO working_memory (key, value_json, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
  `, [TICK_ENABLED_KEY, { enabled: false, disabled_at: new Date().toISOString(), source }]);

  stopTickLoop();

  return { success: true, enabled: false, loop_running: false, source };
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
 * Log a decision internally
 */
async function logTickDecision(trigger, inputSummary, decision, result) {
  await pool.query(`
    INSERT INTO decision_log (trigger, input_summary, llm_output_json, action_result_json, status)
    VALUES ($1, $2, $3, $4, $5)
  `, [
    trigger,
    inputSummary,
    decision,
    result,
    result?.success ? 'success' : 'failed'
  ]);
}

/**
 * Update actions count for today
 */
async function incrementActionsToday(count = 1) {
  const today = new Date().toISOString().split('T')[0];

  // Get current count
  const result = await pool.query(
    'SELECT value_json FROM working_memory WHERE key = $1',
    [TICK_ACTIONS_TODAY_KEY]
  );

  const current = result.rows[0]?.value_json || { date: today, count: 0 };

  // Reset if new day
  const newCount = current.date === today ? current.count + count : count;

  await pool.query(`
    INSERT INTO working_memory (key, value_json, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
  `, [TICK_ACTIONS_TODAY_KEY, { date: today, count: newCount }]);

  return newCount;
}

/**
 * Select the next dispatchable task from queued tasks.
 * Skips tasks with unmet dependencies (payload.depends_on).
 * Returns null if no dispatchable task found.
 *
 * @param {string[]} goalIds - Goal IDs to scope the query
 * @param {string[]} [excludeIds=[]] - Task IDs to exclude (e.g. pre-flight failures)
 * @returns {Object|null} - The next task to dispatch, or null
 */
async function selectNextDispatchableTask(goalIds, excludeIds = []) {
  // Check if P2 tasks should be paused (alertness mitigation)
  const { getMitigationState } = await import('./alertness-actions.js');
  const mitigationState = getMitigationState();

  // Query queued tasks with payload for dependency checking
  // Watchdog backoff: skip tasks with next_run_at in the future
  // next_run_at is always written as UTC ISO-8601 by requeueTask().
  // Safety: NULL, empty string, or unparseable values are treated as "no backoff".
  // goalIds=null 表示不按 goal 过滤（派发任何可用任务），
  // goalIds=[] 或数组时按 goal_id 过滤（含 goal_id IS NULL）
  const queryParams = [];
  let goalCondition;
  if (goalIds == null) {
    goalCondition = '(1=1)';
  } else {
    queryParams.push(goalIds);
    goalCondition = `(t.goal_id = ANY($${queryParams.length}) OR t.goal_id IS NULL)`;
  }
  let excludeClause = '';
  if (excludeIds.length > 0) {
    queryParams.push(excludeIds);
    excludeClause = `AND t.id != ALL($${queryParams.length})`;
  }
  const result = await pool.query(`
    SELECT t.id, t.title, t.description, t.prd_content, t.status, t.priority, t.started_at, t.updated_at, t.payload,
           t.queued_at, t.task_type, t.created_at, t.metadata, t.project_id
    FROM tasks t
    WHERE ${goalCondition}
      AND t.status = 'queued'
      AND t.task_type NOT IN ('content-export', 'content-research', 'content-copywriting', 'content-copy-review', 'content-generate', 'content-image-review')
      ${excludeClause}
      AND (
        t.payload->>'next_run_at' IS NULL
        OR t.payload->>'next_run_at' = ''
        OR (t.payload->>'next_run_at')::timestamptz <= NOW()
      )
      AND (
        t.project_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM tasks t2
          WHERE t2.project_id = t.project_id
            AND t2.status = 'in_progress'
            AND t2.id != t.id
            AND t2.task_type != 'content-pipeline'
        )
      )
    ORDER BY
      CASE t.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
      t.created_at ASC
  `, queryParams);

  // Apply weight-based sorting on top of the DB result
  // This allows dynamic adjustment (wait time, retry count, task type) without changing SQL
  const weightedTasks = sortTasksByWeight(result.rows);

  for (const task of weightedTasks) {
    // Skip P2 tasks if mitigation is active (EMERGENCY+ state)
    if (mitigationState.p2_paused && task.priority === 'P2') {
      console.log(`[tick] Skipping P2 task ${task.id} (alertness mitigation active)`);
      continue;
    }

    const dependsOn = task.payload?.depends_on;
    if (Array.isArray(dependsOn) && dependsOn.length > 0) {
      // Check if all dependencies are resolved (completed or cancelled — both unblock downstream)
      const depResult = await pool.query(
        "SELECT COUNT(*) FROM tasks WHERE id = ANY($1) AND status NOT IN ('completed', 'cancelled', 'canceled')",
        [dependsOn]
      );
      if (parseInt(depResult.rows[0].count) > 0) {
        continue; // Skip: has unmet dependencies
      }
    }
    return task;
  }
  return null;
}

/**
 * 从皮层 RCA 结果中自动创建建议任务
 * @param {Object} rcaResult - performRCA 返回的分析结果
 * @param {Object} context - { goal_id, project_id } 继承自失败任务（可选）
 * @returns {Promise<Array>} - 创建的任务列表（含 deduplicated 字段）
 */
async function autoCreateTasksFromCortex(rcaResult, context = {}) {
  const createTaskActions = (rcaResult.recommended_actions || [])
    .filter(a => a.type === 'create_task' && a.params?.title);

  if (createTaskActions.length === 0) return [];

  const created = [];
  for (const action of createTaskActions) {
    try {
      const result = await createTask({
        title: action.params.title,
        description: action.params.description || '',
        priority: action.params.priority || 'P1',
        task_type: action.params.task_type || 'dev',
        trigger_source: 'cortex',
        goal_id: action.params.goal_id || context.goal_id || null,
        project_id: action.params.project_id || context.project_id || null,
      });
      created.push({ title: action.params.title, deduplicated: result.deduplicated || false });
      console.log(`[tick] autoCreateTasksFromCortex: "${action.params.title}" created (dedup=${result.deduplicated || false})`);
    } catch (err) {
      console.error(`[tick] autoCreateTasksFromCortex: failed to create "${action.params.title}": ${err.message}`);
    }
  }
  return created;
}

/**
 * Process Cortex task (Brain-internal RCA analysis)
 * @param {Object} task - Task requiring Cortex processing
 * @param {Array} actions - Actions array to append to
 * @returns {Promise<Object>} - Dispatch result
 */
async function processCortexTask(task, actions) {
  try {
    console.log(`[tick] Processing Cortex task: ${task.title} (id=${task.id})`);

    // Update status to in_progress
    await updateTask({ task_id: task.id, status: 'in_progress' });
    actions.push({ action: 'cortex-start', task_id: task.id, title: task.title });

    // Import Cortex module
    const { performRCA } = await import('./cortex.js');

    // Extract signals from payload
    const signals = task.payload.signals || {};
    const trigger = task.payload.trigger || 'unknown';

    // Execute RCA analysis
    const rcaResult = await performRCA(
      { id: task.id, title: task.title, description: task.description, payload: task.payload },
      [] // history - can be enhanced later
    );

    // Save analysis results to cecelia_events
    await pool.query(`
      INSERT INTO cecelia_events (event_type, source, payload)
      VALUES ($1, $2, $3)
    `, ['cortex_rca_complete', 'cortex', JSON.stringify({
      task_id: task.id,
      trigger,
      analysis: rcaResult.analysis,
      recommended_actions: rcaResult.recommended_actions,
      learnings: rcaResult.learnings,
      confidence: rcaResult.confidence,
      completed_at: new Date().toISOString()
    })]);

    // Auto-create tasks from cortex create_task recommendations
    try {
      const createdTasks = await autoCreateTasksFromCortex(rcaResult, {
        goal_id: task.payload.goal_id || null,
        project_id: task.payload.project_id || null,
      });
      if (createdTasks.length > 0) {
        actions.push({ action: 'cortex-tasks-created', count: createdTasks.length });
      }
    } catch (autoCreateErr) {
      console.error(`[tick] autoCreateTasksFromCortex error: ${autoCreateErr.message}`);
    }

    // If this is a learning task, record learning and apply strategy adjustments
    if (task.payload.requires_learning === true) {
      try {
        const { recordLearning, applyStrategyAdjustments } = await import('./learning.js');

        // Record learning
        const learningRecord = await recordLearning(rcaResult);
        console.log(`[tick] Learning recorded: ${learningRecord.id}`);

        // Apply strategy adjustments if any
        const strategyAdjustments = rcaResult.recommended_actions?.filter(
          action => action.type === 'adjust_strategy'
        ) || [];

        if (strategyAdjustments.length > 0) {
          const applyResult = await applyStrategyAdjustments(strategyAdjustments, learningRecord.id);
          console.log(`[tick] Strategy adjustments applied: ${applyResult.applied}, skipped: ${applyResult.skipped}`);
        }
      } catch (learningErr) {
        console.error(`[tick] Learning processing failed: ${learningErr.message}`);
        // Don't fail the task, just log the error
      }
    }

    // Update task to completed with result in payload
    const updatedPayload = {
      ...task.payload,
      rca_result: {
        root_cause: rcaResult.analysis.root_cause,
        mitigations: rcaResult.recommended_actions?.slice(0, 3),
        confidence: rcaResult.confidence,
        completed_at: new Date().toISOString()
      }
    };
    await pool.query(`
      UPDATE tasks SET status = $1, payload = $2, completed_at = NOW(), updated_at = NOW()
      WHERE id = $3
    `, ['completed', JSON.stringify(updatedPayload), task.id]);

    console.log(`[tick] Cortex task completed: ${task.id}, confidence=${rcaResult.confidence}`);

    actions.push({
      action: 'cortex-complete',
      task_id: task.id,
      confidence: rcaResult.confidence,
      learnings_count: rcaResult.learnings?.length || 0
    });

    return {
      dispatched: true,
      reason: 'cortex_processed',
      task_id: task.id,
      actions
    };

  } catch (err) {
    console.error(`[tick] Cortex task failed: ${err.message}`);

    // Record error details in payload
    await pool.query(
      `UPDATE tasks SET payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
      [task.id, JSON.stringify({
        rca_error: { error: err.message, failed_at: new Date().toISOString() }
      })]
    );

    // Use handleTaskFailure for quarantine check (repeated failures → auto-quarantine)
    const quarantineResult = await handleTaskFailure(task.id);
    if (quarantineResult.quarantined) {
      console.log(`[tick] Cortex task ${task.id} quarantined: ${quarantineResult.result?.reason}`);
      actions.push({
        action: 'cortex-quarantined',
        task_id: task.id,
        error: err.message,
        reason: quarantineResult.result?.reason
      });
    } else {
      // Not quarantined — mark as failed normally
      await updateTask({ task_id: task.id, status: 'failed' });
      actions.push({
        action: 'cortex-failed',
        task_id: task.id,
        error: err.message,
        failure_count: quarantineResult.failure_count
      });
    }

    return {
      dispatched: false,
      reason: 'cortex_error',
      task_id: task.id,
      error: err.message,
      actions
    };
  }
}

/**
 * Dispatch the next queued task for execution.
 * Checks concurrency limit, executor availability, and dependencies.
 *
 * @param {string[]} goalIds - Goal IDs to scope the dispatch
 * @returns {Object} - Dispatch result with actions taken
 */
async function dispatchNextTask(goalIds) {
  const actions = [];

  // 0. Drain check — skip dispatch if draining (let in_progress tasks finish)
  // Also check alertness-requested drain mode
  const { getMitigationState } = await import('./alertness-actions.js');
  const mitigationState = getMitigationState();

  if (_draining || mitigationState.drain_mode_requested) {
    await recordDispatchResult(pool, false, 'draining');
    return {
      dispatched: false,
      reason: 'draining',
      detail: _draining ? `Drain mode active since ${_drainStartedAt}` : 'Alertness COMA drain mode',
      actions
    };
  }

  // 0a-pre. Quota cooling check — 全局 quota 冷却期内跳过派发
  let _qcActive = false;
  try {
    _qcActive = isGlobalQuotaCooling();
  } catch (qcErr) {
    console.error('[tick] quota_cooling_check_error (non-fatal):', qcErr.message);
  }
  if (_qcActive) {
    const qcState = getQuotaCoolingState();
    console.log(`[tick] quota cooling until: ${qcState.until}`);
    return { skipped: true, reason: 'quota_cooling' };
  }

  // 0a. Billing pause check — quota_exhausted 全局熔断
  const billingPause = getBillingPause();
  if (billingPause.active) {
    console.log(`[tick] Billing pause active until ${billingPause.resetTime} (${billingPause.reason}), skipping dispatch`);
    await recordDispatchResult(pool, false, 'billing_pause');
    return {
      dispatched: false,
      reason: 'billing_pause',
      detail: `Billing pause active until ${billingPause.resetTime}`,
      actions
    };
  }

  // 0. Three-pool slot budget check (replaces flat MAX_SEATS - INTERACTIVE_RESERVE)
  const slotBudget = await calculateSlotBudget();
  if (!slotBudget.dispatchAllowed) {
    // Eviction: if a high-priority task is waiting, try to evict a low-priority one
    try {
      // Peek at the next queued task to check its priority
      const peekResult = await pool.query(`
        SELECT priority FROM tasks WHERE status = 'queued'
        ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 ELSE 9 END, created_at ASC
        LIMIT 1
      `);
      const nextPriority = peekResult.rows[0]?.priority;
      if (nextPriority === 'P0' || nextPriority === 'P1') {
        const { findEvictionCandidate, requeueEvictedTask } = await import('./eviction.js');
        const candidate = await findEvictionCandidate(nextPriority);
        if (candidate) {
          console.log(`[tick] Eviction: ${nextPriority} task waiting, evicting ${candidate.priority} task=${candidate.taskId} (score=${candidate.score.toFixed(1)})`);
          const evictKill = await killProcessTwoStage(candidate.taskId, candidate.pgid);
          if (evictKill.killed) {
            // Emergency cleanup for evicted task
            try {
              const { emergencyCleanup } = await import('./emergency-cleanup.js');
              if (candidate.slot) emergencyCleanup(candidate.taskId, candidate.slot);
            } catch { /* non-fatal */ }
            await requeueEvictedTask(candidate.taskId, candidate.priority, `evicted_for_${nextPriority}`);
            const { cleanupMetrics } = await import('./watchdog.js');
            cleanupMetrics(candidate.taskId);
            actions.push({ action: 'eviction', evicted_task: candidate.taskId, evicted_priority: candidate.priority, for_priority: nextPriority });
            // Don't return - fall through to re-check budget and continue dispatch
          }
        }
      }
    } catch (evictionErr) {
      console.error(`[tick] Eviction error (non-fatal): ${evictionErr.message}`);
    }

    // Re-check budget after potential eviction
    const slotBudgetAfter = await calculateSlotBudget();
    if (!slotBudgetAfter.dispatchAllowed) {
      // Xian bypass: xian-type tasks use independent Codex Bridge pool, not task_pool.
      // Allow them through when codex pool has capacity, even if task_pool is full.
      let xianBypass = false;
      if (slotBudgetAfter.codex?.available) {
        try {
          const { getTaskLocation } = await import('./task-router.js');
          const peekXian = await pool.query(`
            SELECT task_type FROM tasks WHERE status = 'queued'
            ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 ELSE 9 END, created_at ASC
            LIMIT 1
          `);
          const nextType = peekXian.rows[0]?.task_type;
          if (nextType && getTaskLocation(nextType) === 'xian') {
            console.log(`[tick] Codex xian bypass: task_pool full but codex pool available for task_type=${nextType}`);
            xianBypass = true;
          }
        } catch (bypassErr) {
          console.warn(`[tick] xian bypass check failed (non-fatal): ${bypassErr.message}`);
        }
      }
      if (!xianBypass) {
        const slotReason = slotBudget.user.mode === 'team' ? 'user_team_mode' :
                           slotBudget.taskPool.budget === 0 ? 'pool_exhausted' : 'pool_c_full';
        await recordDispatchResult(pool, false, slotReason);
        return {
          dispatched: false,
          reason: slotReason,
          budget: slotBudgetAfter,
          actions,
        };
      }
    }
  }

  // 2. Circuit breaker check
  if (!isAllowed('cecelia-run')) {
    await recordDispatchResult(pool, false, 'circuit_breaker_open');
    return { dispatched: false, reason: 'circuit_breaker_open', actions };
  }

  // 3. Select next task (with dependency check + pre-flight validation)
  //    If pre-flight fails, skip that task and try the next candidate (max 5 retries)
  const MAX_PRE_FLIGHT_RETRIES = 5;
  const preFlightFailedIds = [];
  let nextTask = null;

  const { preFlightCheck } = await import('./pre-flight-check.js');

  for (let attempt = 0; attempt <= MAX_PRE_FLIGHT_RETRIES; attempt++) {
    const candidate = await selectNextDispatchableTask(goalIds, preFlightFailedIds);
    if (!candidate) {
      return { dispatched: false, reason: 'no_dispatchable_task', actions };
    }

    // 3a. Check if task requires Cortex processing (Brain-internal RCA)
    if (candidate.payload && candidate.payload.requires_cortex === true) {
      return await processCortexTask(candidate, actions);
    }

    // 3b. Pre-flight Check — validate task quality before dispatch
    const checkResult = await preFlightCheck(candidate);
    if (checkResult.passed) {
      nextTask = candidate;
      break;
    }

    // Pre-flight failed — record and skip to next candidate
    console.warn(`[dispatch] Pre-flight check failed for task ${candidate.id} (attempt ${attempt + 1}/${MAX_PRE_FLIGHT_RETRIES + 1}):`, checkResult.issues);
    await pool.query(
      `UPDATE tasks SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
      [candidate.id, JSON.stringify({
        pre_flight_failed: true,
        pre_flight_issues: checkResult.issues,
        pre_flight_suggestions: checkResult.suggestions,
        failed_at: new Date().toISOString()
      })]
    );
    await recordDispatchResult(pool, false, 'pre_flight_check_failed');
    preFlightFailedIds.push(candidate.id);
  }

  if (!nextTask) {
    return { dispatched: false, reason: 'all_candidates_failed_pre_flight', skipped: preFlightFailedIds.length, actions };
  }

  // 3c. Initiative-level lock: double-check before marking in_progress (guard against race)
  if (nextTask.project_id) {
    const lockCheck = await pool.query(
      "SELECT id, title FROM tasks WHERE project_id = $1 AND status = 'in_progress' AND id != $2 LIMIT 1",
      [nextTask.project_id, nextTask.id]
    );
    if (lockCheck.rows.length > 0) {
      const blocker = lockCheck.rows[0];
      console.log(`[dispatch] Initiative 已有进行中任务 (task_id: ${blocker.id})，跳过派发: ${nextTask.title}`);
      await recordDispatchResult(pool, false, 'initiative_locked');
      return { dispatched: false, reason: 'initiative_locked', blocking_task_id: blocker.id, task_id: nextTask.id, actions };
    }
  }

  // 3d. Codex Pool D: check concurrent limit for Codex-native task types
  const isCodexNativeTask = nextTask.task_type === 'codex_qa' || nextTask.task_type === 'codex_dev' || nextTask.task_type === 'codex_test_gen';
  if (isCodexNativeTask) {
    const codexSlots = slotBudget?.codex;
    if (codexSlots && !codexSlots.available) {
      console.log(`[dispatch] Codex pool full (${codexSlots.running}/${codexSlots.max}), skipping codex task ${nextTask.id}`);
      await recordDispatchResult(pool, false, 'codex_pool_full');
      return { dispatched: false, reason: 'codex_pool_full', codex_running: codexSlots.running, codex_max: codexSlots.max, task_id: nextTask.id, actions };
    }
  }

  // 4. Update task status to in_progress
  const updateResult = await updateTask({
    task_id: nextTask.id,
    status: 'in_progress'
  });

  if (!updateResult.success) {
    return { dispatched: false, reason: 'update_failed', task_id: nextTask.id, actions };
  }

  actions.push({
    action: 'update-task',
    task_id: nextTask.id,
    title: nextTask.title,
    status: 'in_progress'
  });

  // 5. Check executor availability and trigger
  const ceceliaAvailable = await checkCeceliaRunAvailable();
  if (!ceceliaAvailable.available) {
    // Revert task to queued so it can be retried next tick
    await updateTask({ task_id: nextTask.id, status: 'queued' });
    await logTickDecision(
      'tick',
      `cecelia-run not available, task reverted to queued`,
      { action: 'no-executor', task_id: nextTask.id, reason: ceceliaAvailable.error },
      { success: false, warning: 'cecelia-run not available, task reverted to queued' }
    );
    await recordDispatchResult(pool, false, 'no_executor');
    return { dispatched: false, reason: 'no_executor', task_id: nextTask.id, actions };
  }

  const fullTaskResult = await pool.query('SELECT * FROM tasks WHERE id = $1', [nextTask.id]);
  if (fullTaskResult.rows.length === 0) {
    await recordDispatchResult(pool, false, 'task_not_found');
    return { dispatched: false, reason: 'task_not_found', task_id: nextTask.id, actions };
  }

  // Budget-aware executor downgrade：
  // 当 Claude 7day 配额紧张（tight/critical）时，将可降级的任务（dev/code_review）
  // 自动路由到 Codex（设置 provider=codex），节省 Claude token。
  let taskToDispatch = fullTaskResult.rows[0];
  try {
    const budgetState = slotBudget?.budgetState?.state || 'abundant';
    const taskType = taskToDispatch.task_type || 'dev';
    if (shouldDowngrade(taskType, budgetState)) {
      console.log(`[dispatch] budget_state=${budgetState} → downgrade task=${taskToDispatch.id} type=${taskType} to codex`);
      taskToDispatch = {
        ...taskToDispatch,
        provider: 'codex',
        _downgraded: true,
        _downgrade_reason: `budget_state=${budgetState}`,
      };
    }
  } catch (err) {
    console.warn(`[dispatch] shouldDowngrade check failed: ${err.message}, proceeding with original executor`);
  }

  const execResult = await triggerCeceliaRun(taskToDispatch);

  // 5a. Check if executor actually succeeded — revert to queued if not
  if (!execResult.success) {
    console.warn(`[dispatch] triggerCeceliaRun failed for task ${nextTask.id}: ${execResult.error || execResult.reason}`);
    await updateTask({ task_id: nextTask.id, status: 'queued' });
    await recordFailure('cecelia-run');
    await logTickDecision(
      'tick',
      `Executor failed, task reverted to queued: ${execResult.error || execResult.reason}`,
      { action: 'executor_failed', task_id: nextTask.id, reason: execResult.reason, error: execResult.error },
      { success: false }
    );
    await recordDispatchResult(pool, false, 'executor_failed');
    return { dispatched: false, reason: 'executor_failed', task_id: nextTask.id, error: execResult.error || execResult.reason, actions };
  }

  _lastDispatchTime = Date.now();

  // Publish WebSocket event: task started (non-blocking, errors don't break dispatch)
  try {
    publishTaskStarted({
      id: nextTask.id,
      run_id: execResult.runId,
      title: nextTask.title
    });

    // Executor status is now available via GET /api/brain/slots (slot budget)
  } catch (wsErr) {
    console.error(`[tick] WebSocket broadcast failed: ${wsErr.message}`);
  }

  await emit('task_dispatched', 'tick', {
    task_id: nextTask.id,
    title: nextTask.title,
    run_id: execResult.runId,
    success: execResult.success
  });

  // Record dispatch info in working_memory
  await pool.query(`
    INSERT INTO working_memory (key, value_json, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
  `, [TICK_LAST_DISPATCH_KEY, {
    task_id: nextTask.id,
    task_title: nextTask.title,
    run_id: execResult.runId,
    dispatched_at: new Date().toISOString(),
    success: execResult.success
  }]);

  await logTickDecision(
    'tick',
    `Dispatched cecelia-run for task: ${nextTask.title}`,
    { action: 'dispatch', task_id: nextTask.id, run_id: execResult.runId },
    execResult
  );

  actions.push({
    action: 'dispatch',
    task_id: nextTask.id,
    title: nextTask.title,
    run_id: execResult.runId,
    success: execResult.success
  });

  // Record pre-flight check statistics
  try {
    const { getPreFlightStats } = await import('./pre-flight-check.js');
    const stats = await getPreFlightStats(pool);
    await pool.query(`
      INSERT INTO working_memory (key, value_json, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
    `, ['pre_flight_stats', stats]);
  } catch (statsErr) {
    console.error(`[dispatch] Failed to record pre-flight stats: ${statsErr.message}`);
  }

  // Record dispatch success to rolling window stats
  await recordDispatchResult(pool, true);

  return { dispatched: true, task_id: nextTask.id, run_id: execResult.runId, actions };
}

/**
 * Auto-fail tasks that have been in_progress longer than DISPATCH_TIMEOUT_MINUTES.
 * Checks if task should be quarantined after failure.
 *
 * @param {Object[]} inProgressTasks - Tasks currently in_progress (must include payload, started_at)
 * @returns {Object[]} - Actions taken
 */
/**
 * 自动释放 blocked_until 已到期的 blocked 任务，将其状态改回 queued
 * @returns {Promise<Array<{task_id, title, blocked_reason, blocked_duration_ms}>>}
 */
async function releaseBlockedTasks() {
  const result = await pool.query(`
    UPDATE tasks
    SET status = 'queued',
        blocked_at = NULL,
        blocked_reason = NULL,
        blocked_until = NULL,
        updated_at = NOW()
    WHERE status = 'blocked' AND blocked_until <= NOW()
    RETURNING id AS task_id, title, blocked_reason,
              EXTRACT(EPOCH FROM (NOW() - blocked_at)) * 1000 AS blocked_duration_ms
  `);
  return result.rows;
}

async function autoFailTimedOutTasks(inProgressTasks) {
  const actions = [];
  for (const task of inProgressTasks) {
    const triggeredAt = task.payload?.run_triggered_at || task.started_at;
    if (!triggeredAt) continue;

    const elapsed = (Date.now() - new Date(triggeredAt).getTime()) / (1000 * 60);
    if (elapsed > DISPATCH_TIMEOUT_MINUTES) {
      // Kill the actual process before marking failed to prevent orphans
      killProcess(task.id);
      // Write structured error details for retry-analyzer
      const errorDetails = {
        type: 'timeout',
        message: `Task timed out after ${Math.round(elapsed)} minutes (limit: ${DISPATCH_TIMEOUT_MINUTES}min)`,
        elapsed_minutes: Math.round(elapsed),
        timeout_limit: DISPATCH_TIMEOUT_MINUTES,
      };
      await pool.query(
        `UPDATE tasks SET payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
        [task.id, JSON.stringify({ error_details: errorDetails })]
      );

      // Check if task should be quarantined
      const quarantineResult = await handleTaskFailure(task.id);
      if (quarantineResult.quarantined) {
        console.log(`[tick] Task ${task.id} quarantined: ${quarantineResult.result?.reason}`);
        actions.push({
          action: 'quarantine',
          task_id: task.id,
          title: task.title,
          reason: quarantineResult.result?.reason,
          elapsed_minutes: Math.round(elapsed)
        });
      } else {
        // Not quarantined yet — requeue for retry (failure_count already incremented by handleTaskFailure)
        // Clearing started_at prevents immediate re-timeout on next tick evaluation
        await pool.query(
          `UPDATE tasks SET status = 'queued', started_at = NULL, updated_at = NOW() WHERE id = $1`,
          [task.id]
        );
        actions.push({
          action: 'auto-requeue-timeout',
          task_id: task.id,
          title: task.title,
          elapsed_minutes: Math.round(elapsed),
          failure_count: quarantineResult.failure_count,
          retry_attempt: quarantineResult.failure_count
        });
      }

      await recordFailure('cecelia-run');
      await emit('patrol_cleanup', 'patrol', {
        task_id: task.id,
        title: task.title,
        elapsed_minutes: Math.round(elapsed)
      });
      await logTickDecision(
        'tick',
        `Auto-requeued timed-out task: ${task.title} (${Math.round(elapsed)}min, attempt ${quarantineResult.failure_count})`,
        { action: 'auto-requeue-timeout', task_id: task.id, quarantined: quarantineResult.quarantined },
        { success: true, elapsed_minutes: Math.round(elapsed) }
      );
    }
  }
  return actions;
}

/**
 * Get ramped dispatch max - gradually increase/decrease dispatch rate
 * based on system load and alertness level.
 *
 * @param {number} effectiveDispatchMax - The calculated dispatch max from slot budget
 * @returns {Promise<number>} The ramped dispatch max (0 to effectiveDispatchMax)
 */
async function getRampedDispatchMax(effectiveDispatchMax) {
  // Read current ramp state from working_memory
  const stateResult = await pool.query(`
    SELECT value_json FROM working_memory WHERE key = 'dispatch_ramp_state'
  `);

  // Cold start: no ramp record → start at min(2, max) to avoid burst on restart
  // (Having no ramp record means Brain just restarted — avoid immediately dispatching 9 tasks)
  let currentRate = stateResult.rows.length > 0
    ? (stateResult.rows[0].value_json.current_rate || effectiveDispatchMax)
    : Math.min(2, effectiveDispatchMax);

  // Check current system resources and alertness
  const resources = checkServerResources();
  const pressure = resources.metrics.max_pressure;
  const alertness = getCurrentAlertness();

  // Decide rate adjustment based on load
  let newRate = currentRate;
  let reason = 'stable';

  if (alertness.level >= ALERTNESS_LEVELS.ALERT) {
    // High alertness - exponential decay (/2 instead of -1)
    newRate = Math.max(0, Math.floor(currentRate / 2));
    reason = `alertness=${alertness.levelName}`;
  } else if (pressure > 0.9) {
    // Critical pressure - force to 1
    newRate = 1;
    reason = `pressure_critical=${pressure.toFixed(2)}`;
  } else if (pressure > 0.8) {
    // High pressure - exponential decay
    newRate = Math.max(1, Math.floor(currentRate / 2));
    reason = `pressure=${pressure.toFixed(2)}`;
  } else if (pressure < 0.5 && alertness.level <= ALERTNESS_LEVELS.AWARE) {
    // Low pressure and calm - speed up
    newRate = currentRate + 1;
    reason = 'low_load';
  }

  // Bootstrap guard: if stuck at 0 but system is not in PANIC, allow minimum rate
  // Prevents deadlock: AWARE/ALERT alertness + current_rate=0 → nothing dispatches → stays stuck
  // Only PANIC (level=4, true disaster) should completely stop dispatch
  if (newRate === 0 && alertness.level < ALERTNESS_LEVELS.PANIC && pressure < 0.8) {
    newRate = 1;
    reason = `bootstrap (alertness=${alertness.levelName}, pressure=${pressure.toFixed(2)})`;
  }

  // Cap at effectiveDispatchMax
  newRate = Math.min(newRate, effectiveDispatchMax);

  // Post-drain cooldown: limit dispatch rate to 1 for 5 minutes after drain completes
  if (_postDrainCooldown && newRate > 1) {
    newRate = 1;
    reason = 'post_drain_cooldown';
  }

  // Save new state
  await pool.query(`
    INSERT INTO working_memory (key, value_json, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
  `, ['dispatch_ramp_state', { current_rate: newRate }]);

  // Log rate changes
  if (newRate !== currentRate) {
    console.log(`[tick] Ramped dispatch: ${currentRate} → ${newRate} (pressure: ${pressure.toFixed(2)}, alertness: ${alertness.levelName}, reason: ${reason})`);
  }

  return newRate;
}

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
async function executeTick() {
  const actionsTaken = [];
  const now = new Date();
  const tickStartTime = Date.now();
  let decisionEngineResult = null;
  let thalamusResult = null;

  // 0. Evaluate alertness level
  // ALERTNESS_LEVELS: SLEEPING=0, CALM=1, AWARE=2, ALERT=3, PANIC=4
  publishCognitiveState({ phase: 'alertness', detail: '评估警觉等级…' });
  let alertnessResult = null;
  try {
    alertnessResult = await evaluateAlertness();
    if (alertnessResult.level >= ALERTNESS_LEVELS.ALERT) {
      console.log(`[tick] Alertness: ${LEVEL_NAMES[alertnessResult.level]} (score=${alertnessResult.score || 'N/A'})`);
      actionsTaken.push({
        action: 'alertness_check',
        level: alertnessResult.level,
        level_name: LEVEL_NAMES[alertnessResult.level],
        score: alertnessResult.score
      });
    }

    // In PANIC mode, skip everything except basic health checks
    if (alertnessResult.level >= ALERTNESS_LEVELS.PANIC) {
      console.log('[tick] PANIC mode: skipping all operations, only heartbeat');
      return {
        success: true,
        alertness: alertnessResult,
        actions_taken: actionsTaken,
        reason: 'PANIC mode - only heartbeat',
        next_tick: new Date(now.getTime() + TICK_INTERVAL_MINUTES * 60 * 1000).toISOString()
      };
    }
  } catch (alertErr) {
    console.error('[tick] Alertness evaluation failed:', alertErr.message);
    // Record the failure in metrics
    recordOperation(false, 'alertness_evaluation');
  }

  // 0.5 认知评估：情绪 + 主观时间 + 并发意识（轻量，纯计算）
  publishCognitiveState({ phase: 'cognition', detail: '认知评估…' });
  let cognitionSnapshot = null;
  try {
    const resources = checkServerResources();
    const cpuPercent = resources.cpu_percent || 0;

    // 从 DB 获取真实的队列深度和最近成功率（用于情绪评估）
    let queueDepth = 0;
    let successRate = 1.0;
    try {
      const queueRes = await pool.query(
        "SELECT COUNT(*) AS cnt FROM tasks WHERE status = 'queued'"
      );
      queueDepth = parseInt(queueRes.rows[0]?.cnt || 0, 10);

      const successRes = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'completed') AS completed,
          COUNT(*) FILTER (WHERE status = 'failed') AS failed
        FROM tasks
        WHERE updated_at >= NOW() - INTERVAL '1 hour'
      `);
      const completed = parseInt(successRes.rows[0]?.completed || 0, 10);
      const failed = parseInt(successRes.rows[0]?.failed || 0, 10);
      const total = completed + failed;
      if (total > 0) successRate = completed / total;
    } catch {
      // 静默降级：使用默认值
    }

    const emotionResult = evaluateEmotion({
      alertnessLevel: alertnessResult?.level ?? 1,
      cpuPercent,
      queueDepth,
      successRate
    });
    updateSubjectiveTime();
    recordTickEvent({ phase: 'tick', detail: `警觉=${alertnessResult?.levelName || 'CALM'}, 情绪=${emotionResult.label}` });
    cognitionSnapshot = { emotion: emotionResult, time: getSubjectiveTime?.() };
    console.log(`[tick] 认知状态: 情绪=${emotionResult.label}(${emotionResult.state}), 队列=${queueDepth}, 成功率=${Math.round(successRate * 100)}%, 派发修正=${emotionResult.dispatch_rate_modifier}`);
  } catch (cogErr) {
    console.warn('[tick] 认知评估跳过:', cogErr.message);
  }

  // ═══════════════════════════════════════════════════════════════════
  // 感知层：不受 canDispatch 限制
  // 以下模块是"感知"动作，无论 canDispatch/thalamus 结果如何都必须运行。
  // 放在 alertness/cognition 评估之后、thalamus 路由之前，确保不被任何
  // 中间 return（thalamus dispatch_task / allGoalIds=0 / canDispatch=false）跳过。
  // ═══════════════════════════════════════════════════════════════════

  // [感知] 僵尸巡检：每 30 分钟清理 stale worktree / orphan process / stale lock slot
  const zombieSweepElapsed = Date.now() - _lastZombieSweepTime;
  if (zombieSweepElapsed >= ZOMBIE_SWEEP_INTERVAL_MS) {
    _lastZombieSweepTime = Date.now();
    zombieSweep().then(r => {
      const summary = `worktrees:${r.worktrees.removed} processes:${r.processes.killed} locks:${r.lock_slots.removed}`;
      console.log(`[tick] Zombie sweep done. ${summary}`);
    }).catch(err => {
      console.error('[tick] Zombie sweep failed (non-fatal):', err.message);
    });
  }

  // [感知] Pipeline Patrol 巡航：每 5 分钟检测卡住/孤儿 pipeline
  const pipelinePatrolElapsed = Date.now() - _lastPipelinePatrolTime;
  if (pipelinePatrolElapsed >= PIPELINE_PATROL_INTERVAL_MS) {
    _lastPipelinePatrolTime = Date.now();
    runPipelinePatrol(pool).then(r => {
      if (r.stuck > 0 || r.rescued > 0) {
        console.log(`[tick] Pipeline patrol: scanned=${r.scanned} stuck=${r.stuck} rescued=${r.rescued}`);
      }
    }).catch(err => {
      console.error('[tick] Pipeline patrol failed (non-fatal):', err.message);
    });
  }

  // [感知] Layer 2 运行健康监控：每小时一次，纯 SQL，无 LLM
  const healthCheckElapsed = Date.now() - _lastHealthCheckTime;
  if (healthCheckElapsed >= CLEANUP_INTERVAL_MS) {
    _lastHealthCheckTime = Date.now();
    try {
      const healthResult = await runLayer2HealthCheck(pool);
      console.log(`[tick] ${healthResult.summary}`);
    } catch (healthErr) {
      console.error('[tick] Layer2 health check failed (non-fatal):', healthErr.message);
    }
  }

  // [感知] KR 完成检查：Initiative → Scope → Project 全完成后关闭 KR
  try {
    const { checkKRCompletion } = await import('./kr-completion.js');
    const krResult = await checkKRCompletion(pool);
    if (krResult.closedCount > 0) {
      console.log(`[TICK] KR 完成检查: ${krResult.closedCount} 个已关闭`);
      actionsTaken.push({
        action: 'kr_completion_check',
        closed_count: krResult.closedCount,
        closed: krResult.closed,
      });
    }
  } catch (krErr) {
    console.error('[tick] KR completion check failed (non-fatal):', krErr.message);
  }

  // [感知] Initiative 闭环检查：每次 tick 都跑，纯 SQL，无 LLM
  try {
    const { checkInitiativeCompletion } = await import('./initiative-closer.js');
    const initiativeResult = await checkInitiativeCompletion(pool);
    console.log(`[TICK] Initiative 完成检查: ${initiativeResult.closedCount} 个已关闭`);
    if (initiativeResult.closedCount > 0) {
      actionsTaken.push({
        action: 'initiative_completion_check',
        closed_count: initiativeResult.closedCount,
        closed: initiativeResult.closed,
      });
    }
  } catch (initiativeErr) {
    console.error('[tick] Initiative completion check failed (non-fatal):', initiativeErr.message);
  }

  // [感知] Scope 闭环检查：每次 tick 都跑，纯 SQL，无 LLM
  try {
    const { checkScopeCompletion } = await import('./initiative-closer.js');
    const scopeResult = await checkScopeCompletion(pool);
    if (scopeResult.closedCount > 0) {
      console.log(`[TICK] Scope 完成检查: ${scopeResult.closedCount} 个已关闭`);
      actionsTaken.push({
        action: 'scope_completion_check',
        closed_count: scopeResult.closedCount,
        closed: scopeResult.closed,
      });
    }
  } catch (scopeErr) {
    console.error('[tick] Scope completion check failed (non-fatal):', scopeErr.message);
  }

  // [感知] Project 完成检查：每次 tick 都跑，纯 SQL，无 LLM
  try {
    const { checkProjectCompletion } = await import('./initiative-closer.js');
    const projectResult = await checkProjectCompletion(pool);
    if (projectResult.closedCount > 0) {
      console.log(`[TICK] Project 完成检查: ${projectResult.closedCount} 个已关闭`);
      actionsTaken.push({
        action: 'project_completion_check',
        closed_count: projectResult.closedCount,
        closed: projectResult.closed,
      });
    }
  } catch (projectErr) {
    console.error('[tick] Project completion check failed (non-fatal):', projectErr.message);
  }

  // [感知] OKR Initiative 完成检测：新 okr_initiatives 表飞轮，纯 SQL，无 LLM
  try {
    const { checkOkrInitiativeCompletion } = await import('./okr-closer.js');
    const okrInitResult = await checkOkrInitiativeCompletion(pool);
    if (okrInitResult.closedCount > 0) {
      actionsTaken.push({
        action: 'okr_initiative_completion_check',
        closed_count: okrInitResult.closedCount,
        closed: okrInitResult.closed,
      });
    }
  } catch (okrInitErr) {
    console.error('[tick] OKR Initiative completion check failed (non-fatal):', okrInitErr.message);
  }

  // [感知] OKR Scope 完成检测：新 okr_scopes 表飞轮，纯 SQL，无 LLM
  try {
    const { checkOkrScopeCompletion } = await import('./okr-closer.js');
    const okrScopeResult = await checkOkrScopeCompletion(pool);
    if (okrScopeResult.closedCount > 0) {
      actionsTaken.push({
        action: 'okr_scope_completion_check',
        closed_count: okrScopeResult.closedCount,
        closed: okrScopeResult.closed,
      });
    }
  } catch (okrScopeErr) {
    console.error('[tick] OKR Scope completion check failed (non-fatal):', okrScopeErr.message);
  }

  // [感知] OKR Project 完成检测：新 okr_projects 表飞轮，纯 SQL，无 LLM
  try {
    const { checkOkrProjectCompletion } = await import('./okr-closer.js');
    const okrProjectResult = await checkOkrProjectCompletion(pool);
    if (okrProjectResult.closedCount > 0) {
      actionsTaken.push({
        action: 'okr_project_completion_check',
        closed_count: okrProjectResult.closedCount,
        closed: okrProjectResult.closed,
      });
    }
  } catch (okrProjectErr) {
    console.error('[tick] OKR Project completion check failed (non-fatal):', okrProjectErr.message);
  }

  // [感知] Initiative 队列激活：每次 tick 检查，从 pending 按优先级激活（capacity-aware）
  try {
    const { activateNextInitiatives } = await import('./initiative-closer.js');
    const activated = await activateNextInitiatives(pool);
    if (activated > 0) {
      console.log(`[TICK] Initiative 激活: ${activated} 个从 pending → active`);
      actionsTaken.push({
        action: 'initiative_queue_activate',
        activated_count: activated,
      });
    }
  } catch (activateErr) {
    console.error('[tick] Initiative queue activation failed (non-fatal):', activateErr.message);
  }

  // [感知] KR 队列激活：从 pending KR 中按优先级激活
  try {
    const { activateNextKRs } = await import('./kr-completion.js');
    const krsActivated = await activateNextKRs(pool);
    if (krsActivated > 0) {
      console.log(`[TICK] KR 激活: ${krsActivated} 个从 pending → in_progress`);
      actionsTaken.push({
        action: 'kr_queue_activate',
        activated_count: krsActivated,
      });
    }
  } catch (krActivateErr) {
    console.error('[tick] KR queue activation failed (non-fatal):', krActivateErr.message);
  }

  // [感知] Project 层容量管理：激活/降级确保 active 在 capacity 范围内
  try {
    const { manageProjectActivation } = await import('./project-activator.js');
    const { computeCapacity } = await import('./capacity.js');
    const DEFAULT_SLOTS = 9;
    const cap = computeCapacity(DEFAULT_SLOTS);
    const projectResult = await manageProjectActivation(pool, cap.project);
    if (projectResult.activated > 0 || projectResult.deactivated > 0) {
      console.log(`[TICK] Project 容量管理: +${projectResult.activated} 激活, -${projectResult.deactivated} 降级`);
      actionsTaken.push({
        action: 'project_capacity_management',
        activated: projectResult.activated,
        deactivated: projectResult.deactivated,
      });
    }
  } catch (projectCapErr) {
    console.error('[tick] Project capacity management failed (non-fatal):', projectCapErr.message);
  }

  // [感知] KR 进度验证：每小时一次，从外部数据源采集真实指标
  // 替代旧的 kr-progress.js（数 initiative 完成率），改为 kr-verifier.js（查实际指标）
  const krProgressElapsed = Date.now() - _lastKrProgressSyncTime;
  if (krProgressElapsed >= CLEANUP_INTERVAL_MS) {
    _lastKrProgressSyncTime = Date.now();
    try {
      // 优先使用 kr-verifier（基于外部数据源，不可伪造）
      const { runAllVerifiers } = await import('./kr-verifier.js');
      const verifierResult = await runAllVerifiers();
      if (verifierResult.updated > 0) {
        console.log(`[TICK] KR 指标验证: ${verifierResult.updated} 个 KR 已更新（基于数据源）`);
        actionsTaken.push({
          action: 'kr_verifier_sync',
          updated_count: verifierResult.updated,
          errors: verifierResult.errors,
        });
      }

      // 对没有 verifier 的 KR，仍用旧方式（数 initiative 完成率）作为 fallback
      const { syncAllKrProgress } = await import('./kr-progress.js');
      const krResult = await syncAllKrProgress(pool);
      if (krResult.updated > 0) {
        console.log(`[TICK] KR 进度同步（fallback）: ${krResult.updated} 个 KR 已更新`);
        actionsTaken.push({
          action: 'kr_progress_sync',
          updated_count: krResult.updated,
        });
      }
    } catch (krErr) {
      console.error('[tick] KR verifier/progress sync failed (non-fatal):', krErr.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // 感知层结束 — 以下是行动层（受 canDispatch/thalamus 控制）
  // ═══════════════════════════════════════════════════════════════════

  // 0. Thalamus: Analyze tick event (quick route for simple ticks)
  publishCognitiveState({ phase: 'thalamus', detail: '丘脑路由分析…' });
  try {
    const tickEvent = {
      type: EVENT_TYPES.TICK,
      timestamp: now.toISOString(),
      has_anomaly: false  // Will be set to true if issues detected later
    };

    thalamusResult = await thalamusProcessEvent(tickEvent);

    // If thalamus returns fallback_to_tick or no_action, continue with normal tick
    // Otherwise, execute the thalamus decision
    const thalamusAction = thalamusResult.actions?.[0]?.type;
    if (thalamusAction && thalamusAction !== 'fallback_to_tick' && thalamusAction !== 'no_action') {
      console.log(`[tick] Thalamus decision: ${thalamusAction}`);

      // Execute thalamus decision
      const execReport = await executeThalamusDecision(thalamusResult);
      actionsTaken.push({
        action: 'thalamus',
        level: thalamusResult.level,
        thalamus_actions: thalamusResult.actions.map(a => a.type),
        executed: execReport.actions_executed.length,
        failed: execReport.actions_failed.length
      });

      // If thalamus handled the event, may still continue with normal tick
      // unless it explicitly requests to skip
      if (thalamusAction === 'dispatch_task') {
        // Thalamus already dispatched, skip normal dispatch logic
        return {
          success: true,
          thalamus: thalamusResult,
          actions_taken: actionsTaken,
          next_tick: new Date(now.getTime() + TICK_INTERVAL_MINUTES * 60 * 1000).toISOString()
        };
      }
    }
  } catch (thalamusErr) {
    console.error('[tick] Thalamus error, falling back to code-based tick:', thalamusErr.message);
    // Continue with normal tick if thalamus fails
  }

  // 0.5. PR Plans Completion Check (三层拆解状态自动更新)
  try {
    const { checkPrPlansCompletion } = await import('./planner.js');
    const completedPrPlans = await checkPrPlansCompletion();
    if (completedPrPlans.length > 0) {
      console.log(`[tick] Auto-completed ${completedPrPlans.length} PR Plans`);
      actionsTaken.push({
        action: 'pr_plans_completion_check',
        completed_count: completedPrPlans.length,
        completed_ids: completedPrPlans
      });
    }
  } catch (prPlansErr) {
    console.error('[tick] PR Plans completion check failed:', prPlansErr.message);
  }

  // 0.7. 统一拆解检查（七层架构）
  publishCognitiveState({ phase: 'decomposition', detail: '检查 OKR 拆解状态…' });
  try {
    const { runDecompositionChecks } = await import('./decomposition-checker.js');
    const decompSummary = await runDecompositionChecks();
    if (decompSummary.total_created > 0) {
      const activePaths = decompSummary.active_paths?.length ?? 0;
      console.log(`[tick] Created ${decompSummary.total_created} decomposition tasks (${activePaths} active paths)`);
      actionsTaken.push({
        action: 'decomposition_check',
        created_count: decompSummary.total_created,
        active_paths: activePaths,
        tasks: decompSummary.created_tasks
      });
    }
  } catch (decompErr) {
    console.error('[tick] Decomposition check failed:', decompErr.message);
  }

  // 0.5.4b. Crystallize Pipeline Orchestration Check — 检测 queued crystallize 任务，创建子任务
  try {
    const { advanceCrystallizePipeline } = await import('./crystallize-orchestrator.js');
    const crystallizeResult = await advanceCrystallizePipeline();
    if (crystallizeResult.total_actions > 0) {
      console.log(`[tick] Crystallize orchestration: ${crystallizeResult.total_actions} actions (orchestrated=${crystallizeResult.summary.orchestrated}, skipped=${crystallizeResult.summary.skipped})`);
      actionsTaken.push({
        action: 'crystallize_orchestration',
        total_actions: crystallizeResult.total_actions,
        orchestrated: crystallizeResult.summary.orchestrated,
        skipped: crystallizeResult.summary.skipped,
      });
    }
  } catch (crystallizeErr) {
    console.error('[tick] Crystallize orchestration check failed:', crystallizeErr.message);
  }

  // 0.5.5. Content Pipeline Orchestration Check — 检测 queued content-pipeline 任务，创建子任务
  try {
    const { orchestrateContentPipelines } = await import('./content-pipeline-orchestrator.js');
    const pipelineResult = await orchestrateContentPipelines();
    if (pipelineResult.total_actions > 0) {
      console.log(`[tick] Content pipeline orchestration: ${pipelineResult.total_actions} actions (orchestrated=${pipelineResult.summary.orchestrated}, skipped=${pipelineResult.summary.skipped})`);
      actionsTaken.push({
        action: 'content_pipeline_orchestration',
        total_actions: pipelineResult.total_actions,
        orchestrated: pipelineResult.summary.orchestrated,
        skipped: pipelineResult.summary.skipped,
      });
    }
  } catch (pipelineErr) {
    console.error('[tick] Content pipeline orchestration check failed:', pipelineErr.message);
  }

  // 0.5.6. Content Pipeline Executor — 执行 queued 的 content-* 子任务
  // ⚠️ fire-and-forget：不 await。内部用 execSync（NotebookLM/LLM），会阻塞事件循环，
  //    必须异步启动。executeQueuedContentTasks 内部有并发守卫防止重叠。
  try {
    const { executeQueuedContentTasks } = await import('./content-pipeline-orchestrator.js');
    executeQueuedContentTasks().then(r => {
      if (r.executed > 0) {
        console.log(`[tick] Content pipeline executor: ${r.executed} tasks executed`);
        actionsTaken.push({ action: 'content_pipeline_execution', executed: r.executed });
      }
    }).catch(execErr => {
      console.error('[tick] Content pipeline executor failed:', execErr.message);
    });
  } catch (execErr) {
    console.error('[tick] Content pipeline executor import failed:', execErr.message);
  }

  // 0.6. Recurring Tasks Check
  try {
    const { checkRecurringTasks } = await import('./recurring.js');
    const recurringCreated = await checkRecurringTasks(now);
    if (recurringCreated.length > 0) {
      console.log(`[tick] Created ${recurringCreated.length} recurring task instances`);
      actionsTaken.push({
        action: 'recurring_tasks_check',
        created_count: recurringCreated.length,
        created: recurringCreated
      });
    }
  } catch (recurringErr) {
    console.error('[tick] Recurring tasks check failed:', recurringErr.message);
  }

  // 0.7. Pending Conversations Check — 检查待回音消息，判断是否跟进
  try {
    const { checkPendingFollowups } = await import('./pending-conversations.js');
    const { callLLM } = await import('./llm-caller.js');
    const { sendFollowUp } = await import('./proactive-mouth.js');
    const toFollowUp = await checkPendingFollowups(pool);
    if (toFollowUp.length > 0) {
      console.log(`[tick] ${toFollowUp.length} 条待回音消息需要跟进`);
      for (const conv of toFollowUp) {
        sendFollowUp(pool, callLLM, conv).catch(err =>
          console.warn('[tick] sendFollowUp failed:', err.message)
        );
      }
      actionsTaken.push({
        action: 'pending_followup_check',
        followup_count: toFollowUp.length
      });
    }
  } catch (followupErr) {
    console.error('[tick] Pending followup check failed:', followupErr.message);
  }

  // 0.4.5. Zombie resource cleanup: 每 20 分钟清理一次 stale slots + 孤儿 worktrees
  const zombieElapsed = Date.now() - _lastZombieCleanupTime;
  if (zombieElapsed >= ZOMBIE_CLEANUP_INTERVAL_MS) {
    try {
      const { runZombieCleanup } = await import('./zombie-cleaner.js');
      const zombieResult = await runZombieCleanup(pool);
      _lastZombieCleanupTime = Date.now();
      if (zombieResult.slotsReclaimed > 0 || zombieResult.worktreesRemoved > 0) {
        console.log(`[tick] Zombie cleanup: slots=${zombieResult.slotsReclaimed} worktrees=${zombieResult.worktreesRemoved}`);
      }
    } catch (zombieErr) {
      console.error('[tick] Zombie cleanup failed (non-fatal):', zombieErr.message);
    }
  }

  // 0.5. Periodic cleanup: run once per CLEANUP_INTERVAL_MS (default 1 hour)
  const cleanupElapsed = Date.now() - _lastCleanupTime;
  if (cleanupElapsed >= CLEANUP_INTERVAL_MS) {
    try {
      const cleanupResult = await pool.query('SELECT run_periodic_cleanup() AS msg');
      const msg = cleanupResult.rows[0]?.msg || 'done';
      _lastCleanupTime = Date.now();
      console.log(`[tick] Periodic cleanup: ${msg}`);
    } catch (cleanupErr) {
      console.error('[tick] Periodic cleanup failed (non-fatal):', cleanupErr.message);
    }
  }

  // 0.5.1. 知识归档：90天前已消化的 learnings 标记 archived（与 cleanup 同频每小时）
  if (cleanupElapsed >= CLEANUP_INTERVAL_MS) {
    try {
      const archiveResult = await pool.query(`
        UPDATE learnings SET archived = true
        WHERE digested = true
          AND (archived = false OR archived IS NULL)
          AND created_at < NOW() - INTERVAL '90 days'
      `);
      if (archiveResult.rowCount > 0) {
        console.log(`[tick] Archived ${archiveResult.rowCount} old learnings`);
      }
    } catch (archiveErr) {
      console.error('[tick] Knowledge archive failed (non-fatal):', archiveErr.message);
    }
  }

  // 0.5.2. 提案过期清理：与 periodic cleanup 同频（每小时）
  if (cleanupElapsed >= CLEANUP_INTERVAL_MS) {
    try {
      const expiredCount = await expireStaleProposals();
      if (expiredCount > 0) {
        console.log(`[tick] Expired ${expiredCount} stale proposals`);
      }
    } catch (expireErr) {
      console.error('[tick] Proposal expiry check failed (non-fatal):', expireErr.message);
    }
  }

  // 0.5.4. Progress Ledger 进展评估：与 periodic cleanup 同频（每小时）
  if (cleanupElapsed >= CLEANUP_INTERVAL_MS) {
    try {
      const { evaluateProgressInTick } = await import('./progress-ledger.js');
      const tickId = crypto.randomUUID();
      const tickNumber = Math.floor(Date.now() / 1000); // 简化的 tick 序号

      const evaluationResults = await evaluateProgressInTick(tickId, tickNumber);
      const alertCount = evaluationResults.filter(r => r.shouldAlert).length;

      if (evaluationResults.length > 0) {
        console.log(`[tick] Progress evaluation: ${evaluationResults.length} tasks evaluated, ${alertCount} alerts`);

        // 如果有高风险任务，提升警觉度
        if (alertCount > 0) {
          alertnessResult.score += Math.min(alertCount * 10, 50); // 每个警报+10分，最多+50分
          alertnessResult.reasons.push(`${alertCount} tasks with progress anomalies detected`);
          console.log(`[tick] Alertness increased due to progress anomalies: +${Math.min(alertCount * 10, 50)} points`);
        }
      }
    } catch (progressErr) {
      console.error('[tick] Progress evaluation failed (non-fatal):', progressErr.message);
    }
  }

  // 0.5.5. Goal Outer Loop 评估：每 24 小时评估一次所有活跃 KR 整体进展
  const goalEvalElapsed = Date.now() - _lastGoalEvalTime;
  if (goalEvalElapsed >= GOAL_EVAL_INTERVAL_MS) {
    _lastGoalEvalTime = Date.now();
    try {
      const { evaluateGoalOuterLoop } = await import('./goal-evaluator.js');
      const goalResults = await evaluateGoalOuterLoop(GOAL_EVAL_INTERVAL_MS);
      if (goalResults.length > 0) {
        const stalledCount = goalResults.filter(r => r.verdict === 'stalled').length;
        const attentionCount = goalResults.filter(r => r.verdict === 'needs_attention').length;
        console.log(`[tick] Goal outer loop: ${goalResults.length} goals evaluated, ${stalledCount} stalled, ${attentionCount} needs_attention`);
        if (stalledCount > 0) {
          actionsTaken.push({
            action: 'goal_outer_loop',
            evaluated: goalResults.length,
            stalled: stalledCount,
            needs_attention: attentionCount,
          });
        }
      }
    } catch (goalEvalErr) {
      console.error('[tick] Goal outer loop evaluation failed (non-fatal):', goalEvalErr.message);
    }
  }

  // 0.13. HEARTBEAT.md 灵活巡检：每 30 分钟一次，L1 丘脑执行
  const heartbeatElapsed = Date.now() - _lastHeartbeatTime;
  const { HEARTBEAT_INTERVAL_MS: HB_INTERVAL } = await import('./heartbeat-inspector.js');
  if (heartbeatElapsed >= HB_INTERVAL) {
    try {
      const { runHeartbeatInspection } = await import('./heartbeat-inspector.js');
      const hbResult = await runHeartbeatInspection(pool);
      _lastHeartbeatTime = Date.now(); // 仅成功后更新，失败时下次 tick 立即重试
      if (!hbResult.skipped && hbResult.actions_count > 0) {
        console.log(`[TICK] Heartbeat 巡检: ${hbResult.actions_count} 个行动`);
        actionsTaken.push({
          action: 'heartbeat_inspection',
          actions_count: hbResult.actions_count,
        });
      }
    } catch (hbErr) {
      console.error('[tick] Heartbeat inspection failed (non-fatal):', hbErr.message);
    }
  }

  // 0.14. PR Shepherd：每次 tick 检查 open/ci_pending PR，自动合并或重排
  try {
    const { shepherdOpenPRs } = await import('./shepherd.js');
    const shepherdResult = await shepherdOpenPRs(pool);
    if (shepherdResult.processed > 0) {
      actionsTaken.push({
        action: 'pr_shepherd',
        processed: shepherdResult.processed,
        merged: shepherdResult.merged,
        failed: shepherdResult.failed,
        pending: shepherdResult.pending,
      });
    }
  } catch (shepherdErr) {
    console.error('[tick] PR shepherd failed (non-fatal):', shepherdErr.message);
  }

  // 1. Decision Engine: Compare goal progress
  try {
    const comparison = await compareGoalProgress();

    await logTickDecision(
      'tick',
      `Goal comparison: ${comparison.overall_health}, ${comparison.goals.length} goals analyzed`,
      { action: 'compare_goals', overall_health: comparison.overall_health },
      { success: true, goals_analyzed: comparison.goals.length }
    );

    // 2. Generate decision if there are issues
    if (comparison.overall_health !== 'healthy' || comparison.next_actions.length > 0) {
      const decision = await generateDecision({ trigger: 'tick' });

      await logTickDecision(
        'tick',
        `Decision generated: ${decision.actions.length} actions, confidence: ${decision.confidence}`,
        { action: 'generate_decision', decision_id: decision.decision_id },
        { success: true, confidence: decision.confidence }
      );

      if (decision.confidence >= AUTO_EXECUTE_CONFIDENCE && decision.actions.length > 0) {
        // High confidence — execute all actions
        const execResult = await executeDecision(decision.decision_id);

        await logTickDecision(
          'tick',
          `Auto-executed decision: ${execResult.results.length} actions`,
          { action: 'execute_decision', decision_id: decision.decision_id },
          { success: true, executed: execResult.results.length }
        );

        actionsTaken.push({
          action: 'execute_decision',
          decision_id: decision.decision_id,
          actions_executed: execResult.results.length,
          confidence: decision.confidence
        });
      } else if (decision.actions.length > 0) {
        // Low confidence — but safe actions can still auto-execute
        const { safeActions, unsafeActions } = splitActionsBySafety(decision.actions);

        if (safeActions.length > 0) {
          // Execute safe actions directly (retry, reprioritize, skip)
          const execResult = await executeDecision(decision.decision_id);

          await logTickDecision(
            'tick',
            `Auto-executed ${safeActions.length} safe actions (${safeActions.map(a => a.type).join(', ')}), ${unsafeActions.length} pending approval`,
            { action: 'execute_safe_actions', decision_id: decision.decision_id },
            { success: true, safe_executed: safeActions.length, unsafe_pending: unsafeActions.length }
          );

          actionsTaken.push({
            action: 'execute_safe_actions',
            decision_id: decision.decision_id,
            safe_actions_executed: safeActions.length,
            unsafe_actions_pending: unsafeActions.length,
            confidence: decision.confidence
          });
        } else {
          await logTickDecision(
            'tick',
            `Decision pending approval: confidence ${decision.confidence} < ${AUTO_EXECUTE_CONFIDENCE}, no safe actions`,
            { action: 'decision_pending', decision_id: decision.decision_id },
            { success: true, requires_approval: true }
          );
        }
      }

      decisionEngineResult = {
        comparison_health: comparison.overall_health,
        decision_id: decision.decision_id,
        actions_generated: decision.actions.length,
        confidence: decision.confidence
      };
    }
  } catch (err) {
    await logTickDecision(
      'tick',
      `Decision engine error: ${err.message}`,
      { action: 'decision_error', error: err.message },
      { success: false, error: err.message }
    );
  }


  // 3. Get daily focus
  const focusResult = await getDailyFocus();

  // When no daily focus (no active OKR), skip focus scoping but continue dispatch
  // This prevents the entire tick from exiting when OKRs are temporarily absent
  const hasFocus = !!focusResult;
  if (!hasFocus) {
    await logTickDecision(
      'tick',
      'No daily focus — falling back to global dispatch',
      { action: 'global_fallback', reason: 'no_focus' },
      { success: true, skipped: false }
    );
    console.log('[tick] No active Objective found, falling back to global task dispatch');
  }

  const focus = hasFocus ? focusResult.focus : null;
  const objectiveId = hasFocus ? focus.objective.id : null;

  // 4. Get tasks scoped to ready KRs only (OKR unification: only dispatch for user-approved KRs)
  // Ready KRs = KRs that have been decomposed, reviewed, and approved by user
  // Also include 'decomposing' KRs so their decomp tasks (created by okr-tick) can be dispatched
  const readyKRsResult = await pool.query(`
    SELECT id FROM key_results WHERE status IN ('active', 'in_progress', 'decomposing')
  `);
  const readyKrIds = readyKRsResult.rows.map(r => r.id);

  // Also include focus objective's KRs if focus is set (backward compat)
  let allGoalIds;
  let krIds = [];
  if (hasFocus) {
    krIds = focus.key_results.map(kr => kr.id);
    // Merge focus KRs with ready KRs (ready KRs take priority)
    const merged = new Set([...readyKrIds, ...krIds]);
    allGoalIds = [objectiveId, ...merged];
  } else if (readyKrIds.length > 0) {
    allGoalIds = readyKrIds;
  } else {
    // Fallback: if no active KRs exist yet, use all non-archived key_results (transition period)
    const allGoalsResult = await pool.query(`
      SELECT id FROM key_results WHERE status NOT IN ('completed', 'cancelled', 'archived')
    `);
    allGoalIds = allGoalsResult.rows.map(r => r.id);
  }

  // Auto-recover expired blocked tasks (blocked_until < now → queued)
  // 无条件执行，不依赖 allGoalIds
  try {
    const { unblockExpiredTasks } = await import('./task-updater.js');
    const recovered = await unblockExpiredTasks({ limit: UNBLOCK_BATCH_LIMIT });
    if (recovered.length > 0) {
      console.log(`[tick] Auto-unblocked ${recovered.length} expired blocked task(s)`);
      for (const r of recovered) {
        actionsTaken.push({
          action: 'auto_unblock',
          task_id: r.task_id,
          title: r.title,
          blocked_reason: r.blocked_reason || 'unknown',
        });
      }
    }
  } catch (blockedErr) {
    console.error('[tick] Blocked task recovery error:', blockedErr.message);
  }

  // Fix: 无活跃目标时直接返回，避免 SQL OR '{}' 条件导致返回全部任务
  if (allGoalIds.length === 0) {
    console.log('[tick] No active goals found, skipping tick');
    return {
      success: true,
      alertness: alertnessResult,
      decision_engine: decisionEngineResult,
      focus: null,
      dispatch: { dispatched: 0, reason: 'no_active_goals' },
      actions_taken: actionsTaken,
      summary: { in_progress: 0, queued: 0, stale: 0 },
      tick_duration_ms: Date.now() - now.getTime(),
      next_tick: new Date(now.getTime() + TICK_INTERVAL_MINUTES * 60 * 1000).toISOString()
    };
  }

  const tasksResult = await pool.query(`
    SELECT id, title, status, priority, started_at, updated_at, payload
    FROM tasks
    WHERE (goal_id = ANY($1) OR goal_id IS NULL)
      AND status NOT IN ('completed', 'cancelled', 'canceled')
    ORDER BY
      CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
      created_at ASC
  `, [allGoalIds]);

  const tasks = tasksResult.rows;
  const inProgress = tasks.filter(t => t.status === 'in_progress');
  const queued = tasks.filter(t => t.status === 'queued');

  // 5. Auto-fail timed-out dispatched tasks
  const timeoutActions = await autoFailTimedOutTasks(inProgress);
  actionsTaken.push(...timeoutActions);

  // 5b. Liveness probe: verify all in_progress tasks have alive processes
  try {
    const livenessActions = await probeTaskLiveness();
    actionsTaken.push(...livenessActions);
    if (livenessActions.length > 0) {
      console.log(`[tick-loop] Liveness probe: ${livenessActions.length} tasks auto-failed`);
    }
  } catch (livenessErr) {
    console.error('[tick-loop] Liveness probe error:', livenessErr.message);
  }

  // 5c. Watchdog: resource monitoring — detect and kill runaway processes
  try {
    const { checkRunaways, cleanupMetrics } = await import('./watchdog.js');
    const resources = checkServerResources();
    const watchdogResult = checkRunaways(resources.metrics.max_pressure);

    for (const action of watchdogResult.actions) {
      if (action.action === 'kill') {
        console.log(`[tick] Watchdog kill: task=${action.taskId} reason=${action.reason}`);
        const killResult = await killProcessTwoStage(action.taskId, action.pgid);
        if (killResult.killed) {
          // Phase 2: Emergency cleanup (worktree, lock slot, .dev-mode)
          try {
            const { emergencyCleanup } = await import('./emergency-cleanup.js');
            const slot = action.slot || (pidMap && pidMap.get?.(action.taskId)?.slot);
            if (slot) {
              const cleanupResult = emergencyCleanup(action.taskId, slot);
              console.log(`[tick] Emergency cleanup: wt=${cleanupResult.worktree} lock=${cleanupResult.lock}`);
            }
          } catch (cleanupErr) {
            console.error(`[tick] Emergency cleanup failed (non-fatal): ${cleanupErr.message}`);
          }

          const requeueResult = await requeueTask(action.taskId, action.reason, action.evidence);
          // P0 FIX: fallback quarantine 日志（竞态条件下 requeueTask 仍能 quarantine）
          if (requeueResult.reason === 'fallback_quarantine') {
            console.log(`[tick] Watchdog fallback quarantine: task=${action.taskId} (race condition resolved)`);
          }
          cleanupMetrics(action.taskId);
          await emit('watchdog_kill', 'watchdog', {
            task_id: action.taskId, pgid: action.pgid,
            reason: action.reason, kill_stage: killResult.stage,
            requeued: requeueResult.requeued, quarantined: requeueResult.quarantined || false,
          });
          actionsTaken.push({
            action: 'watchdog_kill',
            task_id: action.taskId,
            reason: action.reason,
            kill_stage: killResult.stage,
            requeued: requeueResult.requeued,
            quarantined: requeueResult.quarantined || false,
          });
        } else {
          console.error(`[tick] Watchdog kill FAILED: task=${action.taskId} stage=${killResult.stage}`);
        }
      } else if (action.action === 'warn') {
        console.log(`[tick] Watchdog warn: task=${action.taskId} reason=${action.reason}`);
      }
    }
  } catch (watchdogErr) {
    console.error('[tick] Watchdog error:', watchdogErr.message);
  }

  // 5d. Idle session cleanup — kill interactive Claude sessions idle > 2h
  try {
    const { checkIdleSessions } = await import('./watchdog.js');
    const idleResult = checkIdleSessions();

    for (const action of idleResult.actions) {
      if (action.action === 'kill') {
        console.log(`[tick] idle-session kill: pid=${action.pid} reason=${action.reason}`);
        try {
          process.kill(action.pid, 'SIGTERM');
          // Schedule SIGKILL after 60 seconds if still alive
          setTimeout(() => {
            try {
              process.kill(action.pid, 'SIGKILL');
            } catch { /* already dead */ }
          }, 60000);
          actionsTaken.push({ action: 'idle_session_kill', pid: action.pid, reason: action.reason });
        } catch (killErr) {
          console.error(`[tick] idle-session kill failed: pid=${action.pid} err=${killErr.message}`);
        }
      }
    }
  } catch (idleErr) {
    console.error('[tick] Idle session check error:', idleErr.message);
  }

  // P1 FIX #3: Check for expired quarantine tasks and auto-release (limit=2/tick)
  try {
    const released = await checkExpiredQuarantineTasks({ limit: QUARANTINE_RELEASE_LIMIT });
    for (const r of released) {
      actionsTaken.push({
        action: 'auto_release_quarantine',
        task_id: r.task_id,
        title: r.title,
        reason: r.reason || 'unknown',
        failure_class: r.failure_class || 'unknown',
        ttl_release: 'TTL expired',
      });
    }
  } catch (quarantineErr) {
    console.error('[tick] Quarantine check error:', quarantineErr.message);
  }

  // Blocked 任务自动释放：blocked_until <= NOW() 的任务重新入队
  try {
    const blockedReleased = await releaseBlockedTasks();
    for (const r of blockedReleased) {
      actionsTaken.push({
        action: 'auto_release_blocked',
        task_id: r.task_id,
        title: r.title,
        blocked_reason: r.blocked_reason || 'unknown',
        blocked_duration_ms: r.blocked_duration_ms,
      });
    }
    if (blockedReleased.length > 0) {
      console.log(`[tick] Released ${blockedReleased.length} blocked task(s) back to queued`);
    }
  } catch (blockedErr) {
    console.error('[tick] Blocked task release error:', blockedErr.message);
  }

  // Check for stale tasks (long-running, not dispatched)
  const staleTasks = tasks.filter(t => isStale(t));
  for (const task of staleTasks) {
    await logTickDecision(
      'tick',
      `Stale task detected: ${task.title}`,
      { action: 'detect_stale', task_id: task.id },
      { success: true, task_id: task.id, title: task.title }
    );
    actionsTaken.push({
      action: 'detect_stale',
      task_id: task.id,
      title: task.title,
      reason: `Task has been in_progress for over ${STALE_THRESHOLD_HOURS} hours`
    });
  }

  // 6. Planning: 队列 < 3 时预规划下一批（不再要求完全空闲）
  //    原设计：queued=0 AND in_progress=0 才规划，导致 Cecelia 只能被动消化
  //    修复后：队列较少时提前规划，更主动
  publishCognitiveState({ phase: 'planning', detail: '规划下一步任务…', meta: { queued: queued.length, in_progress: inProgress.length } });
  if (queued.length < 3 && allGoalIds.length > 0) {
    const planKrIds = readyKrIds.length > 0 ? readyKrIds : allGoalIds; // 优先 ready KRs
    try {
      const planned = await planNextTask(planKrIds);
      if (planned.planned) {
        actionsTaken.push({
          action: 'plan',
          task_id: planned.task.id,
          title: planned.task.title
        });
      } else if (planned.reason === 'needs_planning' && planned.kr) {
        // Note: KR decomposition now handled by decomposition-checker.js
        actionsTaken.push({
          action: 'needs_planning',
          kr: planned.kr,
          project: planned.project,
          note: 'waiting_for_decomposition_checker'
        });
      } else if (planned.reason === 'no_project_for_kr') {
        // KR exists but has no linked Project — decomposition-checker Check C will handle
        console.log(`[tick-loop] no_project_for_kr: KR "${planned.kr?.title}" has no linked project, decomposition-checker Check C will repair`);
        actionsTaken.push({
          action: 'no_project_for_kr',
          kr: planned.kr,
          note: 'waiting_for_decomposition_checker_check_c'
        });
      }
    } catch (planErr) {
      console.error('[tick-loop] Planner error:', planErr.message);
    }
  } else if (!canPlan() && queued.length === 0 && inProgress.length === 0) {
    console.log(`[tick] Planning disabled at alertness level ${LEVEL_NAMES[alertnessResult?.level || 0]}`);
  }

  // Note: Auto OKR decomposition now handled by decomposition-checker.js (0.7)

  // 6.5. quota_exhausted requeue — billing pause 未激活时，梯度释放 quota_exhausted 任务
  // 逻辑：pause 激活期间任务留在 quota_exhausted；pause 过期后每 tick 最多释放 MAX_REQUEUE_PER_TICK 个
  // 排序：P0 优先（priority ASC），同优先级按 created_at ASC（先进先出）
  if (!getBillingPause()?.active) {
    try {
      const requeueResult = await pool.query(`
        UPDATE tasks SET status = 'queued', started_at = NULL, quota_exhausted_at = NULL
        WHERE id IN (
          SELECT id FROM tasks
          WHERE status = 'quota_exhausted'
          ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 ELSE 9 END ASC, created_at ASC
          LIMIT $1
        )
        RETURNING id, title
      `, [MAX_REQUEUE_PER_TICK]);
      if (requeueResult.rowCount > 0) {
        // Count remaining quota_exhausted tasks for next tick
        const remainingResult = await pool.query(
          `SELECT COUNT(*) AS cnt FROM tasks WHERE status = 'quota_exhausted'`
        );
        const remaining = parseInt(remainingResult.rows[0]?.cnt || '0', 10);
        console.log(`[tick] Requeued ${requeueResult.rowCount}/${requeueResult.rowCount + remaining} quota_exhausted task(s) (remaining=${remaining})`);
        requeueResult.rows.forEach(r => console.log(`[tick]   - ${r.id} ${r.title}`));
      }
    } catch (requeueErr) {
      console.error('[tick] quota_exhausted requeue error (non-fatal):', requeueErr.message);
    }
  }

  // 7. Dispatch tasks — fill all available slots (scoped to focused objective first, then global)
  console.log(`[tick] Phase 7 reached: queued=${queued.length} inProgress=${inProgress.length} allGoalIds=${allGoalIds.length}`);
  publishCognitiveState({ phase: 'dispatching', detail: '派发任务…' });
  //    Respect alertness level dispatch settings
  let dispatched = 0;
  let lastDispatchResult = null;

  // Check if dispatch is allowed (using enhanced alertness)
  const _canDispatchResult = canDispatch();
  console.log(`[tick] canDispatch=${_canDispatchResult} alertness=${alertnessResult?.level || '?'}`);
  if (!_canDispatchResult) {
    console.log(`[tick] Dispatch disabled at alertness level ${alertnessResult?.levelName || 'UNKNOWN'}`);
    return {
      success: true,
      alertness: alertnessResult,
      decision_engine: decisionEngineResult,
      focus: hasFocus ? { objective_id: objectiveId, objective_title: focus.objective.title } : null,
      dispatch: { dispatched: 0, reason: 'alertness_disabled' },
      actions_taken: actionsTaken,
      summary: { in_progress: inProgress.length, queued: queued.length, stale: staleTasks.length },
      next_tick: new Date(now.getTime() + TICK_INTERVAL_MINUTES * 60 * 1000).toISOString()
    };
  }

  // Apply dispatch rate limit based on alertness level
  let dispatchRate = getDispatchRate();

  // 自愈恢复期间额外限速：isRecovering=true 时上限 50%，防止恢复期加剧过载
  const healingStatus = getRecoveryStatus();
  if (healingStatus.isRecovering && dispatchRate > RECOVERY_DISPATCH_CAP) {
    console.log(`[tick] Healing recovery active (phase=${healingStatus.phase}): capping dispatch rate ${Math.round(dispatchRate * 100)}% → ${Math.round(RECOVERY_DISPATCH_CAP * 100)}%`);
    dispatchRate = RECOVERY_DISPATCH_CAP;
  }

  // 情绪门禁：过载状态跳过本轮派发
  const emotionState = cognitionSnapshot?.emotion?.state ?? 'calm';
  const emotionDispatchModifier = cognitionSnapshot?.emotion?.dispatch_rate_modifier ?? 1.0;
  if (emotionState === 'overloaded') {
    console.log('[tick] 情绪过载，跳过本轮派发（dispatch_rate_modifier=' + emotionDispatchModifier + '）');
    actionsTaken.push({ action: 'emotion_gate', emotion: emotionState, reason: 'overloaded_skip_dispatch' });
    return {
      success: true,
      alertness: alertnessResult,
      cognition: cognitionSnapshot,
      dispatch: { dispatched: 0, reason: 'emotion_overloaded' },
      actions_taken: actionsTaken,
      summary: { in_progress: inProgress.length, queued: queued.length, stale: staleTasks.length },
      next_tick: new Date(now.getTime() + TICK_INTERVAL_MINUTES * 60 * 1000).toISOString()
    };
  }

  // Use slot budget for max dispatch count (slot-allocator replaces flat AUTO_DISPATCH_MAX)
  const tickSlotBudget = await calculateSlotBudget();
  const poolCAvailable = tickSlotBudget.taskPool.available;
  // 保证有 slot 且 rate > 0 时至少能派发 1 个（Math.floor 会把 0.3~0.9 杀成 0）
  // 乘以情绪修正系数（focused/excited 加速，tired/anxious 减速）
  const effectiveDispatchMax = (poolCAvailable > 0 && dispatchRate > 0)
    ? Math.max(1, Math.floor(poolCAvailable * dispatchRate * emotionDispatchModifier))
    : 0;
  if (emotionDispatchModifier !== 1.0) {
    console.log(`[tick] 情绪派发修正: ${emotionState} × ${emotionDispatchModifier} → effectiveMax=${effectiveDispatchMax}`);
  }
  if (tickSlotBudget.user.mode !== 'absent') {
    console.log(`[tick] User mode: ${tickSlotBudget.user.mode} (${tickSlotBudget.user.used} headed), Pool C: ${poolCAvailable}/${tickSlotBudget.taskPool.budget}`);
  }
  if (dispatchRate < 1.0) {
    console.log(`[tick] Dispatch rate limited to ${Math.round(dispatchRate * 100)}% (max ${effectiveDispatchMax} tasks)`);
  }

  // Apply gradual ramp-up to avoid sudden load spikes
  const rampedDispatchMax = await getRampedDispatchMax(effectiveDispatchMax);

  // Backpressure: override burst limit when queue is deep
  const burstOverride = tickSlotBudget.backpressure?.override_burst_limit;
  const effectiveBurstLimit = burstOverride ?? MAX_NEW_DISPATCHES_PER_TICK;
  if (burstOverride != null) {
    console.log(`[tick] Backpressure active: queue_depth=${tickSlotBudget.backpressure.queue_depth} > ${tickSlotBudget.backpressure.threshold}, burst_limit=${effectiveBurstLimit}`);
  }

  // 7a. Fill slots from focused objective's tasks
  // Predictive resource gate: pre-deduct estimated memory per dispatched agent
  const ESTIMATED_AGENT_MEM_MB = 800;
  let memReservedMb = 0;
  let newDispatchCount = 0; // burst limiter 计数器
  for (let i = 0; i < rampedDispatchMax; i++) {
    // Burst limiter：单次 tick 新派发上限，防止队列积压后瞬间雪崩
    if (newDispatchCount >= effectiveBurstLimit) {
      console.log(`[tick] Burst limiter: reached effectiveBurstLimit=${effectiveBurstLimit}, stopping 7a dispatch`);
      break;
    }

    // Re-check resources with predicted memory usage
    if (memReservedMb > 0) {
      const predictedResources = checkServerResources(memReservedMb);
      if (!predictedResources.ok || predictedResources.metrics.max_pressure >= 0.9) {
        console.log(`[tick] Predictive gate: stopping dispatch (reserved=${memReservedMb}MB, predicted_pressure=${predictedResources.metrics.max_pressure})`);
        await logTickDecision(
          'tick',
          `Predictive gate: reserved ${memReservedMb}MB would exceed threshold`,
          { action: 'predictive_gate', reserved_mb: memReservedMb, predicted_pressure: predictedResources.metrics.max_pressure },
          { success: true }
        );
        break;
      }
    }

    // Area Fair Dispatch: 先选业务线，再在该线内选任务
    let areaGoalIds = allGoalIds; // fallback: 全局
    try {
      const { selectAreaForDispatch } = await import('./area-scheduler.js');
      const areaDecision = await selectAreaForDispatch(poolCAvailable);
      if (areaDecision.area && areaDecision.goalIds.length > 0) {
        areaGoalIds = areaDecision.goalIds;
        console.log(`[tick] Area dispatch: ${areaDecision.area} (${areaDecision.reason})`);
      }
    } catch (areaErr) {
      console.warn(`[tick] Area scheduler failed (fallback to global): ${areaErr.message}`);
    }

    const dispatchResult = await dispatchNextTask(areaGoalIds);
    actionsTaken.push(...dispatchResult.actions);
    lastDispatchResult = dispatchResult;
    console.log(`[tick] Dispatch attempt ${i}: dispatched=${dispatchResult.dispatched} reason=${dispatchResult.reason || 'ok'}`);

    if (!dispatchResult.dispatched) {
      if (dispatchResult.reason !== 'no_dispatchable_task') {
        await logTickDecision(
          'tick',
          `Dispatch stopped: ${dispatchResult.reason}`,
          { action: 'dispatch_skip', reason: dispatchResult.reason },
          { success: true }
        );
      }
      break;
    }
    dispatched++;
    newDispatchCount++;
    memReservedMb += ESTIMATED_AGENT_MEM_MB;
  }

  // 7b. If focus objective has no more tasks, fill remaining slots from ready KRs only
  if (dispatched < rampedDispatchMax && (!lastDispatchResult?.dispatched || lastDispatchResult?.reason === 'no_dispatchable_task')) {
    try {
      // Only use ready/in_progress KRs, not all objectives (OKR unification)
      if (readyKrIds.length > 0) {
        for (let i = dispatched; i < rampedDispatchMax; i++) {
          // Burst limiter：7b 同样受 effectiveBurstLimit 约束（含背压降速）
          if (newDispatchCount >= effectiveBurstLimit) {
            console.log(`[tick] Burst limiter: reached effectiveBurstLimit=${effectiveBurstLimit}, stopping 7b dispatch`);
            break;
          }
          const globalDispatch = await dispatchNextTask(readyKrIds);
          actionsTaken.push(...globalDispatch.actions);
          if (!globalDispatch.dispatched) break;
          dispatched++;
          newDispatchCount++;
        }
      }
    } catch (globalErr) {
      console.error('[tick-loop] Global dispatch error:', globalErr.message);
    }
  }

  const burstLimited = newDispatchCount >= effectiveBurstLimit;
  if (dispatched > 0) {
    console.log(`[tick-loop] Dispatched ${dispatched} tasks this tick (burst_limited=${burstLimited})`);
  }

  // 8. Update tick state
  await pool.query(`
    INSERT INTO working_memory (key, value_json, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
  `, [TICK_LAST_KEY, { timestamp: now.toISOString() }]);

  if (actionsTaken.length > 0) {
    await incrementActionsToday(actionsTaken.length);
  }

  // Record tick execution time for alertness metrics
  const tickDuration = Date.now() - tickStartTime;
  recordTickTime(tickDuration);

  // Record operation success (tick completed successfully)
  recordOperation(true, 'tick');

  // 9. Trigger dept heartbeats (每轮 Tick 末尾，为活跃部门创建 heartbeat task)
  let deptHeartbeatResult = { triggered: 0, skipped: 0, results: [] };
  try {
    deptHeartbeatResult = await triggerDeptHeartbeats(pool);
  } catch (deptErr) {
    console.error('[tick] dept heartbeat error:', deptErr.message);
  }

  // 10. Trigger daily code review (每天 02:00 UTC，为活跃 repo 创建 code_review task)
  let dailyReviewResult = { triggered: 0, skipped: 0, skipped_window: true, results: [] };
  try {
    dailyReviewResult = await triggerDailyReview(pool);
  } catch (reviewErr) {
    console.error('[tick] daily review error:', reviewErr.message);
  }

  // 10.1 每4小时 arch_review 巡检（guard: 上次 review 后至少1个 dev 任务完成）
  Promise.resolve().then(() => triggerArchReview(pool))
    .catch(e => console.warn('[tick] arch review scheduler 失败:', e.message));

  // 10.2 每日日报生成（15:00 UTC = 23:00 上海）
  Promise.resolve().then(() => generateDailyDiaryIfNeeded(pool))
    .catch(e => console.warn('[tick] diary scheduler 失败:', e.message));

  // 10.3 对话日志提炼（每 5 分钟扫描 ~/.claude-account1/projects/ .jsonl 文件）
  Promise.resolve().then(() => runConversationDigest())
    .catch(e => console.warn('[tick] conversation digest 失败:', e.message));

  // 10.4 Capture 消化（扫描 inbox captures → LLM 拆解为 atoms）
  Promise.resolve().then(() => runCaptureDigestion())
    .catch(e => console.warn('[tick] capture digestion 失败:', e.message));

  // 10.5 反刍回路（空闲时消化知识 → 洞察写入 memory_stream → Desire 自然消费）
  publishCognitiveState({ phase: 'rumination', detail: '反刍消化知识…' });
  let ruminationResult = null;
  try {
    ruminationResult = await runRumination(pool);
  } catch (rumErr) {
    console.error('[tick] rumination error:', rumErr.message);
  }

  // 10.7 内在叙事更新（每小时一次，fire-and-forget）
  try {
    const currentEmotion = getCurrentEmotion();
    updateNarrative(currentEmotion, pool).catch(e => console.warn('[tick] 叙事更新失败:', e.message));
  } catch { /* 静默 */ }

  // 10.8 欲望轨迹采集（每 6 小时一次，fire-and-forget，Layer 4）
  Promise.resolve().then(() => collectSelfReport(pool)).catch(e => console.warn('[tick] self-report 采集失败:', e.message));

  // 10.9 每日合并循环（UTC 19:00 = 北京凌晨 3:00，fire-and-forget）
  // 汇总今日对话/learnings/任务 → 情节记忆 + self-model 演化
  Promise.resolve().then(() => runDailyConsolidationIfNeeded(pool))
    .catch(e => console.warn('[tick] 每日合并失败:', e.message));

  // 10.10 NotebookLM 喂入（每天定时喂入 learnings/memory/OKR，fire-and-forget）
  Promise.resolve().then(() => feedDailyIfNeeded(pool))
    .catch(e => console.warn('[tick] notebook feeder 失败:', e.message));

  // 10.11 分层记忆压缩调度（daily/weekly/monthly synthesis，fire-and-forget）
  Promise.resolve().then(() => runSynthesisSchedulerIfNeeded(pool))
    .catch(e => console.warn('[tick] synthesis scheduler 失败:', e.message));

  // 10.12 分级报警刷新（P1 每小时，P2 每日，fire-and-forget）
  Promise.resolve().then(() => flushAlertsIfNeeded())
    .catch(e => console.warn('[tick] alerting flush 失败:', e.message));

  // 10.13 48h 系统简报检查（每 48h 生成一次，fire-and-forget）
  Promise.resolve().then(() => check48hReport(pool))
    .catch(e => console.warn('[tick] 48h 简报检查失败:', e.message));

  // 10.14 进化日志扫描（每日一次，自动记录 cecelia repo 新 PR，fire-and-forget）
  Promise.resolve().then(() => scanEvolutionIfNeeded(pool))
    .catch(e => console.warn('[tick] 进化日志扫描失败:', e.message));

  // 10.15 进化叙事合成（每 7 天一次，更新各器官叙事摘要，fire-and-forget）
  Promise.resolve().then(() => synthesizeEvolutionIfNeeded(pool))
    .catch(e => console.warn('[tick] 进化叙事合成失败:', e.message));

  // 10.16 每日契约扫描（UTC 03:00，检查模块边界是否有测试覆盖，fire-and-forget）
  Promise.resolve().then(() => triggerContractScan(pool))
    .catch(e => console.warn('[tick] 契约扫描失败:', e.message));

  // 10.17 每日内容选题（UTC 01:00 = 北京时间 09:00，AI 自动生成 ≥10 个选题，fire-and-forget）
  Promise.resolve().then(() => triggerDailyTopicSelection(pool))
    .catch(e => console.warn('[tick] 每日内容选题失败:', e.message));

  // 10.17b 每日发布调度（UTC 03:00 = 北京时间 11:00，处理 pending content_publish_jobs，fire-and-forget）
  Promise.resolve().then(() => triggerDailyPublish(pool))
    .catch(e => console.warn('[tick] 每日发布调度失败:', e.message));

  // 10.17d 每日内容日报（UTC 01:00 = 北京时间 09:00，汇总昨日数据，fire-and-forget）
  Promise.resolve().then(() => generateDailyReport(pool))
    .catch(e => console.warn('[tick] 每日内容日报失败:', e.message));

  // 10.17e 每周内容周报（每周一 UTC 01:00 = 北京时间 09:00，汇总上周数据，fire-and-forget）
  Promise.resolve().then(() => generateWeeklyReport(pool))
    .catch(e => console.warn('[tick] 每周内容周报失败:', e.message));

  // 10.17c 发布队列监控（每 tick，自动重试 failed 任务 + 更新今日统计，fire-and-forget）
  Promise.resolve().then(() => monitorPublishQueue(pool))
    .catch(e => console.warn('[tick] 发布队列监控失败:', e.message));

  // 10.17d 发布后数据回收（每 tick，触发 4h 后的平台数据采集，fire-and-forget）
  Promise.resolve().then(() => schedulePostPublishCollection(pool))
    .catch(e => console.warn('[tick] 发布后数据回收失败:', e.message));

  // 10.18 欲望解堵循环（每 tick，将高紧迫度 desires 转化为 suggestions，fire-and-forget）
  Promise.resolve().then(() => runSuggestionCycle(pool))
    .catch(e => console.warn('[tick] suggestion cycle 失败:', e.message));

  // 10.19 对话压缩（每 tick，将长对话自动摘要写入 memory_stream，fire-and-forget）
  Promise.resolve().then(() => runConversationConsolidator())
    .catch(e => console.warn('[tick] 对话压缩失败:', e.message));

  // 10.20 auto-memory 同步（每 30 分钟，将 memory/*.md 同步到 design_docs/decisions，fire-and-forget）
  Promise.resolve().then(() => memorySyncIfNeeded(pool))
    .catch(e => console.warn("[tick] memory-sync 失败:", e.message));

  // 11. 欲望系统（六层主动意识）
  publishCognitiveState({ phase: 'desire', detail: '感知与表达…' });
  let desireResult = null;
  try {
    desireResult = await runDesireSystem(pool);
  } catch (desireErr) {
    console.error('[tick] desire system error:', desireErr.message);
  }

  // 11.5 代码质量扫描（每天首次 tick 时触发）
  let scanResult = null;
  try {
    scanResult = await triggerCodeQualityScan(pool);
    if (scanResult?.triggered) {
      console.log('[tick] Code quality scan triggered:', scanResult);
    }
  } catch (scanErr) {
    console.error('[tick] code quality scan error:', scanErr.message);
  }

  // 12. 广播 tick:executed WebSocket 事件
  const nextTickAt = new Date(now.getTime() + TICK_INTERVAL_MINUTES * 60 * 1000).toISOString();
  try {
    const { publishTickExecuted } = await import('./events/taskEvents.js');
    publishTickExecuted({
      tick_number: actionsTaken.length,
      duration_ms: tickDuration,
      actions_taken: actionsTaken.length,
      next_tick_at: nextTickAt
    });
  } catch (wsErr) {
    console.error('[tick] WebSocket tick:executed broadcast failed:', wsErr.message);
  }

  // 13. 主动推送：检查新叙事（最近 10 分钟内写完的），直接推送给前端
  try {
    const recentNarrative = await pool.query(
      `SELECT content FROM memory_stream
       WHERE source_type = 'narrative'
         AND created_at > NOW() - INTERVAL '10 minutes'
       ORDER BY created_at DESC LIMIT 1`
    );
    if (recentNarrative.rows.length > 0) {
      const { publishCeceliaMessage } = await import('./events/taskEvents.js');
      publishCeceliaMessage({
        type: 'narrative',
        message: recentNarrative.rows[0].content.slice(0, 500),
        meta: { source: 'tick_proactive' },
      });
      console.log('[tick] 主动推送新叙事');
    }
  } catch (pushErr) {
    console.warn('[tick] 主动推送叙事失败（non-critical）:', pushErr.message);
  }

  return {
    success: true,
    alertness: alertnessResult,
    decision_engine: decisionEngineResult,
    focus: hasFocus ? {
      objective_id: objectiveId,
      objective_title: focus.objective.title
    } : null,
    dispatch: { dispatched: dispatched, last: lastDispatchResult, burst_limited: burstLimited },
    dept_heartbeats: deptHeartbeatResult,
    daily_review: dailyReviewResult,
    rumination: ruminationResult,
    desire_system: desireResult,
    cognition: cognitionSnapshot,
    actions_taken: actionsTaken,
    summary: {
      in_progress: inProgress.length,
      queued: queued.length,
      stale: staleTasks.length
    },
    tick_duration_ms: tickDuration,
    next_tick: nextTickAt
  };
}

/**
 * 生成 48h 系统简报内容（mock cortex 调用）
 * 查询近 48h 任务统计和系统健康状况，组装简报 JSON
 * @param {Pool} dbPool - PostgreSQL 连接池
 * @returns {Object} 简报内容对象
 */
async function generate48hReport(dbPool) {
  const periodHours = 48;
  const since = new Date(Date.now() - periodHours * 60 * 60 * 1000).toISOString();

  // 查询近 48h 任务统计
  const taskStats = await dbPool.query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'completed') AS completed,
      COUNT(*) FILTER (WHERE status = 'failed') AS failed,
      COUNT(*) FILTER (WHERE status = 'queued') AS queued,
      COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress,
      COUNT(*) FILTER (WHERE status = 'quarantined') AS quarantined,
      COUNT(*) AS total
    FROM tasks
    WHERE created_at >= $1
  `, [since]);

  // 查询近 48h 告警事件（P0/P1）
  const alertStats = await dbPool.query(`
    SELECT event_type, COUNT(*) AS count
    FROM cecelia_events
    WHERE created_at >= $1
      AND event_type IN ('p0_alert', 'p1_alert', 'task_failed', 'quarantine_triggered', 'circuit_breaker_open')
    GROUP BY event_type
    ORDER BY count DESC
    LIMIT 10
  `, [since]);

  // 查询隔离区统计
  const quarantineStats = await dbPool.query(`
    SELECT COUNT(*) AS count
    FROM tasks
    WHERE status = 'quarantined'
  `);

  // 组装简报内容
  const stats = taskStats.rows[0] || {};
  const completed = parseInt(stats.completed || 0, 10);
  const failed = parseInt(stats.failed || 0, 10);
  const total = parseInt(stats.total || 0, 10);
  const successRate = total > 0 ? Math.round((completed / total) * 100) : 0;

  const alertEvents = alertStats.rows || [];
  const hasAlerts = alertEvents.length > 0;

  // 简单健康评分（mock 逻辑，可后续替换为真实 cortex 分析）
  let healthScore = 100;
  if (failed > 5) healthScore -= 20;
  if (successRate < 70) healthScore -= 20;
  if (hasAlerts) healthScore -= alertEvents.reduce((acc, e) => acc + parseInt(e.count, 10), 0) * 2;
  healthScore = Math.max(0, Math.min(100, healthScore));

  const healthStatus = healthScore >= 80 ? 'healthy' : healthScore >= 60 ? 'degraded' : 'critical';

  return {
    period_hours: periodHours,
    period_start: since,
    period_end: new Date().toISOString(),
    tasks_summary: {
      total: parseInt(stats.total || 0, 10),
      completed: parseInt(stats.completed || 0, 10),
      failed: parseInt(stats.failed || 0, 10),
      queued: parseInt(stats.queued || 0, 10),
      in_progress: parseInt(stats.in_progress || 0, 10),
      quarantined: parseInt(stats.quarantined || 0, 10),
      success_rate_percent: successRate
    },
    system_health: {
      score: healthScore,
      status: healthStatus,
      quarantine_total: parseInt(quarantineStats.rows[0]?.count || 0, 10)
    },
    alert_events: alertEvents.map(e => ({ type: e.event_type, count: parseInt(e.count, 10) })),
    generated_by: 'mock_cortex', // TODO: 后续替换为真实 cortex 调用
    notes: `过去 ${periodHours} 小时系统自动摘要（mock 版本）`
  };
}

/**
 * 检查是否需要生成 48h 简报，如需要则调用 cortex.generateSystemReport() 生成
 * 检查时间间隔（REPORT_INTERVAL_MS，默认 48h），满足条件则触发生成
 * @param {Pool} dbPool - PostgreSQL 连接池（接口兼容性保留，cortex 使用自己的 pool）
 * @param {Object} options - 选项
 * @param {boolean} [options.force=false] - 强制触发（忽略时间检查）
 * @returns {Object|null} 生成的简报记录（含 id, created_at），或 null（未触发）
 */
async function check48hReport(dbPool, { force = false } = {}) {
  const elapsed = Date.now() - _lastReportTime;
  if (!force && elapsed < REPORT_INTERVAL_MS) {
    return null; // 未到触发时间
  }

  _lastReportTime = Date.now();
  console.log(`[tick] 触发 48h 系统简报生成（elapsed: ${Math.round(elapsed / 3600000)}h, force: ${force}）`);

  try {
    // 调用 cortex.generateSystemReport() 生成真实 AI 简报（含 LLM 深度分析）
    // cortex 内部使用自己的 pool 实例，并负责写入 system_reports 表
    const { generateSystemReport } = await import('./cortex.js');
    const report = await generateSystemReport({ timeRangeHours: 48 });

    if (!report || !report.id) {
      throw new Error('cortex.generateSystemReport 返回无效结果');
    }

    console.log(`[tick] 48h 简报已生成（by cortex），id: ${report.id}`);
    return { id: report.id, created_at: report.generated_at };
  } catch (err) {
    console.error('[tick] 48h 简报生成失败（non-critical）:', err.message);
    _lastReportTime = 0; // 重置时间，允许下次 tick 重试
    return null;
  }
}

/**
 * Start graceful drain — stop dispatching new tasks, let in_progress finish
 * When all in_progress tasks complete (checked via getDrainStatus), auto-disable tick.
 */
async function drainTick() {
  if (_draining) {
    return { success: true, already_draining: true, draining: true, drain_started_at: _drainStartedAt };
  }

  _draining = true;
  _drainStartedAt = new Date().toISOString();
  console.log(`[tick] Drain mode activated at ${_drainStartedAt}`);

  // Count in_progress tasks for initial status (no auto-complete on activation)
  const inProgressResult = await pool.query(
    "SELECT id, title, started_at FROM tasks WHERE status = 'in_progress' ORDER BY started_at"
  );

  return {
    success: true,
    draining: true,
    drain_started_at: _drainStartedAt,
    in_progress_tasks: inProgressResult.rows.map(t => ({
      id: t.id,
      title: t.title,
      started_at: t.started_at
    })),
    remaining: inProgressResult.rows.length
  };
}

/**
 * Get drain status — shows draining flag + in_progress tasks
 * Auto-completes drain when no in_progress tasks remain.
 */
async function getDrainStatus() {
  if (!_draining) {
    return { draining: false, in_progress_tasks: [], remaining: 0 };
  }

  const inProgressResult = await pool.query(
    "SELECT id, title, status, started_at FROM tasks WHERE status = 'in_progress' ORDER BY started_at"
  );

  const tasks = inProgressResult.rows;

  // Auto-complete drain: if no in_progress tasks remain, enter post-drain cooldown
  // (NOT disableTick — that would kill the entire tick loop, causing system-wide stop)
  if (tasks.length === 0) {
    console.log('[tick] Drain complete — no in_progress tasks remain, entering post-drain cooldown (dispatch rate → 1)');
    const drainEnd = new Date().toISOString();
    const startedAt = _drainStartedAt;
    _draining = false;
    _drainStartedAt = null;

    // Set post-drain cooldown: dispatch rate limited to 1 for 5 minutes
    _postDrainCooldown = true;
    if (_postDrainCooldownTimer) clearTimeout(_postDrainCooldownTimer);
    _postDrainCooldownTimer = setTimeout(() => {
      _postDrainCooldown = false;
      _postDrainCooldownTimer = null;
      console.log('[tick] Post-drain cooldown expired — dispatch rate restored to normal');
    }, 5 * 60 * 1000); // 5 minutes
    if (_postDrainCooldownTimer.unref) _postDrainCooldownTimer.unref();

    return {
      draining: false,
      drain_completed: true,
      post_drain_cooldown: true,
      drain_started_at: startedAt,
      drain_ended_at: drainEnd,
      in_progress_tasks: [],
      remaining: 0
    };
  }

  return {
    draining: true,
    drain_started_at: _drainStartedAt,
    in_progress_tasks: tasks.map(t => ({
      id: t.id,
      title: t.title,
      started_at: t.started_at
    })),
    remaining: tasks.length
  };
}

/**
 * Cancel drain mode — resume normal dispatching
 */
function cancelDrain() {
  if (!_draining) {
    return { success: true, was_draining: false };
  }

  console.log('[tick] Drain mode cancelled, resuming normal dispatch');
  _draining = false;
  _drainStartedAt = null;
  return { success: true, was_draining: true };
}

// Expose drain state for testing
function _getDrainState() {
  return { draining: _draining, drainStartedAt: _drainStartedAt, postDrainCooldown: _postDrainCooldown };
}
function _resetDrainState() {
  _draining = false;
  _drainStartedAt = null;
  _postDrainCooldown = false;
  if (_postDrainCooldownTimer) {
    clearTimeout(_postDrainCooldownTimer);
    _postDrainCooldownTimer = null;
  }
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

/** Reset throttle state — for testing only */
function _resetLastExecuteTime() { _lastExecuteTime = 0; }
/** Reset cleanup timer — for testing only */
function _resetLastCleanupTime() { _lastCleanupTime = 0; }
function _resetLastZombieCleanupTime() { _lastZombieCleanupTime = 0; }
/** Reset Layer 2 health check timer — for testing only */
function _resetLastHealthCheckTime() { _lastHealthCheckTime = 0; }
/** Reset KR progress sync timer — for testing only */
function _resetLastKrProgressSyncTime() { _lastKrProgressSyncTime = 0; }
/** Reset heartbeat timer — for testing only */
function _resetLastHeartbeatTime() { _lastHeartbeatTime = 0; }

function _resetLastGoalEvalTime() { _lastGoalEvalTime = 0; }
/** Reset zombie sweep timer — for testing only */
function _resetLastZombieSweepTime() { _lastZombieSweepTime = 0; }
/** Reset pipeline patrol timer — for testing only */
function _resetLastPipelinePatrolTime() { _lastPipelinePatrolTime = 0; }

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

  console.log('[tick] Codex immune task created (last check: ' +
    (lastCreatedAt ? new Date(lastCreatedAt).toISOString() : 'never') + ')');
  return { created: true, elapsed_ms: elapsed };
}

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
  dispatchNextTask,
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
  TASK_TYPE_AGENT_MAP,
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
  // Test helpers
  _resetLastExecuteTime,
  _resetLastCleanupTime,
  _resetLastZombieCleanupTime,
  _resetLastHealthCheckTime,
  _resetLastKrProgressSyncTime,
  _resetLastHeartbeatTime,
  _resetLastGoalEvalTime,
  _resetLastZombieSweepTime,
  _resetLastPipelinePatrolTime,
  GOAL_EVAL_INTERVAL_MS,
  // 48h 简报
  check48hReport,
  generate48hReport,
  REPORT_INTERVAL_MS
};
