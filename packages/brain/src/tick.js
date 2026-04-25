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
// resetTickStateForTests 直接从 tick-state.js 导入用于测试，不再 re-export
import { tickState } from './tick-state.js';
// Phase D Part 1.7b: executeTick 抽到 tick-runner.js
import { executeTick } from './tick-runner.js';

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
