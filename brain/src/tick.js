/**
 * Action Loop - Tick Mechanism
 * Implements automatic task progression through periodic ticks
 */

import pool from './db.js';
import { getDailyFocus } from './focus.js';
import { updateTask } from './actions.js';
import { triggerCeceliaRun, checkCeceliaRunAvailable, getActiveProcessCount, killProcess, cleanupOrphanProcesses, checkServerResources, probeTaskLiveness, syncOrphanTasksOnStartup, killProcessTwoStage, requeueTask, MAX_SEATS, INTERACTIVE_RESERVE, getBillingPause } from './executor.js';
import { compareGoalProgress, generateDecision, executeDecision } from './decision.js';
import { planNextTask } from './planner.js';
import { emit } from './event-bus.js';
import { isAllowed, recordSuccess, recordFailure, getAllStates } from './circuit-breaker.js';
import { cleanupOrphanedTaskRefs } from './anti-crossing.js';
import { publishTaskStarted, publishExecutorStatus } from './events/taskEvents.js';
import { processEvent as thalamusProcessEvent, EVENT_TYPES } from './thalamus.js';
import { executeDecision as executeThalamusDecision } from './decision-executor.js';
import { initAlertness, evaluateAndUpdate as evaluateAlertness, getAlertness, canDispatch as canDispatchOld, canPlan, getDispatchRate as getDispatchRateOld, tryConsumeToken, ALERTNESS_LEVELS, LEVEL_NAMES } from './alertness.js';
import { evaluateAlertness as evaluateAlertnessEnhanced, getCurrentAlertness, canDispatch as canDispatchEnhanced, getDispatchRate as getDispatchRateEnhanced } from './alertness/index.js';
import { recordTickTime, recordOperation } from './alertness/metrics.js';
import { handleTaskFailure, getQuarantineStats, checkExpiredQuarantineTasks } from './quarantine.js';

// Tick configuration
const TICK_INTERVAL_MINUTES = 5;
const TICK_LOOP_INTERVAL_MS = parseInt(process.env.CECELIA_TICK_INTERVAL_MS || '5000', 10); // 5 seconds between loop ticks
const TICK_TIMEOUT_MS = 60 * 1000; // 60 seconds max execution time
const STALE_THRESHOLD_HOURS = 24; // Tasks in_progress for more than 24h are stale
const DISPATCH_TIMEOUT_MINUTES = parseInt(process.env.DISPATCH_TIMEOUT_MINUTES || '60', 10); // Auto-fail dispatched tasks after 60 min
// MAX_SEATS imported from executor.js — calculated from actual resource capacity
const MAX_CONCURRENT_TASKS = MAX_SEATS;
// INTERACTIVE_RESERVE imported from executor.js (also used for threshold calculation)
const AUTO_DISPATCH_MAX = Math.max(MAX_SEATS - INTERACTIVE_RESERVE, 1);
const AUTO_EXECUTE_CONFIDENCE = 0.8; // Auto-execute decisions with confidence >= this

