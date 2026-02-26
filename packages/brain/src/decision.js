/**
 * Decision Engine - Stage 3
 *
 * Compares goal progress, detects deviations, and generates decisions
 * to automatically adjust task execution strategy.
 */

import pool from './db.js';

// Configuration
const STALE_THRESHOLD_HOURS = 24;
const HIGH_CONFIDENCE_THRESHOLD = 0.8;
const MAX_AUTO_RETRY_COUNT = 3;

// Actions that are safe to auto-execute regardless of confidence
export const SAFE_ACTIONS = new Set(['retry', 'reprioritize', 'skip']);

/**
 * Extract safe actions from a decision that can be auto-executed
 * even when overall confidence is below threshold
 * @param {Array} actions - All decision actions
 * @returns {{ safeActions: Array, unsafeActions: Array }}
 */
export function splitActionsBySafety(actions) {
  const safeActions = [];
  const unsafeActions = [];
  for (const action of actions) {
    if (SAFE_ACTIONS.has(action.type)) {
      safeActions.push(action);
    } else {
      unsafeActions.push(action);
    }
  }
  return { safeActions, unsafeActions };
}

/**
 * Calculate expected progress based on time elapsed
 * @param {Date} createdAt - When the goal was created
 * @param {Date} deadline - Optional deadline
 * @returns {number} Expected progress percentage
 */
function calculateExpectedProgress(createdAt, deadline) {
  const now = new Date();
  const start = new Date(createdAt);

  if (deadline) {
    const end = new Date(deadline);
    const totalTime = end - start;
    const elapsed = now - start;
    return Math.min(100, Math.round((elapsed / totalTime) * 100));
  }

  // Default: assume 30-day goal
  const defaultDays = 30;
  const elapsed = (now - start) / (1000 * 60 * 60 * 24);
  return Math.min(100, Math.round((elapsed / defaultDays) * 100));
}

/**
 * Get blocked tasks (in_progress for too long)
 * @param {Array} tasks - Tasks to check
 * @returns {Array} Blocked task IDs
 */
function getBlockedTasks(tasks) {
  const now = new Date();
  const blocked = [];

  for (const task of tasks) {
    if (task.status === 'in_progress' && task.started_at) {
      const hours = (now - new Date(task.started_at)) / (1000 * 60 * 60);
      if (hours > STALE_THRESHOLD_HOURS) {
        blocked.push(task.id);
      }
    }
  }

  return blocked;
}

/**
 * Generate recommendations based on goal status
 * @param {Object} goal - Goal with progress info
 * @param {Array} blockedTasks - Blocked task IDs
 * @returns {Array} Recommendations
 */
function generateRecommendations(goal, blockedTasks) {
  const recommendations = [];

  if (goal.deviation < -20) {
    recommendations.push(`Goal "${goal.title}" is significantly behind schedule`);
    recommendations.push('Consider reprioritizing tasks or adding resources');
  } else if (goal.deviation < -10) {
    recommendations.push(`Goal "${goal.title}" is falling behind`);
  }

  if (blockedTasks.length > 0) {
    recommendations.push(`${blockedTasks.length} task(s) appear to be blocked`);
    recommendations.push('Review blocked tasks for dependencies or issues');
  }

  return recommendations;
}

/**
 * Compare goal progress against expected progress
 * @param {string|null} goalId - Optional specific goal ID
 * @returns {Object} Comparison report
 */
