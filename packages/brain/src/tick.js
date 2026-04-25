/**
 * Action Loop - Tick Mechanism
 * Implements automatic task progression through periodic ticks
 */

import crypto from 'crypto';
import pool from './db.js';
import { getDailyFocus } from './focus.js';
import { checkServerResources, probeTaskLiveness, killProcessTwoStage, requeueTask, MAX_SEATS, INTERACTIVE_RESERVE, getBillingPause } from './executor.js';
import { calculateSlotBudget } from './slot-allocator.js';
import { compareGoalProgress, generateDecision, executeDecision, splitActionsBySafety } from './decision.js';
import { planNextTask } from './planner.js';
import { emit } from './event-bus.js';
import { getAllStates } from './circuit-breaker.js';
import { processEvent as thalamusProcessEvent, EVENT_TYPES } from './thalamus.js';
import { executeDecision as executeThalamusDecision, expireStaleProposals } from './decision-executor.js';
import { initAlertness, evaluateAlertness, getCurrentAlertness, canDispatch, canPlan, getDispatchRate, ALERTNESS_LEVELS, LEVEL_NAMES } from './alertness/index.js';
import { getRecoveryStatus } from './alertness/healing.js';
import { recordTickTime, recordOperation } from './alertness/metrics.js';
import { getQuarantineStats, checkExpiredQuarantineTasks } from './quarantine.js';
import { runLayer2HealthCheck } from './health-monitor.js';
import { triggerDeptHeartbeats } from './dept-heartbeat.js';
import { triggerDailyReview, triggerContractScan, triggerArchReview } from './daily-review-scheduler.js';
import { generateDailyDiaryIfNeeded } from './diary-scheduler.js';
import { runConversationDigest } from './conversation-digest.js';
import { runCaptureDigestion } from './capture-digestion.js';
import { triggerDailyTopicSelection } from './topic-selection-scheduler.js';
import { autoPromoteSuggestions } from './topic-suggestion-manager.js';
import { triggerDailyPublish } from './daily-publish-scheduler.js';
import { generateDailyReport } from './daily-report-generator.js';
import { generateWeeklyReport } from './weekly-report-generator.js';
import { monitorPublishQueue } from './publish-monitor.js';
import { schedulePostPublishCollection } from './post-publish-data-collector.js';
import { syncSocialMediaData } from './social-media-sync.js';
import { runDesireSystem } from './desire/index.js';
import { runRumination } from './rumination.js';
import { runSynthesisSchedulerIfNeeded } from './rumination-scheduler.js';
import { runSuggestionCycle } from './suggestion-cycle.js';
import { runConversationConsolidator } from './conversation-consolidator.js';
import { feedDailyIfNeeded } from './notebook-feeder.js';
import { publishCognitiveState } from './events/taskEvents.js';
import { evaluateEmotion, getCurrentEmotion, updateSubjectiveTime, getSubjectiveTime, updateNarrative, recordTickEvent } from './cognitive-core.js';
import { collectSelfReport } from './self-report-collector.js';
import { runDailyConsolidationIfNeeded } from './consolidation.js';
import { flushAlertsIfNeeded } from './alerting.js';
import { scanEvolutionIfNeeded, synthesizeEvolutionIfNeeded } from './evolution-scanner.js';
import { triggerCodeQualityScan } from './task-generator-scheduler.js';
import { zombieSweep } from './zombie-sweep.js';
import { runPipelinePatrol } from './pipeline-patrol.js';
import { checkStuckPipelines } from './pipeline-watchdog.js';
import { memorySyncIfNeeded } from './memory-sync.js';
import { scheduleDailyScrape } from './daily-scrape-scheduler.js';
import { scheduleKR3ProgressReport } from './kr3-progress-scheduler.js';
import { processHarnessCiWatchers, processHarnessDeployWatchers } from './harness-watcher.js';
import { checkAndAlertExpiringCredentials, recoverAuthQuarantinedTasks, scanAuthLayerHealth, cleanupDuplicateRescueTasks, cancelCredentialAlertTasks } from './credential-expiry-checker.js';
import { isConsciousnessEnabled, reloadConsciousnessCache } from './consciousness-guard.js';
// Phase D Part 1.1: 48h 系统简报搬出 tick.js
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
// Phase D Part 1.4: dispatch helpers (selectNextDispatchableTask / processCortexTask) 搬出 tick.js
// autoCreateTasksFromCortex 仅 dispatch-helpers 内部用（与 processCortexTask 共调用），未在 tick.js 内引用，不在此 import
import {
  selectNextDispatchableTask,
  processCortexTask,
} from './dispatch-helpers.js';
// Phase D Part 1.5: dispatchNextTask + _dispatchViaWorkflowRuntime 搬出 tick.js
import {
  dispatchNextTask,
  _dispatchViaWorkflowRuntime,
} from './dispatcher.js';
// Phase D Part 1.6: routeTask / releaseBlockedTasks / autoFailTimedOutTasks / getRampedDispatchMax 搬出 tick.js
import {
  routeTask,
  releaseBlockedTasks,
  autoFailTimedOutTasks,
  getRampedDispatchMax,
} from './tick-helpers.js';
// Phase D Part 1.7a: 14 个 lastXxxTime + 5 个 loop 控制态收口到 tick-state.js
import { tickState, resetTickStateForTests } from './tick-state.js';

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

// Tick configuration
const TICK_INTERVAL_MINUTES = 2;
const TICK_LOOP_INTERVAL_MS = parseInt(process.env.CECELIA_TICK_INTERVAL_MS || '5000', 10); // 5 seconds between loop ticks
const TICK_TIMEOUT_MS = 60 * 1000; // 60 seconds max execution time

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

const CONSCIOUSNESS_RELOAD_INTERVAL_MS = 2 * 60 * 1000; // Phase 2: 2 minutes
const CREDENTIAL_CHECK_INTERVAL_MS = parseInt(process.env.CECELIA_CREDENTIAL_CHECK_INTERVAL_MS || String(30 * 60 * 1000), 10); // 30 minutes

