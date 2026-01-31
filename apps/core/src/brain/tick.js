/**
 * Action Loop - Tick Mechanism
 * Implements automatic task progression through periodic ticks
 */

import pool from '../task-system/db.js';
import { getDailyFocus } from './focus.js';
import { updateTask } from './actions.js';
import { triggerCeceliaRun, checkCeceliaRunAvailable } from './executor.js';
import { compareGoalProgress, generateDecision, executeDecision } from './decision.js';
import { planNextTask } from './planner.js';
import { emit } from './event-bus.js';
import { isAllowed, recordSuccess, recordFailure, getAllStates } from './circuit-breaker.js';

// Tick configuration
const TICK_INTERVAL_MINUTES = 5;
const TICK_LOOP_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes between loop ticks
const TICK_TIMEOUT_MS = 60 * 1000; // 60 seconds max execution time
const STALE_THRESHOLD_HOURS = 24; // Tasks in_progress for more than 24h are stale
const DISPATCH_TIMEOUT_MINUTES = 30; // Auto-fail dispatched tasks after 30 min
const DISPATCH_COOLDOWN_MS = 60 * 1000; // 1 minute cooldown after dispatch
const MAX_CONCURRENT_TASKS = parseInt(process.env.CECELIA_MAX_CONCURRENT || '3', 10); // Max concurrent cecelia-run executions
const AUTO_EXECUTE_CONFIDENCE = 0.8; // Auto-execute decisions with confidence >= this

// Working memory keys
const TICK_ENABLED_KEY = 'tick_enabled';
const TICK_LAST_KEY = 'tick_last';
const TICK_ACTIONS_TODAY_KEY = 'tick_actions_today';
const TICK_LAST_DISPATCH_KEY = 'tick_last_dispatch';

// Loop state (in-memory)
let _loopTimer = null;
let _tickRunning = false;
let _tickLockTime = null;
let _lastDispatchTime = 0; // in-memory cooldown tracker

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

  return {
    enabled,
    loop_running: _loopTimer !== null,
    interval_minutes: TICK_INTERVAL_MINUTES,
    loop_interval_ms: TICK_LOOP_INTERVAL_MS,
    last_tick: lastTick,
    next_tick: nextTick,
    actions_today: actionsToday,
    tick_running: _tickRunning,
    last_dispatch: lastDispatch,
    max_concurrent: MAX_CONCURRENT_TASKS,
    dispatch_timeout_minutes: DISPATCH_TIMEOUT_MINUTES,
    circuit_breakers: getAllStates()
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
    // Ensure EventBus table exists
    const { ensureEventsTable } = await import('./event-bus.js');
    await ensureEventsTable();

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
  // Query queued tasks with payload for dependency checking
  const result = await pool.query(`
    SELECT t.id, t.title, t.status, t.priority, t.started_at, t.updated_at, t.payload
    FROM tasks t
    WHERE t.goal_id = ANY($1)
      AND t.status = 'queued'
    ORDER BY
      CASE t.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
      t.created_at ASC
  `, [goalIds]);

  for (const task of result.rows) {
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
 * Dispatch the next queued task for execution.
 * Checks concurrency limit, cooldown, executor availability, and dependencies.
 *
 * @param {string[]} goalIds - Goal IDs to scope the dispatch
 * @returns {Object} - Dispatch result with actions taken
 */
async function dispatchNextTask(goalIds) {
  const actions = [];

  // 1. Check concurrency
  const activeResult = await pool.query(
    "SELECT COUNT(*) FROM tasks WHERE goal_id = ANY($1) AND status = 'in_progress'",
    [goalIds]
  );
  const activeCount = parseInt(activeResult.rows[0].count);
  if (activeCount >= MAX_CONCURRENT_TASKS) {
    return { dispatched: false, reason: 'max_concurrent_reached', active: activeCount, actions };
  }

  // 2. Circuit breaker check
  if (!isAllowed('cecelia-run')) {
    return { dispatched: false, reason: 'circuit_breaker_open', actions };
  }

  // 3. Check cooldown
  if ((Date.now() - _lastDispatchTime) <= DISPATCH_COOLDOWN_MS) {
    return { dispatched: false, reason: 'cooldown_active', actions };
  }

  // 3. Select next task (with dependency check)
  const nextTask = await selectNextDispatchableTask(goalIds);
  if (!nextTask) {
    return { dispatched: false, reason: 'no_dispatchable_task', actions };
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
      await updateTask({ task_id: task.id, status: 'failed' });
      await recordFailure('cecelia-run');
      await emit('patrol_cleanup', 'patrol', {
        task_id: task.id,
        title: task.title,
        elapsed_minutes: Math.round(elapsed)
      });
      await logTickDecision(
        'tick',
        `Auto-failed timed-out task: ${task.title} (${Math.round(elapsed)}min)`,
        { action: 'auto-fail-timeout', task_id: task.id },
        { success: true, elapsed_minutes: Math.round(elapsed) }
      );
      actions.push({
        action: 'auto-fail-timeout',
        task_id: task.id,
        title: task.title,
        elapsed_minutes: Math.round(elapsed)
      });
    }
  }
  return actions;
}

/**
 * Execute a tick - the core self-driving loop
 *
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
  let decisionEngineResult = null;

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

  // 6. Planning: if no queued tasks, invoke planner
  if (queued.length === 0) {
    try {
      const planned = await planNextTask();
      if (planned.planned) {
        actionsTaken.push({
          action: 'plan',
          task_id: planned.task.id,
          title: planned.task.title
        });
      } else if (planned.reason === 'needs_planning') {
        actionsTaken.push({
          action: 'needs_planning',
          kr: planned.kr,
          project: planned.project
        });
      }
    } catch (planErr) {
      console.error('[tick-loop] Planner error:', planErr.message);
    }
  }

  // 7. Dispatch next task
  const dispatchResult = await dispatchNextTask(allGoalIds);
  actionsTaken.push(...dispatchResult.actions);

  if (!dispatchResult.dispatched && dispatchResult.reason !== 'no_dispatchable_task') {
    await logTickDecision(
      'tick',
      `Dispatch skipped: ${dispatchResult.reason}`,
      { action: 'dispatch_skip', reason: dispatchResult.reason },
      { success: true }
    );
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

  return {
    success: true,
    decision_engine: decisionEngineResult,
    focus: {
      objective_id: objectiveId,
      objective_title: focus.objective.title
    },
    dispatch: dispatchResult,
    actions_taken: actionsTaken,
    summary: {
      in_progress: inProgress.length,
      queued: queued.length,
      stale: staleTasks.length
    },
    next_tick: new Date(now.getTime() + TICK_INTERVAL_MINUTES * 60 * 1000).toISOString()
  };
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
  selectNextDispatchableTask,
  autoFailTimedOutTasks,
  TICK_INTERVAL_MINUTES,
  TICK_LOOP_INTERVAL_MS,
  TICK_TIMEOUT_MS,
  DISPATCH_TIMEOUT_MINUTES,
  DISPATCH_COOLDOWN_MS,
  MAX_CONCURRENT_TASKS
};
