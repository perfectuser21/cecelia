/**
 * Task Updater Service
 *
 * Centralized service for updating task status and broadcasting updates via WebSocket
 */

import pool from './db.js';
import { publishTaskStarted, publishTaskCompleted, publishTaskFailed, publishTaskProgress } from './events/taskEvents.js';

// Security: Whitelist of allowed columns for dynamic updates
const ALLOWED_COLUMNS = ['assigned_to', 'priority', 'payload', 'error', 'artifacts', 'run_id'];
const VALID_STATUSES = ['queued', 'in_progress', 'completed', 'failed'];

const VALID_BLOCKED_REASONS = ['dependency', 'resource', 'auth', 'manual', 'rate_limit', 'other'];

/**
 * Update task status and broadcast to WebSocket clients
 * @param {string} taskId - Task ID
 * @param {string} status - New status (queued, in_progress, completed, failed)
 * @param {Object} additionalFields - Additional fields to update
 * @returns {Promise<Object>} - Update result
 */
export async function updateTaskStatus(taskId, status, additionalFields = {}) {
  try {
    // Input validation
    if (!VALID_STATUSES.includes(status)) {
      throw new Error(`Invalid status: ${status}`);
    }

    // Build UPDATE query dynamically
    const updates = ['status = $2'];
    const params = [taskId, status];
    let paramIndex = 3;

    // Add timestamp updates based on status
    if (status === 'in_progress') {
      updates.push('started_at = NOW()');
    } else if (status === 'completed') {
      updates.push('completed_at = NOW()');
    }

    // Add additional fields with whitelist validation
    for (const [key, value] of Object.entries(additionalFields)) {
      if (key === 'payload') {
        // Merge JSON payload safely
        try {
          updates.push(`payload = COALESCE(payload, '{}'::jsonb) || $${paramIndex}::jsonb`);
          params.push(JSON.stringify(value));
          paramIndex++;
        } catch (err) {
          throw new Error(`Invalid JSON payload: ${err.message}`);
        }
      } else if (ALLOWED_COLUMNS.includes(key)) {
        // Only allow whitelisted columns to prevent SQL injection
        updates.push(`${key} = $${paramIndex}`);
        params.push(value);
        paramIndex++;
      } else {
        console.warn(`[task-updater] Ignoring non-whitelisted column: ${key}`);
      }
    }

    // Execute update
    const updateQuery = `
      UPDATE tasks
      SET ${updates.join(', ')}, updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;

    const result = await pool.query(updateQuery, params);

    if (result.rows.length === 0) {
      throw new Error(`Task ${taskId} not found`);
    }

    const updatedTask = result.rows[0];

    // Broadcast to WebSocket clients
    broadcastTaskUpdate(updatedTask);

    return { success: true, task: updatedTask };
  } catch (err) {
    console.error(`[task-updater] Failed to update task ${taskId}:`, err.message);
    console.error('[task-updater] Stack:', err.stack);
    return { success: false, error: err.message };
  }
}

/**
 * Update task progress (without changing status)
 * @param {string} taskId - Task ID
 * @param {Object} progressData - Progress data to merge into payload
 * @returns {Promise<Object>} - Update result
 */
export async function updateTaskProgress(taskId, progressData) {
  try {
    const result = await pool.query(`
      UPDATE tasks
      SET
        payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [taskId, JSON.stringify(progressData)]);

    if (result.rows.length === 0) {
      throw new Error(`Task ${taskId} not found`);
    }

    const updatedTask = result.rows[0];

    // Broadcast to WebSocket clients
    broadcastTaskUpdate(updatedTask);

    return { success: true, task: updatedTask };
  } catch (err) {
    console.error(`[task-updater] Failed to update task progress ${taskId}:`, err.message);
    console.error('[task-updater] Stack:', err.stack);
    return { success: false, error: err.message };
  }
}

/**
 * Broadcast task update to WebSocket clients
 * @param {Object} task - Task object from database
 */
function broadcastTaskUpdate(task) {
  const payload = task.payload || {};
  const runId = payload.current_run_id || payload.run_id || null;

  // Publish appropriate event based on status using event publishers
  switch (task.status) {
    case 'in_progress':
      publishTaskStarted({
        id: task.id,
        run_id: runId,
        title: task.title
      });
      break;
    case 'completed':
      publishTaskCompleted(task.id, runId, payload);
      break;
    case 'failed':
      publishTaskFailed(task.id, runId, payload.error || 'Unknown error');
      break;
    case 'queued':
      // Progress update for queued tasks
      if (payload.progress !== undefined) {
        publishTaskProgress(task.id, runId, payload.progress);
      }
      break;
    default:
      // For other statuses, broadcast progress if available
      if (payload.progress !== undefined) {
        // Safe progress calculation with validation
        let progress = 0;
        if (payload.current_step) {
          const parsed = parseInt(payload.current_step, 10);
          progress = isNaN(parsed) ? 0 : Math.max(0, Math.min(100, parsed));
        }
        publishTaskProgress(task.id, runId, progress);
      }
  }
}