const ZOMBIE_SWEEP_INTERVAL_MS = parseInt(process.env.CECELIA_ZOMBIE_SWEEP_INTERVAL_MS || String(30 * 60 * 1000), 10); // 30 minutes
const PIPELINE_PATROL_INTERVAL_MS = parseInt(process.env.CECELIA_PIPELINE_PATROL_INTERVAL_MS || String(5 * 60 * 1000), 10); // 5 minutes
const PIPELINE_WATCHDOG_INTERVAL_MS = parseInt(process.env.CECELIA_PIPELINE_WATCHDOG_INTERVAL_MS || String(30 * 60 * 1000), 10); // 30 minutes
const CLEANUP_WORKER_INTERVAL_MS = parseInt(process.env.CECELIA_CLEANUP_WORKER_INTERVAL_MS || String(10 * 60 * 1000), 10); // R4: 10 minutes
const ORPHAN_PR_WORKER_INTERVAL_MS = parseInt(process.env.CECELIA_ORPHAN_PR_WORKER_INTERVAL_MS || String(30 * 60 * 1000), 10); // Phase 1: 30 minutes

const GOAL_EVAL_INTERVAL_MS = parseInt(process.env.CECELIA_GOAL_EVAL_INTERVAL_MS || String(24 * 60 * 60 * 1000), 10); // 24 hours
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

/**
 * Run tick with reentry guard and timeout protection
 * @param {string} source - who triggered this tick
 * @param {Function} [tickFn] - optional tick function override (for testing)
 */
async function runTickSafe(source = 'loop', tickFn) {
  const doTick = tickFn || executeTick;

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
function startTickLoop() {
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

  tickLog(`[tick-loop] Started (interval: ${TICK_LOOP_INTERVAL_MS}ms)`);
  return true;
}

/**
 * Stop the tick loop
 */
function stopTickLoop() {
  if (!tickState.loopTimer) {
    tickLog('[tick-loop] No loop running, skipping stop');
    return false;
  }

  clearInterval(tickState.loopTimer);
  tickState.loopTimer = null;
  tickLog('[tick-loop] Stopped');
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
  if (tickState.loopTimer) {
    tickLog('[tick-loop] Recovery: tick loop already running, clearing recovery timer');
    if (tickState.recoveryTimer) {
      clearInterval(tickState.recoveryTimer);
      tickState.recoveryTimer = null;
    }
    return;
  }

  tickLog('[tick-loop] Recovery: attempting to start tick loop...');

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
        tickLog('[tick-loop] Recovery: tick disabled in DB, skipping');
        await _recordRecoveryAttempt(false, 'tick_disabled_in_db');
        return;
      }
    }

    // 成功：清除恢复 timer 并记录
    tickLog('[tick-loop] Recovery: tick loop started successfully, clearing recovery timer');
    if (tickState.recoveryTimer) {
      clearInterval(tickState.recoveryTimer);
      tickState.recoveryTimer = null;
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
      tickLog(`[tick-loop] Alertness system initialized`);
    } catch (alertErr) {
      console.error('[tick-loop] Alertness init failed:', alertErr.message);
    }

    // Ensure EventBus table exists
    const { ensureEventsTable } = await import('./event-bus.js');
    await ensureEventsTable();

    // Auto-enable tick from env var if set
    const envEnabled = process.env.CECELIA_TICK_ENABLED;
    if (envEnabled === 'true') {
      tickLog('[tick-loop] CECELIA_TICK_ENABLED=true, auto-enabling tick');
      await enableTick();
      return;
    }

    const status = await getTickStatus();
    if (status.enabled) {
      tickLog('[tick-loop] Tick is enabled in DB, starting loop on startup');
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
        tickLog('[tick-loop] tick_auto_recover: tick re-enabled after extended disable period');
      } else {
        tickLog(`[tick-loop] Tick is disabled in DB (${Math.round(minutesDisabled)}min, threshold ${TICK_AUTO_RECOVER_MINUTES}min), not starting loop`);
      }
    }

    // Start tick watchdog — independent timer that checks every 5 minutes
    // If tick is disabled by non-manual source (drain/alertness), auto-recover
    startTickWatchdog();
  } catch (err) {
    console.error('[tick-loop] Failed to init tick loop:', err.message);

    // 启动后台恢复 timer（每 INIT_RECOVERY_INTERVAL_MS 重试一次）
    if (!tickState.recoveryTimer) {
      tickLog(`[tick-loop] Starting background recovery timer (interval: ${INIT_RECOVERY_INTERVAL_MS}ms)`);
      tickState.recoveryTimer = setInterval(tryRecoverTickLoop, INIT_RECOVERY_INTERVAL_MS);
      // 允许进程在没有其他活跃引用时正常退出
      if (tickState.recoveryTimer.unref) {
        tickState.recoveryTimer.unref();
      }
    }
  }
}

