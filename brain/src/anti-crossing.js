/**
 * Anti-Crossing - Feature Task Collision Prevention
 *
 * Implements:
 * 1. feature_id binding - Tasks must bind to their Feature
 * 2. active_task_id state lock - Only one active Task per Feature
 * 3. Task completion validation - Verify feature_id consistency
 */

import pool from './db.js';

/**
 * Check if a feature allows creating a new task (anti-crossing check)
 * @param {string} featureId - Feature UUID
 * @returns {Promise<{allowed: boolean, reason?: string}>}
 */
async function checkAntiCrossing(featureId) {
  if (!featureId) {
    // No feature_id means it's a single task, always allowed
    return { allowed: true };
  }

  // Get feature with its active_task_id
  const result = await pool.query(
    'SELECT id, title, status, active_task_id FROM features WHERE id = $1',
    [featureId]
  );

  if (result.rows.length === 0) {
    return { allowed: false, reason: 'feature_not_found' };
  }

  const feature = result.rows[0];

  // Check if feature has an active task
  if (feature.active_task_id) {
    // Verify the active task is actually still active (not completed/failed)
    const taskResult = await pool.query(
      'SELECT id, status FROM tasks WHERE id = $1',
      [feature.active_task_id]
    );

    if (taskResult.rows.length > 0) {
      const task = taskResult.rows[0];
      if (!['completed', 'failed', 'cancelled'].includes(task.status)) {
        return {
          allowed: false,
          reason: 'feature_has_active_task',
          active_task_id: feature.active_task_id,
          task_status: task.status
        };
      }
      // Task is done but active_task_id wasn't cleared - allow and let caller clean up
    }
    // active_task_id points to non-existent task - allow and let caller clean up
  }

  // Check feature status - only allow task creation in certain states
  const allowedStatuses = ['planning', 'task_completed', 'evaluating'];
  if (!allowedStatuses.includes(feature.status)) {
    return {
      allowed: false,
      reason: 'feature_status_not_ready',
      feature_status: feature.status
    };
  }

  return { allowed: true };
}

/**
 * Validate task completion for a feature task
 * Ensures the task belongs to the feature's active_task_id
 * @param {string} taskId - Task UUID
 * @returns {Promise<{valid: boolean, reason?: string, task?: Object, feature?: Object}>}
 */
async function validateTaskCompletion(taskId) {
  // Get task with feature_id
  const taskResult = await pool.query(
    'SELECT * FROM tasks WHERE id = $1',
    [taskId]
  );

  if (taskResult.rows.length === 0) {
    return { valid: false, reason: 'task_not_found' };
  }

  const task = taskResult.rows[0];

  // If no feature_id, it's a single task - no validation needed
  if (!task.feature_id) {
    return { valid: true, task };
  }

  // Get the feature
  const featureResult = await pool.query(
    'SELECT * FROM features WHERE id = $1',
    [task.feature_id]
  );

  if (featureResult.rows.length === 0) {
    return { valid: false, reason: 'feature_not_found', task };
  }

  const feature = featureResult.rows[0];

  // Validate: task must be the feature's active task
  if (feature.active_task_id !== taskId) {
    return {
      valid: false,
      reason: 'task_not_active_for_feature',
      task,
      feature,
      expected_task_id: feature.active_task_id
    };
  }

  return { valid: true, task, feature };
}

/**
 * Acquire task lock for a feature (set active_task_id)
 * @param {string} featureId - Feature UUID
 * @param {string} taskId - Task UUID to set as active
 * @returns {Promise<{success: boolean, reason?: string}>}
 */