// Task type to agent skill mapping
const TASK_TYPE_AGENT_MAP = {
  'dev': '/dev',           // Caramel - 编程
  'talk': '/talk',         // 对话任务 → HK MiniMax
  'qa': '/qa',             // 小检 - QA
  'audit': '/audit',       // 小审 - 审计
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

// Drain state (in-memory)
let _draining = false;
let _drainStartedAt = null;

/**
 * Get tick status
 */
async function getTickStatus() {
  const result = await pool.query(`
    SELECT key, value_json FROM working_memory
    WHERE key IN ($1, $2, $3, $4)
  `, [TICK_ENABLED_KEY, TICK_LAST_KEY, TICK_ACTIONS_TODAY_KEY, TICK_LAST_DISPATCH_KEY]);

  const memory = {};
  for (const row of result.rows) {
    memory[row.key] = row.value_json;
  }

  const enabled = memory[TICK_ENABLED_KEY]?.enabled ?? false;
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

  // Get quarantine stats
  let quarantineStats = { total: 0 };
  try {
    quarantineStats = await getQuarantineStats();
  } catch { /* ignore */ }

  return {
    enabled,
    loop_running: _loopTimer !== null,
    draining: _draining,
    drain_started_at: _drainStartedAt,
    interval_minutes: TICK_INTERVAL_MINUTES,
    loop_interval_ms: TICK_LOOP_INTERVAL_MS,
    last_tick: lastTick,
    next_tick: nextTick,
    actions_today: actionsToday,
    tick_running: _tickRunning,
    last_dispatch: lastDispatch,
    max_concurrent: MAX_CONCURRENT_TASKS,
    auto_dispatch_max: AUTO_DISPATCH_MAX,
    resources: checkServerResources(),
    dispatch_timeout_minutes: DISPATCH_TIMEOUT_MINUTES,
    circuit_breakers: getAllStates(),
    alertness: getAlertness(),
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
  // Reentry guard: check if already running
  if (_tickRunning) {
    // Timeout protection: release lock if held too long
    if (_tickLockTime && (Date.now() - _tickLockTime > TICK_TIMEOUT_MS)) {
      console.warn(`[tick-loop] Tick lock held for >${TICK_TIMEOUT_MS}ms, force-releasing (source: ${source})`);
      _tickRunning = false;
      _tickLockTime = null;
    } else {
      console.log(`[tick-loop] Tick already running, skipping (source: ${source})`);
      return { skipped: true, reason: 'already_running', source };
    }
  }

  _tickRunning = true;
  _tickLockTime = Date.now();

  try {
    const result = await doTick();
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

  _loopTimer = setInterval(async () => {
    try {
      await runTickSafe('loop');
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
 * Initialize tick loop on server startup
 * Checks DB state and starts loop if tick is enabled
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

    // Clean up orphan processes from previous server runs
    const orphansKilled = cleanupOrphanProcesses();
    if (orphansKilled > 0) {
      console.log(`[tick-loop] Cleaned up ${orphansKilled} orphan processes on startup`);
    }

    // Sync DB state with actual processes (fix orphan in_progress tasks)
    try {
      const syncResult = await syncOrphanTasksOnStartup();
      if (syncResult.orphans_fixed > 0 || syncResult.rebuilt > 0) {
        console.log(`[tick-loop] Startup sync: ${syncResult.orphans_fixed} orphans fixed, ${syncResult.rebuilt} processes rebuilt`);
      }
    } catch (syncErr) {
      console.error('[tick-loop] Startup sync failed:', syncErr.message);
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
      console.log('[tick-loop] Tick is disabled in DB, not starting loop');
    }
  } catch (err) {
    console.error('[tick-loop] Failed to init tick loop:', err.message);
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
 */
async function disableTick() {
  await pool.query(`
    INSERT INTO working_memory (key, value_json, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
  `, [TICK_ENABLED_KEY, { enabled: false }]);

  stopTickLoop();

  return { success: true, enabled: false, loop_running: false };
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
 * @returns {Object|null} - The next task to dispatch, or null
 */
async function selectNextDispatchableTask(goalIds) {
  // Check if P2 tasks should be paused (alertness mitigation)
  const { getMitigationState } = await import('./alertness-actions.js');
  const mitigationState = getMitigationState();

  // Query queued tasks with payload for dependency checking
  // Watchdog backoff: skip tasks with next_run_at in the future
  // next_run_at is always written as UTC ISO-8601 by requeueTask().
  // Safety: NULL, empty string, or unparseable values are treated as "no backoff".
  const result = await pool.query(`
    SELECT t.id, t.title, t.status, t.priority, t.started_at, t.updated_at, t.payload
    FROM tasks t
    WHERE t.goal_id = ANY($1)
      AND t.status = 'queued'
      AND (
        t.payload->>'next_run_at' IS NULL
        OR t.payload->>'next_run_at' = ''
        OR (t.payload->>'next_run_at')::timestamptz <= NOW()
      )
    ORDER BY
      CASE t.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
      t.created_at ASC
  `, [goalIds]);

  for (const task of result.rows) {
    // Skip P2 tasks if mitigation is active (EMERGENCY+ state)
    if (mitigationState.p2_paused && task.priority === 'P2') {
      console.log(`[tick] Skipping P2 task ${task.id} (alertness mitigation active)`);
      continue;
    }

    const dependsOn = task.payload?.depends_on;
    if (Array.isArray(dependsOn) && dependsOn.length > 0) {
      // Check if all dependencies are completed
      const depResult = await pool.query(
        "SELECT COUNT(*) FROM tasks WHERE id = ANY($1) AND status != 'completed'",
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

    // Update task to failed with error in payload
    const updatedPayload = {
      ...task.payload,
      rca_error: {
        error: err.message,
        failed_at: new Date().toISOString()
      }
    };
    await pool.query(`
      UPDATE tasks SET status = $1, payload = $2, updated_at = NOW()
      WHERE id = $3
    `, ['failed', JSON.stringify(updatedPayload), task.id]);

    actions.push({
      action: 'cortex-failed',
      task_id: task.id,
      error: err.message
    });

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
    return {
      dispatched: false,
      reason: 'draining',
      detail: _draining ? `Drain mode active since ${_drainStartedAt}` : 'Alertness COMA drain mode',
      actions
    };
  }

  // 0a. Billing pause check — skip dispatch if API billing cap is active
  const billingPause = getBillingPause();
  if (billingPause.active) {
    return { dispatched: false, reason: 'billing_pause', detail: `Billing cap active until ${billingPause.resetTime}`, actions };
  }

  // 0. Server resource check — dynamic slot scaling based on actual load
  const resources = checkServerResources();
  if (!resources.ok) {
    return { dispatched: false, reason: 'server_overloaded', detail: resources.reason, metrics: resources.metrics, actions };
  }

  // 1. Check concurrency — use dynamic effectiveSlots from resource check
  const effectiveLimit = Math.min(AUTO_DISPATCH_MAX, resources.effectiveSlots);
  const activeResult = await pool.query(
    "SELECT COUNT(*) FROM tasks WHERE goal_id = ANY($1) AND status = 'in_progress'",
    [goalIds]
  );
  const dbActiveCount = parseInt(activeResult.rows[0].count);
  const processActiveCount = getActiveProcessCount();
  const activeCount = Math.max(dbActiveCount, processActiveCount);
  if (activeCount >= effectiveLimit) {
    return { dispatched: false, reason: 'max_concurrent_reached', active: activeCount, limit: effectiveLimit, effective_slots: resources.effectiveSlots, pressure: resources.metrics.max_pressure, db_active: dbActiveCount, process_active: processActiveCount, actions };
  }

  // 2. Circuit breaker check
  if (!isAllowed('cecelia-run')) {
    return { dispatched: false, reason: 'circuit_breaker_open', actions };
  }

  // 2a. P1 FIX: Token bucket rate limiting check
  const tokenResult = tryConsumeToken('dispatch');
  if (!tokenResult.allowed) {
    return {
      dispatched: false,
      reason: 'rate_limited',
      detail: tokenResult.reason,
      remaining: tokenResult.remaining,
      actions
    };
  }

  // 3. Select next task (with dependency check)
  const nextTask = await selectNextDispatchableTask(goalIds);
  if (!nextTask) {
    return { dispatched: false, reason: 'no_dispatchable_task', actions };
  }

  // 3a. Check if task requires Cortex processing (Brain-internal RCA)
  if (nextTask.payload && nextTask.payload.requires_cortex === true) {
    return await processCortexTask(nextTask, actions);
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
    await logTickDecision(
      'tick',
      `cecelia-run not available, task status updated only`,
      { action: 'no-executor', task_id: nextTask.id, reason: ceceliaAvailable.error },
      { success: true, warning: 'cecelia-run not available' }
    );
    return { dispatched: true, reason: 'no_executor', task_id: nextTask.id, actions };
  }

  const fullTaskResult = await pool.query('SELECT * FROM tasks WHERE id = $1', [nextTask.id]);
  if (fullTaskResult.rows.length === 0) {
    return { dispatched: false, reason: 'task_not_found', task_id: nextTask.id, actions };
  }

  const execResult = await triggerCeceliaRun(fullTaskResult.rows[0]);

  _lastDispatchTime = Date.now();

  // Publish WebSocket event: task started (non-blocking, errors don't break dispatch)
  try {
    publishTaskStarted({
      id: nextTask.id,
      run_id: execResult.runId,
      title: nextTask.title
    });

    // Publish executor status update
    publishExecutorStatus(activeCount + 1, effectiveLimit - activeCount - 1, MAX_CONCURRENT_TASKS);
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

  return { dispatched: true, task_id: nextTask.id, run_id: execResult.runId, actions };
}

/**
 * Auto-fail tasks that have been in_progress longer than DISPATCH_TIMEOUT_MINUTES.
 * Checks if task should be quarantined after failure.
 *
 * @param {Object[]} inProgressTasks - Tasks currently in_progress (must include payload, started_at)
 * @returns {Object[]} - Actions taken
 */
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
        // Not quarantined, mark as failed normally
        await updateTask({ task_id: task.id, status: 'failed' });
        actions.push({
          action: 'auto-fail-timeout',
          task_id: task.id,
          title: task.title,
          elapsed_minutes: Math.round(elapsed),
          failure_count: quarantineResult.failure_count
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
        `Auto-failed timed-out task: ${task.title} (${Math.round(elapsed)}min)`,
        { action: 'auto-fail-timeout', task_id: task.id, quarantined: quarantineResult.quarantined },
        { success: true, elapsed_minutes: Math.round(elapsed) }
      );
    }
  }
  return actions;
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

  // 0. Evaluate alertness level (enhanced version)
  let alertnessResult = null;
  try {
    // Use enhanced alertness system
    alertnessResult = await evaluateAlertnessEnhanced();
    if (alertnessResult.level >= ALERTNESS_LEVELS.ALERT) {
      console.log(`[tick] Alertness: ${LEVEL_NAMES[alertnessResult.level]} (score=${alertnessResult.score || 'N/A'})`);
      actionsTaken.push({
        action: 'alertness_check',
        level: alertnessResult.level,
        level_name: LEVEL_NAMES[alertnessResult.level],
        score: alertnessResult.score
      });
    }

    // In COMA mode, skip everything except basic health checks
    if (alertnessResult.level === ALERTNESS_LEVELS.COMA) {
      console.log('[tick] COMA mode: skipping all operations, only heartbeat');
      return {
        success: true,
        alertness: alertnessResult,
        actions_taken: actionsTaken,
        reason: 'COMA mode - only heartbeat',
        next_tick: new Date(now.getTime() + TICK_INTERVAL_MINUTES * 60 * 1000).toISOString()
      };
    }
  } catch (alertErr) {
    console.error('[tick] Alertness evaluation failed:', alertErr.message);
    // Record the failure in metrics
    recordOperation(false, 'alertness_evaluation');
  }

  // 0. Thalamus: Analyze tick event (quick route for simple ticks)
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
        await logTickDecision(
          'tick',
          `Decision pending approval: confidence ${decision.confidence} < ${AUTO_EXECUTE_CONFIDENCE}`,
          { action: 'decision_pending', decision_id: decision.decision_id },
          { success: true, requires_approval: true }
        );
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

  // 2.6 Anti-crossing cleanup: clear orphaned task references
  try {
    const orphansCleaned = await cleanupOrphanedTaskRefs();
    if (orphansCleaned > 0) {
      console.log(`[tick-loop] Cleaned up ${orphansCleaned} orphaned task references`);
    }
  } catch (err) {
    console.error('[tick-loop] Anti-crossing cleanup error:', err.message);
  }

  // 3. Get daily focus
  const focusResult = await getDailyFocus();

  if (!focusResult) {
    await logTickDecision(
      'tick',
      'No daily focus set',
      { action: 'skip', reason: 'no_focus' },
      { success: true, skipped: true }
    );
    return {
      success: true,
      decision_engine: decisionEngineResult,
      actions_taken: actionsTaken,
      reason: 'No active Objective to focus on',
      next_tick: new Date(now.getTime() + TICK_INTERVAL_MINUTES * 60 * 1000).toISOString()
    };
  }

  const { focus } = focusResult;
  const objectiveId = focus.objective.id;

  // 4. Get tasks related to focus objective (include payload for timeout check)
  const krIds = focus.key_results.map(kr => kr.id);
  const allGoalIds = [objectiveId, ...krIds];

  const tasksResult = await pool.query(`
    SELECT id, title, status, priority, started_at, updated_at, payload
    FROM tasks
    WHERE goal_id = ANY($1)
      AND status NOT IN ('completed', 'cancelled')
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
          const requeueResult = await requeueTask(action.taskId, action.reason, action.evidence);
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

  // P1 FIX #3: Check for expired quarantine tasks and auto-release
  try {
    const released = await checkExpiredQuarantineTasks();
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

  // 6. Planning: if no queued AND no in_progress tasks, invoke planner
  //    Skip if focused objective has no KRs — nothing to plan for
  //    Skip if alertness level disables planning
  if (queued.length === 0 && inProgress.length === 0 && krIds.length > 0 && canPlan()) {
    try {
      const planned = await planNextTask(krIds);
      if (planned.planned) {
        actionsTaken.push({
          action: 'plan',
          task_id: planned.task.id,
          title: planned.task.title
        });
      } else if (planned.reason === 'needs_planning' && planned.kr) {
        // 6c. Auto KR decomposition: create a task for 秋米 to decompose this KR into Feature + Tasks
        try {
          const krId = planned.kr.id;
          const krTitle = planned.kr.title;
          const projectId = planned.project?.id || null;

          // Dedup: skip if a decomposition task already exists for this KR
          const existingDecomp = await pool.query(`
            SELECT id FROM tasks
            WHERE goal_id = $1
              AND (payload->>'decomposition' IN ('true', 'continue') OR title LIKE '%拆解%')
              AND (status IN ('queued', 'in_progress') OR (status = 'completed' AND completed_at > NOW() - INTERVAL '24 hours'))
          `, [krId]);

          if (existingDecomp.rows.length === 0) {
            const decompResult = await pool.query(`
              INSERT INTO tasks (title, description, status, priority, goal_id, project_id, task_type, payload, trigger_source)
              VALUES ($1, $2, 'queued', 'P0', $3, $4, 'dev', $5, 'brain_auto')
              RETURNING id, title
            `, [
              `KR 拆解: ${krTitle}`,
              `请为 KR「${krTitle}」创建具体执行任务。\n\n要求：\n1. 分析 KR，确定需要哪些 Feature 和 Task\n2. 为每个 Task 写完整 PRD\n3. 调用 Brain API 创建 Task:\n   POST http://localhost:5221/api/brain/action/create-task\n   Body: { "title": "...", "project_id": "${projectId}", "goal_id": "${krId}", "task_type": "dev", "prd_content": "..." }\n\nKR ID: ${krId}\nKR 标题: ${krTitle}`,
              krId,
              projectId,
              JSON.stringify({ decomposition: 'continue', kr_id: krId })
            ]);

            console.log(`[tick-loop] Created KR decomposition task for: ${krTitle}`);
            actionsTaken.push({
              action: 'create_kr_decomposition',
              task_id: decompResult.rows[0].id,
              title: decompResult.rows[0].title,
              kr: planned.kr,
              project: planned.project
            });
          } else {
            actionsTaken.push({
              action: 'needs_planning',
              kr: planned.kr,
              project: planned.project,
              note: 'decomposition_task_exists'
            });
          }
        } catch (krDecompErr) {
          console.error('[tick-loop] KR decomposition error:', krDecompErr.message);
          actionsTaken.push({
            action: 'needs_planning',
            kr: planned.kr,
            project: planned.project
          });
        }
      }
    } catch (planErr) {
      console.error('[tick-loop] Planner error:', planErr.message);
    }
  } else if (!canPlan() && queued.length === 0 && inProgress.length === 0) {
    console.log(`[tick] Planning disabled at alertness level ${LEVEL_NAMES[alertnessResult?.level || 0]}`);
  }

  // 6b. Auto OKR decomposition: ONLY for TRUE top-level objectives (parent_id IS NULL)
  // Do NOT decompose nested goals that were incorrectly typed as 'objective'
  try {
    const noKrObjectives = await pool.query(`
      SELECT o.id, o.title FROM goals o
      WHERE o.type = 'objective'
        AND o.parent_id IS NULL  -- CRITICAL: Only top-level objectives
        AND o.status NOT IN ('completed', 'cancelled', 'decomposing')
        AND NOT EXISTS (
          SELECT 1 FROM goals kr WHERE kr.parent_id = o.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM tasks t
          WHERE t.goal_id = o.id
            AND (t.payload->>'decomposition' = 'true' OR t.title LIKE '%OKR%拆解%')
            AND (t.status IN ('queued', 'in_progress') OR (t.status = 'completed' AND t.completed_at > NOW() - INTERVAL '24 hours'))
        )
    `);

    for (const obj of noKrObjectives.rows) {
      const decompResult = await pool.query(`
        INSERT INTO tasks (title, description, status, priority, goal_id, task_type, payload, trigger_source)
        VALUES ($1, $2, 'queued', 'P0', $3, 'dev', $4, 'brain_auto')
        RETURNING id, title
      `, [
        `OKR 拆解: ${obj.title}`,
        `请为目标「${obj.title}」拆解 Key Results (KR)。\n\n要求：\n1. 分析目标，拆解为 3-5 个可量化的 KR\n2. 每个 KR 需要有明确的衡量标准和目标值\n3. 调用 Brain API 创建 KR:\n   POST http://localhost:5221/api/brain/action/create-goal\n   Body: { "title": "KR: ...", "description": "...", "priority": "P0", "parent_id": "${obj.id}" }\n4. 为每个 KR 关联合适的 Project\n\n目标 ID: ${obj.id}\n目标标题: ${obj.title}`,
        obj.id,
        JSON.stringify({ decomposition: 'true', objective_id: obj.id })
      ]);

      console.log(`[tick-loop] Created OKR decomposition task for objective: ${obj.title}`);
      actionsTaken.push({
        action: 'create_decomposition',
        task_id: decompResult.rows[0].id,
        title: decompResult.rows[0].title,
        objective: obj.title
      });
    }
  } catch (decompErr) {
    console.error('[tick-loop] OKR decomposition error:', decompErr.message);
  }

  // 7. Dispatch tasks — fill all available slots (scoped to focused objective first, then global)
  //    Respect alertness level dispatch settings
  let dispatched = 0;
  let lastDispatchResult = null;

  // Check if dispatch is allowed (using enhanced alertness)
  if (!canDispatchEnhanced()) {
    console.log(`[tick] Dispatch disabled at alertness level ${alertnessResult?.levelName || 'UNKNOWN'}`);
    return {
      success: true,
      alertness: alertnessResult,
      decision_engine: decisionEngineResult,
      focus: { objective_id: objectiveId, objective_title: focus.objective.title },
      dispatch: { dispatched: 0, reason: 'alertness_disabled' },
      actions_taken: actionsTaken,
      summary: { in_progress: inProgress.length, queued: queued.length, stale: staleTasks.length },
      next_tick: new Date(now.getTime() + TICK_INTERVAL_MINUTES * 60 * 1000).toISOString()
    };
  }

  // Apply dispatch rate limit based on alertness level
  const dispatchRate = getDispatchRateEnhanced();
  const effectiveDispatchMax = Math.max(1, Math.floor(AUTO_DISPATCH_MAX * dispatchRate));
  if (dispatchRate < 1.0) {
    console.log(`[tick] Dispatch rate limited to ${Math.round(dispatchRate * 100)}% (max ${effectiveDispatchMax} tasks)`);
  }

  // 7a. Fill slots from focused objective's tasks
  for (let i = 0; i < effectiveDispatchMax; i++) {
    const dispatchResult = await dispatchNextTask(allGoalIds);
    actionsTaken.push(...dispatchResult.actions);
    lastDispatchResult = dispatchResult;

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
  }

  // 7b. If focus objective has no more tasks, fill remaining slots from ALL objectives
  if (dispatched < effectiveDispatchMax && (!lastDispatchResult?.dispatched || lastDispatchResult?.reason === 'no_dispatchable_task')) {
    try {
      const allObjectiveIds = await pool.query(`
        SELECT id FROM goals WHERE type = 'objective' AND status NOT IN ('completed', 'cancelled')
      `);
      const globalGoalIds = allObjectiveIds.rows.map(r => r.id);
      if (globalGoalIds.length > 0) {
        for (let i = dispatched; i < effectiveDispatchMax; i++) {
          const globalDispatch = await dispatchNextTask(globalGoalIds);
          actionsTaken.push(...globalDispatch.actions);
          if (!globalDispatch.dispatched) break;
          dispatched++;
        }
      }
    } catch (globalErr) {
      console.error('[tick-loop] Global dispatch error:', globalErr.message);
    }
  }

  if (dispatched > 0) {
    console.log(`[tick-loop] Dispatched ${dispatched} tasks this tick`);
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

  return {
    success: true,
    alertness: alertnessResult,
    decision_engine: decisionEngineResult,
    focus: {
      objective_id: objectiveId,
      objective_title: focus.objective.title
    },
    dispatch: { dispatched: dispatched, last: lastDispatchResult },
    actions_taken: actionsTaken,
    summary: {
      in_progress: inProgress.length,
      queued: queued.length,
      stale: staleTasks.length
    },
    tick_duration_ms: tickDuration,
    next_tick: new Date(now.getTime() + TICK_INTERVAL_MINUTES * 60 * 1000).toISOString()
  };
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

  // Auto-complete drain: if no in_progress tasks remain, disable tick
  if (tasks.length === 0) {
    console.log('[tick] Drain complete — no in_progress tasks remain, disabling tick');
    const drainEnd = new Date().toISOString();
    const startedAt = _drainStartedAt;
    _draining = false;
    _drainStartedAt = null;
    await disableTick();
    return {
      draining: false,
      drain_completed: true,
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
  return { draining: _draining, drainStartedAt: _drainStartedAt };
}
function _resetDrainState() {
  _draining = false;
  _drainStartedAt = null;
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
  TASK_TYPE_AGENT_MAP,
  TICK_INTERVAL_MINUTES,
  TICK_LOOP_INTERVAL_MS,
  TICK_TIMEOUT_MS,
  DISPATCH_TIMEOUT_MINUTES,
  MAX_CONCURRENT_TASKS,
  AUTO_DISPATCH_MAX
};