/**
 * Fetch task and broadcast current state (useful for manual triggers)
 * @param {string} taskId - Task ID
 * @returns {Promise<void>}
 */
export async function broadcastTaskState(taskId) {
  try {
    const result = await pool.query('SELECT * FROM tasks WHERE id = $1', [taskId]);

    if (result.rows.length === 0) {
      console.error(`[task-updater] Task ${taskId} not found for broadcast`);
      return;
    }

    broadcastTaskUpdate(result.rows[0]);
  } catch (err) {
    console.error(`[task-updater] Failed to broadcast task ${taskId}:`, err.message);
  }
}

/**
 * Block a task — set status to 'blocked' and fill all blocked_* fields.
 * @param {string} taskId
 * @param {Object} [options]
 * @param {string} [options.reason='other'] - One of VALID_BLOCKED_REASONS
 * @param {string|Object} [options.detail] - Free-text or object stored as JSONB
 * @param {Date|string} [options.until] - Expiry time for auto-unblock
 * @returns {Promise<Object>}
 */
export async function blockTask(taskId, { reason = 'other', detail = null, until = null } = {}) {
  if (!VALID_BLOCKED_REASONS.includes(reason)) {
    throw new Error(`Invalid blocked_reason: "${reason}". Must be one of: ${VALID_BLOCKED_REASONS.join(', ')}`);
  }

  const blockedDetail = detail != null
    ? JSON.stringify(typeof detail === 'string' ? { message: detail } : detail)
    : null;

  const blockedUntil = until ? new Date(until).toISOString() : null;

  const result = await pool.query(`
    UPDATE tasks
    SET
      status = 'blocked',
      blocked_at = NOW(),
      blocked_reason = $2,
      blocked_detail = $3::jsonb,
      blocked_until = $4,
      updated_at = NOW()
    WHERE id = $1
      AND status IN ('queued', 'in_progress', 'failed')
    RETURNING *
  `, [taskId, reason, blockedDetail, blockedUntil]);

  if (result.rows.length === 0) {
    throw new Error(`Task ${taskId} not found or not in a blockable state (queued/in_progress/failed)`);
  }

  console.log(`[task-updater] Blocked task ${taskId} (reason: ${reason})`);
  return { success: true, task: result.rows[0] };
}

/**
 * Unblock a task — reset status to 'queued' and clear all blocked_* fields.
 * @param {string} taskId
 * @returns {Promise<Object>}
 */
export async function unblockTask(taskId) {
  const result = await pool.query(`
    UPDATE tasks
    SET
      status = 'queued',
      blocked_at = NULL,
      blocked_reason = NULL,
      blocked_detail = NULL,
      blocked_until = NULL,
      started_at = NULL,
      updated_at = NOW()
    WHERE id = $1
      AND status = 'blocked'
    RETURNING *
  `, [taskId]);

  if (result.rows.length === 0) {
    throw new Error(`Task ${taskId} not found or not in 'blocked' status`);
  }

  console.log(`[task-updater] Unblocked task ${taskId} → queued`);
  return { success: true, task: result.rows[0] };
}

/**
 * Auto-unblock tasks whose blocked_until has passed.
 * Called by tick.js on every tick (before early-return).
 * @returns {Promise<number>} count of unblocked tasks
 */
export async function unblockExpiredTasks() {
  try {
    const result = await pool.query(`
      UPDATE tasks
      SET
        status = 'queued',
        blocked_at = NULL,
        blocked_reason = NULL,
        blocked_detail = NULL,
        blocked_until = NULL,
        started_at = NULL,
        updated_at = NOW()
      WHERE status = 'blocked'
        AND blocked_until IS NOT NULL
        AND blocked_until < NOW()
      RETURNING id
    `);

    if (result.rowCount > 0) {
      console.log(`[tick] Auto-unblocked ${result.rowCount} tasks (expired blocked_until)`);
    }
    return result.rowCount;
  } catch (err) {
    console.error('[task-updater] unblockExpiredTasks error:', err.message);
    return 0;
  }
}