// Phase D Part 1.3: tick watchdog 实现搬到 tick-watchdog.js，下方 import re-export。

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
      tickLog(`[tick] Alertness: ${LEVEL_NAMES[alertnessResult.level]} (score=${alertnessResult.score || 'N/A'})`);
      actionsTaken.push({
        action: 'alertness_check',
        level: alertnessResult.level,
        level_name: LEVEL_NAMES[alertnessResult.level],
        score: alertnessResult.score
      });
    }

    // In PANIC mode, skip everything except basic health checks
    if (alertnessResult.level >= ALERTNESS_LEVELS.PANIC) {
      tickLog('[tick] PANIC mode: skipping all operations, only heartbeat');
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
    tickLog(`[tick] 认知状态: 情绪=${emotionResult.label}(${emotionResult.state}), 队列=${queueDepth}, 成功率=${Math.round(successRate * 100)}%, 派发修正=${emotionResult.dispatch_rate_modifier}`);
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
  const zombieSweepElapsed = Date.now() - tickState.lastZombieSweepTime;
  if (zombieSweepElapsed >= ZOMBIE_SWEEP_INTERVAL_MS) {
    tickState.lastZombieSweepTime = Date.now();
    zombieSweep().then(r => {
      const summary = `worktrees:${r.worktrees.removed} processes:${r.processes.killed} locks:${r.lock_slots.removed}`;
      tickLog(`[tick] Zombie sweep done. ${summary}`);
    }).catch(err => {
      console.error('[tick] Zombie sweep failed (non-fatal):', err.message);
    });
  }

  // [感知] Pipeline Patrol 巡航：每 5 分钟检测卡住/孤儿 pipeline
  const pipelinePatrolElapsed = Date.now() - tickState.lastPipelinePatrolTime;
  if (pipelinePatrolElapsed >= PIPELINE_PATROL_INTERVAL_MS) {
    tickState.lastPipelinePatrolTime = Date.now();
    runPipelinePatrol(pool).then(r => {
      if (r.stuck > 0 || r.rescued > 0) {
        tickLog(`[tick] Pipeline patrol: scanned=${r.scanned} stuck=${r.stuck} rescued=${r.rescued}`);
      }
    }).catch(err => {
      console.error('[tick] Pipeline patrol failed (non-fatal):', err.message);
    });
  }

  // [Phase 2] Consciousness guard cache reload（每 2 分钟，容错 hook）
  // 防外部改 DB（UI/CLI 直接 UPDATE working_memory）未通过本进程 setter 时缓存失同步
  // 故意不放 MINIMAL_MODE 守护内：minimal 模式下 watchdog 仍可能传新 env，reload 是安全的
  const consciousnessReloadElapsed = Date.now() - tickState.lastConsciousnessReload;
  if (consciousnessReloadElapsed >= CONSCIOUSNESS_RELOAD_INTERVAL_MS) {
    tickState.lastConsciousnessReload = Date.now();
    Promise.resolve().then(() => reloadConsciousnessCache(pool))
      .catch(e => console.warn('[tick] consciousness reload failed:', e.message));
  }

  // [感知] Pipeline-level Watchdog：每 30 分钟检测 pipeline 整体是否卡死
  // 与 pipeline-patrol 正交（patrol 看 stage 超时，watchdog 看 pipeline 整体 6h 无进展）
  const pipelineWatchdogElapsed = Date.now() - tickState.lastPipelineWatchdogTime;
  if (!MINIMAL_MODE && pipelineWatchdogElapsed >= PIPELINE_WATCHDOG_INTERVAL_MS) {
    tickState.lastPipelineWatchdogTime = Date.now();
    Promise.resolve().then(() => checkStuckPipelines(pool)).then(r => {
      if (r.stuck > 0) {
        tickLog(`[tick] Pipeline watchdog: scanned=${r.scanned} stuck=${r.stuck}`);
      }
    }).catch(err => {
      console.warn('[tick] pipeline-watchdog failed (non-fatal):', err.message);
    });
  }

  // [R4] Orphan worktree 清理：每 10 分钟调一次 shell 脚本
  // 扫描白名单 worktree，若对应 PR 已 merged 超过 1h 且满足安全守卫则清理
  const cleanupWorkerElapsed = Date.now() - tickState.lastCleanupWorkerTime;
  if (!MINIMAL_MODE && cleanupWorkerElapsed >= CLEANUP_WORKER_INTERVAL_MS) {
    tickState.lastCleanupWorkerTime = Date.now();
    import('./cleanup-worker.js').then(({ runCleanupWorker }) => runCleanupWorker()).then(r => {
      if (r?.stdout) {
        const lines = r.stdout.split('\n').filter(Boolean);
        const cleaned = lines.filter(l => l.includes('[cleanup] removed')).length;
        if (cleaned > 0) {
          tickLog(`[tick] cleanup-worker: cleaned=${cleaned} lines=${lines.length}`);
        }
      }
      if (!r?.success && r?.error) {
        console.warn('[tick] cleanup-worker failed (non-fatal):', r.error);
      }
    }).catch(err => {
      console.warn('[tick] cleanup-worker threw (non-fatal):', err.message);
    });
  }

  // [Phase 1] Orphan PR Worker：每 30 分钟扫孤儿 cp-* PR（open > 2h + 无 Brain task + CI 绿 → 合并）
  const orphanPrWorkerElapsed = Date.now() - tickState.lastOrphanPrWorkerTime;
  if (!MINIMAL_MODE && orphanPrWorkerElapsed >= ORPHAN_PR_WORKER_INTERVAL_MS) {
    tickState.lastOrphanPrWorkerTime = Date.now();
    import('./orphan-pr-worker.js').then(({ scanOrphanPrs }) => scanOrphanPrs(pool)).then(r => {
      if (r.merged > 0 || r.labeled > 0) {
        tickLog(`[tick] orphan-pr-worker: scanned=${r.scanned} merged=${r.merged} labeled=${r.labeled} skipped=${r.skipped}`);
      }
    }).catch(err => {
      console.warn('[tick] orphan-pr-worker threw (non-fatal):', err.message);
    });
  }

  // [感知] 凭据有效期检查：每 30 分钟一次，过期前 4h 创建告警任务 + 凭据恢复后重排队
  const credentialCheckElapsed = Date.now() - tickState.lastCredentialCheckTime;
  if (!MINIMAL_MODE && credentialCheckElapsed >= CREDENTIAL_CHECK_INTERVAL_MS) {
    tickState.lastCredentialCheckTime = Date.now();
    checkAndAlertExpiringCredentials(pool).then(r => {
      if (r.alerted > 0) {
        tickLog(`[tick] [credential-checker] ⚠️ ${r.alerted} 个账号 token 即将过期，已创建告警任务`);
      }
    }).catch(err => {
      console.error('[tick] Credential expiry check failed (non-fatal):', err.message);
    });

    // [恢复] 凭据健康时，自动重排队因 auth 失败被隔离的业务任务（非 pipeline_rescue）
    recoverAuthQuarantinedTasks(pool).then(r => {
      if (r.recovered > 0) {
        tickLog(`[tick] [credential-recovery] ✅ ${r.recovered} 个 auth 隔离任务已恢复排队`);
      }
    }).catch(err => {
      console.error('[tick] Credential recovery failed (non-fatal):', err.message);
    });

    // [探针] 认证层健康度实时探针：检查近1小时 auth 失败率是否超阈值
    scanAuthLayerHealth(pool).then(r => {
      if (r.alerted > 0) {
        console.log(`[tick] [auth-layer-probe] ⚠️ ${r.alerted} 个账号 auth 失败率告警已创建`);
      }
    }).catch(err => {
      console.error('[tick] Auth layer health scan failed (non-fatal):', err.message);
    });

    // [清理] 救援风暴清理：凭据恢复后自动取消同分支重复的 quarantined pipeline_rescue 任务
    cleanupDuplicateRescueTasks(pool).then(r => {
      if (r.cancelled > 0) {
        tickLog(`[tick] [rescue-cleanup] ✅ ${r.branches} 个分支，取消 ${r.cancelled} 条重复 rescue 任务`);
      }
    }).catch(err => {
      console.error('[tick] Rescue storm cleanup failed (non-fatal):', err.message);
    });

    // [清理] 凭据告警任务清理：取消 quarantined/queued 的凭据告警任务（现已改用 raise() 轻量通道）
    cancelCredentialAlertTasks(pool).then(r => {
      if (r.cancelled > 0) {
        tickLog(`[tick] [credential-alert-cleanup] ✅ 取消 ${r.cancelled} 个 quarantined 凭据告警任务`);
      }
    }).catch(err => {
      console.error('[tick] Credential alert task cleanup failed (non-fatal):', err.message);
    });
  }

  // [感知] Layer 2 运行健康监控：每小时一次，纯 SQL，无 LLM
  const healthCheckElapsed = Date.now() - tickState.lastHealthCheckTime;
  if (healthCheckElapsed >= CLEANUP_INTERVAL_MS) {
    tickState.lastHealthCheckTime = Date.now();
    try {
      const healthResult = await runLayer2HealthCheck(pool);
      tickLog(`[tick] ${healthResult.summary}`);
    } catch (healthErr) {
      console.error('[tick] Layer2 health check failed (non-fatal):', healthErr.message);
    }
  }

  // [感知] KR 完成检查：Initiative → Scope → Project 全完成后关闭 KR
  try {
    const { checkKRCompletion } = await import('./kr-completion.js');
    const krResult = await checkKRCompletion(pool);
    if (krResult.closedCount > 0) {
      tickLog(`[TICK] KR 完成检查: ${krResult.closedCount} 个已关闭`);
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
    tickLog(`[TICK] Initiative 完成检查: ${initiativeResult.closedCount} 个已关闭`);
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
      tickLog(`[TICK] Scope 完成检查: ${scopeResult.closedCount} 个已关闭`);
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
      tickLog(`[TICK] Project 完成检查: ${projectResult.closedCount} 个已关闭`);
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
      tickLog(`[TICK] Initiative 激活: ${activated} 个从 pending → active`);
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
      tickLog(`[TICK] KR 激活: ${krsActivated} 个从 pending → in_progress`);
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
      tickLog(`[TICK] Project 容量管理: +${projectResult.activated} 激活, -${projectResult.deactivated} 降级`);
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
  const krProgressElapsed = Date.now() - tickState.lastKrProgressSyncTime;
  if (krProgressElapsed >= CLEANUP_INTERVAL_MS) {
    tickState.lastKrProgressSyncTime = Date.now();
    try {
      // 优先使用 kr-verifier（基于外部数据源，不可伪造）
      const { runAllVerifiers } = await import('./kr-verifier.js');
      const verifierResult = await runAllVerifiers();
      if (verifierResult.updated > 0) {
        tickLog(`[TICK] KR 指标验证: ${verifierResult.updated} 个 KR 已更新（基于数据源）`);
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
        tickLog(`[TICK] KR 进度同步（fallback）: ${krResult.updated} 个 KR 已更新`);
        actionsTaken.push({
          action: 'kr_progress_sync',
          updated_count: krResult.updated,
        });
      }
    } catch (krErr) {
      console.error('[tick] KR verifier/progress sync failed (non-fatal):', krErr.message);
    }
  }

  // [感知] KR 可信度日巡检：每 24h 一次，记录 warn/critical 状态供运维审计
  const krHealthElapsed = Date.now() - tickState.lastKrHealthDailyTime;
  if (krHealthElapsed >= CLEANUP_INTERVAL_MS * 24) {
    tickState.lastKrHealthDailyTime = Date.now();
    try {
      const { getKrVerifierHealth } = await import('./kr-verifier.js');
      const healthResult = await getKrVerifierHealth();
      const { summary, verifiers: vList } = healthResult;
      tickLog(`[TICK] KR 可信度日巡检: healthy=${summary.healthy} warn=${summary.warn} critical=${summary.critical}`);
      const problematics = vList.filter(v => v.health !== 'healthy');
      for (const v of problematics) {
        console.warn(`[TICK] KR 可信度问题 [${v.health.toUpperCase()}] "${v.kr_title}": issues=${v.issues.join(',')}`);
      }
      actionsTaken.push({
        action: 'kr_health_check',
        summary,
        issues_count: problematics.length,
      });
    } catch (krHealthErr) {
      console.error('[tick] KR health check failed (non-fatal):', krHealthErr.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // 感知层结束 — 以下是行动层（受 canDispatch/thalamus 控制）
  // ═══════════════════════════════════════════════════════════════════

  // 0. Thalamus: Analyze tick event (quick route for simple ticks)
  if (isConsciousnessEnabled()) {
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
      tickLog(`[tick] Thalamus decision: ${thalamusAction}`);

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
  } // end isConsciousnessEnabled() (thalamus)

  // 0.5. PR Plans Completion Check (三层拆解状态自动更新)
  try {
    const { checkPrPlansCompletion } = await import('./planner.js');
    const completedPrPlans = await checkPrPlansCompletion();
    if (completedPrPlans.length > 0) {
      tickLog(`[tick] Auto-completed ${completedPrPlans.length} PR Plans`);
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
      tickLog(`[tick] Created ${decompSummary.total_created} decomposition tasks (${activePaths} active paths)`);
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
      tickLog(`[tick] Crystallize orchestration: ${crystallizeResult.total_actions} actions (orchestrated=${crystallizeResult.summary.orchestrated}, skipped=${crystallizeResult.summary.skipped})`);
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

  // 0.5.5. Content Pipeline Orchestration — 已废除（阶段3：执行搬到 zenithjoy pipeline-worker）
  // orchestrateContentPipelines() 和 executeQueuedContentTasks() 不再从 tick 调用。
  // zenithjoy 的 pipeline-worker 负责轮询 pipeline_runs 并执行 6 阶段。
  // Cecelia 只提供 can-run 调度接口（POST /api/brain/can-run）。

  // 0.6. Recurring Tasks Check
  try {
    const { checkRecurringTasks } = await import('./recurring.js');
    const recurringCreated = await checkRecurringTasks(now);
    if (recurringCreated.length > 0) {
      tickLog(`[tick] Created ${recurringCreated.length} recurring task instances`);
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
  if (isConsciousnessEnabled()) {
  try {
    const { checkPendingFollowups } = await import('./pending-conversations.js');
    const { callLLM } = await import('./llm-caller.js');
    const { sendFollowUp } = await import('./proactive-mouth.js');
    const toFollowUp = await checkPendingFollowups(pool);
    if (toFollowUp.length > 0) {
      tickLog(`[tick] ${toFollowUp.length} 条待回音消息需要跟进`);
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
  } // end isConsciousnessEnabled() (pending followups)

  // 0.4.5. Zombie resource cleanup: 每 20 分钟清理一次 stale slots + 孤儿 worktrees
  const zombieElapsed = Date.now() - tickState.lastZombieCleanupTime;
  if (zombieElapsed >= ZOMBIE_CLEANUP_INTERVAL_MS) {
    try {
      const { runZombieCleanup } = await import('./zombie-cleaner.js');
      const zombieResult = await runZombieCleanup(pool);
      tickState.lastZombieCleanupTime = Date.now();
      if (zombieResult.slotsReclaimed > 0 || zombieResult.worktreesRemoved > 0) {
        tickLog(`[tick] Zombie cleanup: slots=${zombieResult.slotsReclaimed} worktrees=${zombieResult.worktreesRemoved}`);
      }
    } catch (zombieErr) {
      console.error('[tick] Zombie cleanup failed (non-fatal):', zombieErr.message);
    }
  }

  // 0.5. Periodic cleanup: run once per CLEANUP_INTERVAL_MS (default 1 hour)
  const cleanupElapsed = Date.now() - tickState.lastCleanupTime;
  if (cleanupElapsed >= CLEANUP_INTERVAL_MS) {
    try {
      const cleanupResult = await pool.query('SELECT run_periodic_cleanup() AS msg');
      const msg = cleanupResult.rows[0]?.msg || 'done';
      tickState.lastCleanupTime = Date.now();
      tickLog(`[tick] Periodic cleanup: ${msg}`);
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
        tickLog(`[tick] Archived ${archiveResult.rowCount} old learnings`);
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
        tickLog(`[tick] Expired ${expiredCount} stale proposals`);
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
        tickLog(`[tick] Progress evaluation: ${evaluationResults.length} tasks evaluated, ${alertCount} alerts`);

        // 如果有高风险任务，提升警觉度
        if (alertCount > 0) {
          alertnessResult.score += Math.min(alertCount * 10, 50); // 每个警报+10分，最多+50分
          alertnessResult.reasons.push(`${alertCount} tasks with progress anomalies detected`);
          tickLog(`[tick] Alertness increased due to progress anomalies: +${Math.min(alertCount * 10, 50)} points`);
        }
      }
    } catch (progressErr) {
      console.error('[tick] Progress evaluation failed (non-fatal):', progressErr.message);
    }
  }

  // 0.5.5. Goal Outer Loop 评估：每 24 小时评估一次所有活跃 KR 整体进展
  const goalEvalElapsed = Date.now() - tickState.lastGoalEvalTime;
  if (goalEvalElapsed >= GOAL_EVAL_INTERVAL_MS) {
    tickState.lastGoalEvalTime = Date.now();
    try {
      const { evaluateGoalOuterLoop } = await import('./goal-evaluator.js');
      const goalResults = await evaluateGoalOuterLoop(GOAL_EVAL_INTERVAL_MS);
      if (goalResults.length > 0) {
        const stalledCount = goalResults.filter(r => r.verdict === 'stalled').length;
        const attentionCount = goalResults.filter(r => r.verdict === 'needs_attention').length;
        tickLog(`[tick] Goal outer loop: ${goalResults.length} goals evaluated, ${stalledCount} stalled, ${attentionCount} needs_attention`);
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
  const heartbeatElapsed = Date.now() - tickState.lastHeartbeatTime;
  const { HEARTBEAT_INTERVAL_MS: HB_INTERVAL } = await import('./heartbeat-inspector.js');
  if (heartbeatElapsed >= HB_INTERVAL) {
    try {
      const { runHeartbeatInspection } = await import('./heartbeat-inspector.js');
      const hbResult = await runHeartbeatInspection(pool);
      tickState.lastHeartbeatTime = Date.now(); // 仅成功后更新，失败时下次 tick 立即重试
      if (!hbResult.skipped && hbResult.actions_count > 0) {
        tickLog(`[TICK] Heartbeat 巡检: ${hbResult.actions_count} 个行动`);
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

  // 0.15. Harness Watcher：每次 tick 处理 harness_ci_watch / harness_deploy_watch（内联 CI/CD 轮询）
  try {
    const ciResult = await processHarnessCiWatchers(pool);
    const deployResult = await processHarnessDeployWatchers(pool);
    if (ciResult.processed > 0 || deployResult.processed > 0) {
      actionsTaken.push({
        action: 'harness_watcher',
        ci: ciResult,
        deploy: deployResult,
      });
    }
  } catch (harnessWatchErr) {
    console.error('[tick] Harness watcher failed (non-fatal):', harnessWatchErr.message);
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
          await executeDecision(decision.decision_id);

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
    tickLog('[tick] No active Objective found, falling back to global task dispatch');
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
      tickLog(`[tick] Auto-unblocked ${recovered.length} expired blocked task(s)`);
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
    tickLog('[tick] No active goals found, skipping tick');
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
      tickLog(`[tick-loop] Liveness probe: ${livenessActions.length} tasks auto-failed`);
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
        tickLog(`[tick] Watchdog kill: task=${action.taskId} reason=${action.reason}`);
        const killResult = await killProcessTwoStage(action.taskId, action.pgid);
        if (killResult.killed) {
          // Phase 2: Emergency cleanup (worktree, lock slot, .dev-mode)
          try {
            const { emergencyCleanup } = await import('./emergency-cleanup.js');
            // 注：原代码有 `pidMap && pidMap.get?.(...)` 但 pidMap 从未定义（历史遗留），
            // 实际运行时会抛 ReferenceError 被外层 catch 吞，等效于 fallback 到 action.slot。
            const slot = action.slot;
            if (slot) {
              const cleanupResult = emergencyCleanup(action.taskId, slot);
              tickLog(`[tick] Emergency cleanup: wt=${cleanupResult.worktree} lock=${cleanupResult.lock}`);
            }
          } catch (cleanupErr) {
            console.error(`[tick] Emergency cleanup failed (non-fatal): ${cleanupErr.message}`);
          }

          const requeueResult = await requeueTask(action.taskId, action.reason, action.evidence);
          // P0 FIX: fallback quarantine 日志（竞态条件下 requeueTask 仍能 quarantine）
          if (requeueResult.reason === 'fallback_quarantine') {
            tickLog(`[tick] Watchdog fallback quarantine: task=${action.taskId} (race condition resolved)`);
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
        tickLog(`[tick] Watchdog warn: task=${action.taskId} reason=${action.reason}`);
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
        tickLog(`[tick] idle-session kill: pid=${action.pid} reason=${action.reason}`);
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
      tickLog(`[tick] Released ${blockedReleased.length} blocked task(s) back to queued`);
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
        tickLog(`[tick-loop] no_project_for_kr: KR "${planned.kr?.title}" has no linked project, decomposition-checker Check C will repair`);
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
    tickLog(`[tick] Planning disabled at alertness level ${LEVEL_NAMES[alertnessResult?.level || 0]}`);
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
        tickLog(`[tick] Requeued ${requeueResult.rowCount}/${requeueResult.rowCount + remaining} quota_exhausted task(s) (remaining=${remaining})`);
        requeueResult.rows.forEach(r => tickLog(`[tick]   - ${r.id} ${r.title}`));
      }
    } catch (requeueErr) {
      console.error('[tick] quota_exhausted requeue error (non-fatal):', requeueErr.message);
    }
  }

  // 7. Dispatch tasks — fill all available slots (scoped to focused objective first, then global)
  tickLog(`[tick] Phase 7 reached: queued=${queued.length} inProgress=${inProgress.length} allGoalIds=${allGoalIds.length}`);
  publishCognitiveState({ phase: 'dispatching', detail: '派发任务…' });
  //    Respect alertness level dispatch settings
  let dispatched = 0;
  let lastDispatchResult = null;

  // Check if dispatch is allowed (using enhanced alertness)
  const _canDispatchResult = canDispatch();
  tickLog(`[tick] canDispatch=${_canDispatchResult} alertness=${alertnessResult?.level || '?'}`);
  if (!_canDispatchResult) {
    tickLog(`[tick] Dispatch disabled at alertness level ${alertnessResult?.levelName || 'UNKNOWN'}`);
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
    tickLog(`[tick] Healing recovery active (phase=${healingStatus.phase}): capping dispatch rate ${Math.round(dispatchRate * 100)}% → ${Math.round(RECOVERY_DISPATCH_CAP * 100)}%`);
    dispatchRate = RECOVERY_DISPATCH_CAP;
  }

  // 情绪门禁：过载状态跳过本轮派发
  const emotionState = cognitionSnapshot?.emotion?.state ?? 'calm';
  const emotionDispatchModifier = cognitionSnapshot?.emotion?.dispatch_rate_modifier ?? 1.0;
  if (emotionState === 'overloaded') {
    tickLog('[tick] 情绪过载，跳过本轮派发（dispatch_rate_modifier=' + emotionDispatchModifier + '）');
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
    tickLog(`[tick] 情绪派发修正: ${emotionState} × ${emotionDispatchModifier} → effectiveMax=${effectiveDispatchMax}`);
  }
  if (tickSlotBudget.user.mode !== 'absent') {
    tickLog(`[tick] User mode: ${tickSlotBudget.user.mode} (${tickSlotBudget.user.used} headed), Pool C: ${poolCAvailable}/${tickSlotBudget.taskPool.budget}`);
  }
  if (dispatchRate < 1.0) {
    tickLog(`[tick] Dispatch rate limited to ${Math.round(dispatchRate * 100)}% (max ${effectiveDispatchMax} tasks)`);
  }

  // Apply gradual ramp-up to avoid sudden load spikes
  const rampedDispatchMax = await getRampedDispatchMax(effectiveDispatchMax);

  // Backpressure: override burst limit when queue is deep
  const burstOverride = tickSlotBudget.backpressure?.override_burst_limit;
  const effectiveBurstLimit = burstOverride ?? MAX_NEW_DISPATCHES_PER_TICK;
  if (burstOverride != null) {
    tickLog(`[tick] Backpressure active: queue_depth=${tickSlotBudget.backpressure.queue_depth} > ${tickSlotBudget.backpressure.threshold}, burst_limit=${effectiveBurstLimit}`);
  }

  // Harness v2 phase 推进器（PR-3）：A→B→C 晋级
  try {
    const { advanceHarnessInitiatives } = await import('./harness-phase-advancer.js');
    await advanceHarnessInitiatives(pool);
  } catch (err) {
    console.error('[harness-advance] tick error:', err.message);
  }

  // 7a. Fill slots from focused objective's tasks
  // Predictive resource gate: pre-deduct estimated memory per dispatched agent
  const ESTIMATED_AGENT_MEM_MB = 800;
  let memReservedMb = 0;
  let newDispatchCount = 0; // burst limiter 计数器
  for (let i = 0; i < rampedDispatchMax; i++) {
    // Burst limiter：单次 tick 新派发上限，防止队列积压后瞬间雪崩
    if (newDispatchCount >= effectiveBurstLimit) {
      tickLog(`[tick] Burst limiter: reached effectiveBurstLimit=${effectiveBurstLimit}, stopping 7a dispatch`);
      break;
    }

    // Re-check resources with predicted memory usage
    if (memReservedMb > 0) {
      const predictedResources = checkServerResources(memReservedMb);
      if (!predictedResources.ok || predictedResources.metrics.max_pressure >= 0.9) {
        tickLog(`[tick] Predictive gate: stopping dispatch (reserved=${memReservedMb}MB, predicted_pressure=${predictedResources.metrics.max_pressure})`);
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
        tickLog(`[tick] Area dispatch: ${areaDecision.area} (${areaDecision.reason})`);
      }
    } catch (areaErr) {
      console.warn(`[tick] Area scheduler failed (fallback to global): ${areaErr.message}`);
    }

    const dispatchResult = await dispatchNextTask(areaGoalIds);
    actionsTaken.push(...dispatchResult.actions);
    lastDispatchResult = dispatchResult;
    tickLog(`[tick] Dispatch attempt ${i}: dispatched=${dispatchResult.dispatched} reason=${dispatchResult.reason || 'ok'}`);

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
            tickLog(`[tick] Burst limiter: reached effectiveBurstLimit=${effectiveBurstLimit}, stopping 7b dispatch`);
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
    tickLog(`[tick-loop] Dispatched ${dispatched} tasks this tick (burst_limited=${burstLimited})`);
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

  // Update tick_stats (total_executions, last_executed_at in Shanghai UTC+8, last_duration_ms)
  // Uses transaction + parameterized queries ($1, $2) to ensure data consistency and prevent injection
  let statsClient;
  try {
    statsClient = await pool.connect();
    await statsClient.query('BEGIN');
    const statsRow = await statsClient.query(
      'SELECT value_json FROM working_memory WHERE key = $1 FOR UPDATE',
      [TICK_STATS_KEY]
    );
    const currentStats = statsRow.rows[0]?.value_json || { total_executions: 0 };
    const newTotalExec = (currentStats.total_executions || 0) + 1;
    // Format as "YYYY-MM-DD HH:mm:ss" using Intl API for accurate Asia/Shanghai timezone
    const lastExecutedAt = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' });
    // All values passed as parameterized query args ($1, $2) — no string interpolation into SQL
    const newStats = { total_executions: newTotalExec, last_executed_at: lastExecutedAt, last_duration_ms: tickDuration };
    await statsClient.query(
      'INSERT INTO working_memory (key, value_json, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()',
      [TICK_STATS_KEY, newStats]
    );
    await statsClient.query('COMMIT');
  } catch (statsErr) {
    if (statsClient) await statsClient.query('ROLLBACK').catch(() => {});
    console.error('[tick] Failed to update tick_stats:', statsErr.message);
  } finally {
    if (statsClient) statsClient.release();
  }

  // Record operation success (tick completed successfully)
  recordOperation(true, 'tick');

  // 9. Trigger dept heartbeats (每轮 Tick 末尾，为活跃部门创建 heartbeat task)
  // CONSCIOUSNESS_ENABLED=false 时跳过，避免 heartbeat 噪音干扰手动 pipeline 验证
  let deptHeartbeatResult = { triggered: 0, skipped: 0, results: [] };
  if (isConsciousnessEnabled()) {
    try {
      deptHeartbeatResult = await triggerDeptHeartbeats(pool);
    } catch (deptErr) {
      console.error('[tick] dept heartbeat error:', deptErr.message);
    }
  }

  // 结果变量声明在 MINIMAL_MODE 块外 —— return 语句在块外引用这些变量（line ~3224-3225）
  // 否则 MINIMAL_MODE=true 或 !isConsciousnessEnabled 时 ReferenceError
  let dailyReviewResult = { triggered: 0, skipped: 0, skipped_window: true, results: [] };
  let ruminationResult = null;

  // 10.x 所有自动调度 — MINIMAL_MODE 下全部跳过
  if (!MINIMAL_MODE) {

  // 10. Trigger daily code review (每天 02:00 UTC，为活跃 repo 创建 code_review task)
  try {
    dailyReviewResult = await triggerDailyReview(pool);
  } catch (reviewErr) {
    console.error('[tick] daily review error:', reviewErr.message);
  }

  // 10.1 每4小时 arch_review 巡检（guard: 上次 review 后至少1个 dev 任务完成）
  Promise.resolve().then(() => triggerArchReview(pool))
    .catch(e => console.warn('[tick] arch review scheduler 失败:', e.message));

  // 10.2 每日日报生成（15:00 UTC = 23:00 上海，CONSCIOUSNESS_ENABLED=false 时跳过）
  if (isConsciousnessEnabled()) {
    Promise.resolve().then(() => generateDailyDiaryIfNeeded(pool))
      .catch(e => console.warn('[tick] diary scheduler 失败:', e.message));
  }

  // 10.3–10.8 LLM 后台调用（CONSCIOUSNESS_ENABLED=false 时全部跳过）
  if (isConsciousnessEnabled()) {

  // 10.3 对话日志提炼（每 5 分钟扫描 ~/.claude-account1/projects/ .jsonl 文件）
  Promise.resolve().then(() => runConversationDigest())
    .catch(e => console.warn('[tick] conversation digest 失败:', e.message));

  // 10.4 Capture 消化（扫描 inbox captures → LLM 拆解为 atoms）
  Promise.resolve().then(() => runCaptureDigestion())
    .catch(e => console.warn('[tick] capture digestion 失败:', e.message));

  // 10.5 反刍回路（空闲时消化知识 → 洞察写入 memory_stream → Desire 自然消费）
  publishCognitiveState({ phase: 'rumination', detail: '反刍消化知识…' });
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

  } // end isConsciousnessEnabled() (10.3–10.8 LLM calls)

  // 10.9 每日合并循环（UTC 19:00 = 北京凌晨 3:00，fire-and-forget）
  // 汇总今日对话/learnings/任务 → 情节记忆 + self-model 演化
  Promise.resolve().then(() => runDailyConsolidationIfNeeded(pool))
    .catch(e => console.warn('[tick] 每日合并失败:', e.message));

  // 10.10 NotebookLM 喂入（每天定时喂入 learnings/memory/OKR，fire-and-forget）
  if (isConsciousnessEnabled()) {
    Promise.resolve().then(() => feedDailyIfNeeded(pool))
      .catch(e => console.warn('[tick] notebook feeder 失败:', e.message));
  }

  // 10.11 分层记忆压缩调度（daily/weekly/monthly synthesis，fire-and-forget）
  if (isConsciousnessEnabled()) {
    Promise.resolve().then(() => runSynthesisSchedulerIfNeeded(pool))
      .catch(e => console.warn('[tick] synthesis scheduler 失败:', e.message));
  }

  // 10.12 分级报警刷新（P1 每小时，P2 每日，fire-and-forget）
  Promise.resolve().then(() => flushAlertsIfNeeded())
    .catch(e => console.warn('[tick] alerting flush 失败:', e.message));

  // 10.13 48h 系统简报检查（每 48h 生成一次，fire-and-forget）
  Promise.resolve().then(() => check48hReport(pool))
    .catch(e => console.warn('[tick] 48h 简报检查失败:', e.message));

  // 10.14 + 10.15 进化日志扫描 & 叙事合成（CONSCIOUSNESS_ENABLED=false 时跳过）
  if (isConsciousnessEnabled()) {
    // 10.14 进化日志扫描（每日一次，自动记录 cecelia repo 新 PR，fire-and-forget）
    Promise.resolve().then(() => scanEvolutionIfNeeded(pool))
      .catch(e => console.warn('[tick] 进化日志扫描失败:', e.message));

    // 10.15 进化叙事合成（每 7 天一次，更新各器官叙事摘要，fire-and-forget）
    Promise.resolve().then(() => synthesizeEvolutionIfNeeded(pool))
      .catch(e => console.warn('[tick] 进化叙事合成失败:', e.message));
  }

  // 10.16 每日契约扫描（UTC 03:00，检查模块边界是否有测试覆盖，fire-and-forget）
  Promise.resolve().then(() => triggerContractScan(pool))
    .catch(e => console.warn('[tick] 契约扫描失败:', e.message));

  // 10.17 每日内容选题（UTC 01:00 = 北京时间 09:00，AI 自动生成 ≥10 个选题，fire-and-forget）
  Promise.resolve().then(() => triggerDailyTopicSelection(pool))
    .catch(e => console.warn('[tick] 每日内容选题失败:', e.message));

  // 10.17c 选题推荐自动晋级（每 tick 检查 pending 超过 2h 的建议，fire-and-forget）
  Promise.resolve().then(() => autoPromoteSuggestions(pool))
    .catch(e => console.warn('[tick] 选题自动晋级失败:', e.message));

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

  // 10.17e social_media_raw 数据同步（每 tick，将本机 raw DB 同步到 content_analytics，fire-and-forget）
  Promise.resolve().then(() => syncSocialMediaData(pool))
    .catch(e => console.warn('[tick] social-media-sync 失败:', e.message));

  // 10.17f 每日全平台采集调度（UTC 20:00 = 北京时间次日 04:00，fire-and-forget）
  Promise.resolve().then(() => scheduleDailyScrape(pool))
    .catch(e => console.warn('[tick] 每日平台采集调度失败:', e.message));

  // 10.17g KR3 每日进度报告（UTC 06:00 = 北京时间 14:00，fire-and-forget）
  Promise.resolve().then(() => scheduleKR3ProgressReport(pool))
    .catch(e => console.warn('[tick] KR3 进度报告失败:', e.message));

  // 10.18 欲望解堵循环（每 tick，将高紧迫度 desires 转化为 suggestions，CONSCIOUSNESS_ENABLED=false 时跳过）
  if (isConsciousnessEnabled()) {
    Promise.resolve().then(() => runSuggestionCycle(pool))
      .catch(e => console.warn('[tick] suggestion cycle 失败:', e.message));
  }

  // 10.19 对话压缩（每 tick，将长对话自动摘要写入 memory_stream，CONSCIOUSNESS_ENABLED=false 时跳过）
  if (isConsciousnessEnabled()) {
    Promise.resolve().then(() => runConversationConsolidator())
      .catch(e => console.warn('[tick] 对话压缩失败:', e.message));
  }

  // 10.20 auto-memory 同步（每 30 分钟，将 memory/*.md 同步到 design_docs/decisions，fire-and-forget）
  Promise.resolve().then(() => memorySyncIfNeeded(pool))
    .catch(e => console.warn("[tick] memory-sync 失败:", e.message));

  } // end !MINIMAL_MODE (10.x 所有自动调度)

  // 11. 欲望系统（六层主动意识）— CONSCIOUSNESS_ENABLED=false 时跳过
  let desireResult = null;
  if (isConsciousnessEnabled()) {
    publishCognitiveState({ phase: 'desire', detail: '感知与表达…' });
    try {
      desireResult = await runDesireSystem(pool);
    } catch (desireErr) {
      console.error('[tick] desire system error:', desireErr.message);
    }
  }

  // 11.5 代码质量扫描（每天首次 tick 时触发）— CONSCIOUSNESS_ENABLED=false 时跳过
  let scanResult = null;
  if (isConsciousnessEnabled()) {
    try {
      scanResult = await triggerCodeQualityScan(pool);
      if (scanResult?.triggered) {
        tickLog('[tick] Code quality scan triggered:', scanResult);
      }
    } catch (scanErr) {
      console.error('[tick] code quality scan error:', scanErr.message);
    }
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
      tickLog('[tick] 主动推送新叙事');
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

/** Reset throttle state — for testing only */
function _resetLastExecuteTime() { tickState.lastExecuteTime = 0; }
/** Reset cleanup timer — for testing only */
function _resetLastCleanupTime() { tickState.lastCleanupTime = 0; }
function _resetLastZombieCleanupTime() { tickState.lastZombieCleanupTime = 0; }
/** Reset Layer 2 health check timer — for testing only */
function _resetLastHealthCheckTime() { tickState.lastHealthCheckTime = 0; }
/** Reset KR progress sync timer — for testing only */
function _resetLastKrProgressSyncTime() { tickState.lastKrProgressSyncTime = 0; }
/** Reset heartbeat timer — for testing only */
function _resetLastHeartbeatTime() { tickState.lastHeartbeatTime = 0; }

function _resetLastGoalEvalTime() { tickState.lastGoalEvalTime = 0; }
/** Reset zombie sweep timer — for testing only */
function _resetLastZombieSweepTime() { tickState.lastZombieSweepTime = 0; }
/** Reset pipeline patrol timer — for testing only */
function _resetLastPipelinePatrolTime() { tickState.lastPipelinePatrolTime = 0; }

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