export async function compareGoalProgress(goalId = null) {
  // Get goals
  let goalsQuery = `
    SELECT g.id, g.title, g.status, g.progress, g.created_at,
           COUNT(t.id) as total_tasks,
           COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as completed_tasks,
           COUNT(CASE WHEN t.status = 'in_progress' THEN 1 END) as in_progress_tasks
    FROM goals g
    LEFT JOIN tasks t ON t.goal_id = g.id
    WHERE g.status != 'completed'
  `;
  const params = [];

  if (goalId) {
    goalsQuery += ' AND g.id = $1';
    params.push(goalId);
  }

  goalsQuery += ' GROUP BY g.id ORDER BY g.priority, g.created_at';

  const goalsResult = await pool.query(goalsQuery, params);
  const goals = [];
  let overallHealth = 'healthy';
  const nextActions = [];

  for (const row of goalsResult.rows) {
    // Get tasks for this goal to check for blocked ones
    const tasksResult = await pool.query(`
      SELECT id, status, started_at
      FROM tasks
      WHERE goal_id = $1 AND status = 'in_progress'
    `, [row.id]);

    const blockedTasks = getBlockedTasks(tasksResult.rows);

    // Calculate progress
    const totalTasks = parseInt(row.total_tasks) || 0;
    const completedTasks = parseInt(row.completed_tasks) || 0;
    const actualProgress = totalTasks > 0
      ? Math.round((completedTasks / totalTasks) * 100)
      : (row.progress || 0);

    const expectedProgress = calculateExpectedProgress(row.created_at, null);
    const deviation = actualProgress - expectedProgress;

    // Determine status
    let status = 'on_track';
    if (deviation < -20) {
      status = 'behind';
      overallHealth = 'critical';
    } else if (deviation < -10) {
      status = 'at_risk';
      if (overallHealth === 'healthy') overallHealth = 'warning';
    } else if (deviation > 10) {
      status = 'ahead';
    }

    const recommendations = generateRecommendations(
      { title: row.title, deviation },
      blockedTasks
    );

    goals.push({
      id: row.id,
      title: row.title,
      expected_progress: expectedProgress,
      actual_progress: actualProgress,
      deviation,
      status,
      blocked_tasks: blockedTasks,
      recommendations,
      task_stats: {
        total: totalTasks,
        completed: completedTasks,
        in_progress: parseInt(row.in_progress_tasks) || 0
      }
    });

    // Generate next actions
    if (blockedTasks.length > 0) {
      nextActions.push({
        type: 'review_blocked',
        goal_id: row.id,
        task_ids: blockedTasks
      });
    }
    if (status === 'behind') {
      nextActions.push({
        type: 'escalate',
        goal_id: row.id,
        reason: 'Goal significantly behind schedule'
      });
    }
  }

  return {
    goals,
    overall_health: overallHealth,
    next_actions: nextActions,
    timestamp: new Date().toISOString()
  };
}

/**
 * Generate decision based on current state
 * @param {Object} context - Decision context
 * @returns {Object} Decision with actions
 */
export async function generateDecision(context = {}) {
  const trigger = context.trigger || 'manual';

  // Get comparison report
  const comparison = await compareGoalProgress();

  const actions = [];
  let confidence = 0.9;

  // Analyze goals and generate actions
  for (const goal of comparison.goals) {
    // Handle blocked tasks
    for (const taskId of goal.blocked_tasks) {
      actions.push({
        type: 'escalate',
        target_id: taskId,
        target_type: 'task',
        reason: `Task blocked for more than ${STALE_THRESHOLD_HOURS} hours`
      });
      confidence = Math.min(confidence, 0.85);
    }

    // Handle at_risk and behind goals (deviation < -10%)
    if (goal.status === 'behind' || goal.status === 'at_risk') {
      // Find pending high-priority tasks to reprioritize
      const pendingTasksResult = await pool.query(`
        SELECT id, title, priority
        FROM tasks
        WHERE goal_id = $1 AND status = 'pending'
        ORDER BY priority, created_at
        LIMIT 3
      `, [goal.id]);

      for (const task of pendingTasksResult.rows) {
        if (task.priority !== 'P0') {
          actions.push({
            type: 'reprioritize',
            target_id: task.id,
            target_type: 'task',
            new_priority: goal.status === 'behind' ? 'P0' : 'P1',
            reason: `Goal "${goal.title}" is ${goal.status === 'behind' ? 'significantly behind' : 'at risk'}`
          });
        }
      }
    }
  }

  // Add retry actions for failed tasks (only those not yet exhausted)
  const failedTasksResult = await pool.query(`
    SELECT id, title, goal_id
    FROM tasks
    WHERE status = 'failed'
      AND (retry_count IS NULL OR retry_count < $1)
    ORDER BY created_at DESC
    LIMIT 5
  `, [MAX_AUTO_RETRY_COUNT]);

  for (const task of failedTasksResult.rows) {
    actions.push({
      type: 'retry',
      target_id: task.id,
      target_type: 'task',
      reason: 'Task failed, retry recommended'
    });
    // retry is a safe action — no confidence penalty
    // (max_retries + thalamus quarantine provide protection)
  }

  // Determine if approval is required
  const requiresApproval = confidence < HIGH_CONFIDENCE_THRESHOLD ||
    actions.some(a => a.type === 'escalate');

  // Store decision
  const decisionResult = await pool.query(`
    INSERT INTO decisions (trigger, context, actions, confidence, status)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id
  `, [
    trigger,
    JSON.stringify({ comparison_summary: comparison.overall_health, goal_count: comparison.goals.length }),
    JSON.stringify(actions),
    confidence,
    requiresApproval ? 'pending' : 'approved'
  ]);

  return {
    decision_id: decisionResult.rows[0].id,
    actions,
    confidence,
    requires_approval: requiresApproval,
    context: {
      trigger,
      overall_health: comparison.overall_health,
      goals_analyzed: comparison.goals.length
    }
  };
}