async function acquireTaskLock(featureId, taskId) {
  // Use advisory lock to prevent race conditions
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Try to acquire advisory lock (feature_id based)
    const lockResult = await client.query(
      'SELECT pg_try_advisory_xact_lock($1)',
      [hashCode(featureId)]
    );

    if (!lockResult.rows[0].pg_try_advisory_xact_lock) {
      await client.query('ROLLBACK');
      return { success: false, reason: 'lock_contention' };
    }

    // Check anti-crossing
    const check = await checkAntiCrossingWithClient(client, featureId);
    if (!check.allowed) {
      await client.query('ROLLBACK');
      return { success: false, reason: check.reason };
    }

    // Set active_task_id
    await client.query(
      'UPDATE features SET active_task_id = $2, updated_at = NOW() WHERE id = $1',
      [featureId, taskId]
    );

    await client.query('COMMIT');
    return { success: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Release task lock for a feature (clear active_task_id)
 * @param {string} featureId - Feature UUID
 * @param {string} taskId - Task UUID that should currently be active
 * @returns {Promise<{success: boolean, reason?: string}>}
 */
async function releaseTaskLock(featureId, taskId) {
  // Only clear if the current active_task_id matches
  const result = await pool.query(`
    UPDATE features
    SET active_task_id = NULL, updated_at = NOW()
    WHERE id = $1 AND active_task_id = $2
    RETURNING id
  `, [featureId, taskId]);

  if (result.rows.length === 0) {
    // Either feature doesn't exist or active_task_id doesn't match
    return { success: false, reason: 'task_id_mismatch_or_not_found' };
  }

  return { success: true };
}

/**
 * Check anti-crossing with a specific client (for transaction use)
 */
async function checkAntiCrossingWithClient(client, featureId) {
  const result = await client.query(
    'SELECT id, title, status, active_task_id FROM features WHERE id = $1',
    [featureId]
  );

  if (result.rows.length === 0) {
    return { allowed: false, reason: 'feature_not_found' };
  }

  const feature = result.rows[0];

  if (feature.active_task_id) {
    const taskResult = await client.query(
      'SELECT id, status FROM tasks WHERE id = $1',
      [feature.active_task_id]
    );

    if (taskResult.rows.length > 0) {
      const task = taskResult.rows[0];
      if (!['completed', 'failed', 'cancelled'].includes(task.status)) {
        return {
          allowed: false,
          reason: 'feature_has_active_task',
          active_task_id: feature.active_task_id
        };
      }
    }
  }

  const allowedStatuses = ['planning', 'task_completed', 'evaluating'];
  if (!allowedStatuses.includes(feature.status)) {
    return { allowed: false, reason: 'feature_status_not_ready' };
  }

  return { allowed: true };
}

/**
 * Simple hash function for advisory lock
 */
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Get all active features with their current task status
 * Useful for debugging and monitoring
 * @returns {Promise<Array>}
 */
async function getActiveFeaturesWithTasks() {
  const result = await pool.query(`
    SELECT
      f.id AS feature_id,
      f.title AS feature_title,
      f.status AS feature_status,
      f.active_task_id,
      t.id AS task_id,
      t.title AS task_title,
      t.status AS task_status
    FROM features f
    LEFT JOIN tasks t ON f.active_task_id = t.id
    WHERE f.status NOT IN ('completed', 'cancelled')
    ORDER BY f.created_at ASC
  `);

  return result.rows;
}

/**
 * Clean up orphaned active_task_id references
 * Sets active_task_id to NULL when pointing to completed/failed/cancelled tasks
 * @returns {Promise<number>} - Number of features cleaned up
 */
async function cleanupOrphanedTaskRefs() {
  const result = await pool.query(`
    UPDATE features f
    SET active_task_id = NULL, updated_at = NOW()
    WHERE active_task_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM tasks t
        WHERE t.id = f.active_task_id
          AND t.status NOT IN ('completed', 'failed', 'cancelled')
      )
    RETURNING id
  `);

  return result.rows.length;
}

export {
  checkAntiCrossing,
  validateTaskCompletion,
  acquireTaskLock,
  releaseTaskLock,
  getActiveFeaturesWithTasks,
  cleanupOrphanedTaskRefs,
  hashCode
};
