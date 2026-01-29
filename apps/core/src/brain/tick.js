/**
 * Action Loop - Tick Mechanism
 * Implements automatic task progression through periodic ticks
 */

/* global console */
import pool from '../task-system/db.js';
import { getDailyFocus } from './focus.js';
import { updateTask } from './actions.js';

// Tick configuration
const TICK_INTERVAL_MINUTES = 30;
const STALE_THRESHOLD_HOURS = 24; // Tasks in_progress for more than 24h are stale

// Working memory keys
const TICK_ENABLED_KEY = 'tick_enabled';
const TICK_LAST_KEY = 'tick_last';
const TICK_ACTIONS_TODAY_KEY = 'tick_actions_today';

/**
 * Get tick status
 */
async function getTickStatus() {
  const result = await pool.query(`
    SELECT key, value_json FROM working_memory
    WHERE key IN ($1, $2, $3)
  `, [TICK_ENABLED_KEY, TICK_LAST_KEY, TICK_ACTIONS_TODAY_KEY]);

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

  return {
    enabled,
    interval_minutes: TICK_INTERVAL_MINUTES,
    last_tick: lastTick,
    next_tick: nextTick,
    actions_today: actionsToday
  };
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

  return { success: true, enabled: true };
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

  return { success: true, enabled: false };
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
 * Execute a tick - the core decision loop
 *
 * 1. Get daily focus OKR
 * 2. Check related task status
 * 3. Decide next action
 * 4. Execute action
 * 5. Log decision
 */
async function executeTick() {
  const actionsTaken = [];
  const now = new Date();

  // 1. Get daily focus
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
      actions_taken: [],
      reason: 'No active Objective to focus on',
      next_tick: new Date(now.getTime() + TICK_INTERVAL_MINUTES * 60 * 1000).toISOString()
    };
  }

  const { focus } = focusResult;
  const objectiveId = focus.objective.id;

  // 2. Get tasks related to focus objective
  // Include tasks linked to objective directly or through Key Results
  const krIds = focus.key_results.map(kr => kr.id);
  const allGoalIds = [objectiveId, ...krIds];

  const tasksResult = await pool.query(`
    SELECT id, title, status, priority, started_at, updated_at
    FROM tasks
    WHERE goal_id = ANY($1)
      AND status NOT IN ('completed', 'cancelled')
    ORDER BY
      CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
      created_at ASC
  `, [allGoalIds]);

  const tasks = tasksResult.rows;

  // 3. Decision logic
  const inProgress = tasks.filter(t => t.status === 'in_progress');
  const queued = tasks.filter(t => t.status === 'queued');

  // Check for stale tasks
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

  // 4. Execute action: Start next task if nothing in progress
  if (inProgress.length === 0 && queued.length > 0) {
    const nextTask = queued[0];

    const updateResult = await updateTask({
      task_id: nextTask.id,
      status: 'in_progress'
    });

    if (updateResult.success) {
      await logTickDecision(
        'tick',
        `Started task: ${nextTask.title}`,
        { action: 'update-task', task_id: nextTask.id, status: 'in_progress' },
        updateResult
      );
      actionsTaken.push({
        action: 'update-task',
        task_id: nextTask.id,
        title: nextTask.title,
        status: 'in_progress'
      });
    }
  } else if (inProgress.length > 0) {
    // Log that we're waiting for in-progress tasks
    await logTickDecision(
      'tick',
      `Waiting for ${inProgress.length} in-progress task(s)`,
      { action: 'wait', in_progress_count: inProgress.length },
      { success: true }
    );
  } else if (queued.length === 0) {
    // No tasks to work on
    await logTickDecision(
      'tick',
      'No queued tasks for focus objective',
      { action: 'skip', reason: 'no_queued_tasks' },
      { success: true }
    );
  }

  // 5. Update tick state
  await pool.query(`
    INSERT INTO working_memory (key, value_json, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
  `, [TICK_LAST_KEY, { timestamp: now.toISOString() }]);

  // Update actions count
  if (actionsTaken.length > 0) {
    await incrementActionsToday(actionsTaken.length);
  }

  return {
    success: true,
    focus: {
      objective_id: objectiveId,
      objective_title: focus.objective.title
    },
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
  TICK_INTERVAL_MINUTES
};