/**
 * Execute a pending decision
 * @param {string} decisionId - Decision ID to execute
 * @returns {Object} Execution result
 */
export async function executeDecision(decisionId) {
  // Get decision
  const decisionResult = await pool.query(
    'SELECT * FROM decisions WHERE id = $1',
    [decisionId]
  );

  if (decisionResult.rows.length === 0) {
    throw new Error('Decision not found');
  }

  const decision = decisionResult.rows[0];

  if (decision.status === 'executed') {
    throw new Error('Decision already executed');
  }

  if (decision.status === 'rolled_back') {
    throw new Error('Decision was rolled back');
  }

  const actions = decision.actions || [];
  const results = [];

  for (const action of actions) {
    try {
      let result;

      switch (action.type) {
        case 'reprioritize':
          await pool.query(
            'UPDATE tasks SET priority = $1 WHERE id = $2',
            [action.new_priority || 'P1', action.target_id]
          );
          result = { success: true, action: 'reprioritized' };
          break;

        case 'escalate':
          // Mark task as needing attention
          await pool.query(`
            UPDATE tasks
            SET payload = COALESCE(payload, '{}'::jsonb) || '{"needs_attention": true}'::jsonb
            WHERE id = $1
          `, [action.target_id]);
          result = { success: true, action: 'escalated' };
          break;

        case 'retry':
          // Reset task to queued for retry
          await pool.query(
            'UPDATE tasks SET status = $1 WHERE id = $2',
            ['queued', action.target_id]
          );
          result = { success: true, action: 'reset_to_queued' };
          break;

        case 'skip':
          await pool.query(
            'UPDATE tasks SET status = $1 WHERE id = $2',
            ['cancelled', action.target_id]
          );
          result = { success: true, action: 'cancelled' };
          break;

        default:
          result = { success: false, error: `Unknown action type: ${action.type}` };
      }

      results.push({ ...action, result });
    } catch (error) {
      results.push({ ...action, result: { success: false, error: error.message } });
    }
  }

  // Update decision status
  await pool.query(`
    UPDATE decisions
    SET status = 'executed', executed_at = NOW(), updated_at = NOW()
    WHERE id = $1
  `, [decisionId]);

  return {
    decision_id: decisionId,
    status: 'executed',
    executed_at: new Date().toISOString(),
    results
  };
}

/**
 * Get decision history
 * @param {number} limit - Max number of decisions to return
 * @returns {Array} Decision history
 */
export async function getDecisionHistory(limit = 20) {
  const result = await pool.query(`
    SELECT id, trigger, context, actions, confidence, status, executed_at, created_at
    FROM decisions
    ORDER BY created_at DESC
    LIMIT $1
  `, [limit]);

  return result.rows.map(row => ({
    id: row.id,
    trigger: row.trigger,
    context: row.context,
    actions: row.actions,
    confidence: parseFloat(row.confidence) || 0,
    status: row.status,
    executed_at: row.executed_at,
    created_at: row.created_at,
    action_count: (row.actions || []).length
  }));
}

/**
 * Rollback a decision
 * @param {string} decisionId - Decision ID to rollback
 * @returns {Object} Rollback result
 */
export async function rollbackDecision(decisionId) {
  const decisionResult = await pool.query(
    'SELECT * FROM decisions WHERE id = $1',
    [decisionId]
  );

  if (decisionResult.rows.length === 0) {
    throw new Error('Decision not found');
  }

  const decision = decisionResult.rows[0];

  if (decision.status !== 'executed') {
    throw new Error('Can only rollback executed decisions');
  }

  // Mark as rolled back (actual rollback logic would need to track original values)
  await pool.query(`
    UPDATE decisions
    SET status = 'rolled_back', updated_at = NOW()
    WHERE id = $1
  `, [decisionId]);

  return {
    decision_id: decisionId,
    status: 'rolled_back',
    message: 'Decision marked as rolled back. Manual intervention may be needed to restore original state.'
  };
}
