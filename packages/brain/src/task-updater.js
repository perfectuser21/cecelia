/**
 * Task Updater Service
 *
 * Centralized service for updating task status and broadcasting updates via WebSocket
 */

import pool from './db.js';
import { publishTaskStarted, publishTaskCompleted, publishTaskFailed, publishTaskProgress } from './events/taskEvents.js';
import { emit } from './event-bus.js';

// Security: Whitelist of allowed columns for dynamic updates
const ALLOWED_COLUMNS = ['assigned_to', 'priority', 'payload', 'error', 'artifacts', 'run_id'];
const VALID_STATUSES = ['queued', 'in_progress', 'completed', 'failed'];

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
 * Block a task temporarily (e.g. billing cap, rate limit, dependency not ready)
 * Sets status='blocked' and writes blocked_at/blocked_reason/blocked_detail/blocked_until.
 * Emits 'task:blocked' event.
 *
 * @param {string} taskId - Task ID
 * @param {Object} options
 * @param {string} options.reason - Short reason code (e.g. 'billing_cap', 'rate_limit')
 * @param {string} [options.detail] - Human-readable detail / raw error string
 * @param {Date|string|null} [options.until] - When to auto-unblock (null = manual only)
 * @returns {Promise<Object>} - { success, task? }
 */
export async function blockTask(taskId, { reason, detail = null, until = null } = {}) {
  try {
    const blockedUntil = until ? (until instanceof Date ? until.toISOString() : until) : null;
    // blocked_detail is JSONB — serialize string details as { message: "..." }
    const blockedDetail = detail != null
      ? JSON.stringify(typeof detail === 'string' ? { message: detail } : detail)
      : null;

    const result = await pool.query(`
      UPDATE tasks
      SET status = 'blocked',
          blocked_at = NOW(),
          blocked_reason = $2,
          blocked_detail = $3::jsonb,
          blocked_until = $4,
          updated_at = NOW()
      WHERE id = $1 AND status IN ('queued', 'in_progress', 'failed')
      RETURNING *
    `, [taskId, reason || null, blockedDetail, blockedUntil]);

    if (result.rows.length === 0) {
      throw new Error(`Task ${taskId} not found or not in blockable state`);
    }

    const task = result.rows[0];

    await emit('task:blocked', 'task-updater', {
      task_id: taskId,
      task_title: task.title,
      reason,
      detail,
      blocked_until: blockedUntil,
    });

    console.log(`[task-updater] Task ${taskId} blocked: reason=${reason}, until=${blockedUntil || 'manual'}`);
    return { success: true, task };
  } catch (err) {
    console.error(`[task-updater] Failed to block task ${taskId}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Unblock a task and return it to the queued state.
 * Clears blocked_at/blocked_reason/blocked_detail/blocked_until.
 * Emits 'task:unblocked' event.
 *
 * @param {string} taskId - Task ID
 * @returns {Promise<Object>} - { success, task? }
 */
export async function unblockTask(taskId) {
  try {
    const result = await pool.query(`
      UPDATE tasks
      SET status = 'queued',
          blocked_at = NULL,
          blocked_reason = NULL,
          blocked_detail = NULL,
          blocked_until = NULL,
          started_at = NULL,
          updated_at = NOW()
      WHERE id = $1 AND status = 'blocked'
      RETURNING *
    `, [taskId]);

    if (result.rows.length === 0) {
      throw new Error(`Task ${taskId} not found or not in blocked state`);
    }

    const task = result.rows[0];

    await emit('task:unblocked', 'task-updater', {
      task_id: taskId,
      task_title: task.title,
    });

    console.log(`[task-updater] Task ${taskId} unblocked, status → queued`);
    return { success: true, task };
  } catch (err) {
    console.error(`[task-updater] Failed to unblock task ${taskId}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Auto-recover expired blocked tasks (blocked_until < now()).
 * Called by tick.js on each execution.
 *
 * @returns {Promise<Array>} - List of recovered tasks { task_id, title }
 */
export async function unblockExpiredTasks() {
  try {
    const result = await pool.query(`
      SELECT id, title, blocked_reason
      FROM tasks
      WHERE status = 'blocked'
        AND blocked_until IS NOT NULL
        AND blocked_until < NOW()
    `);

    if (result.rows.length === 0) return [];

    const recovered = [];
    for (const task of result.rows) {
      const r = await unblockTask(task.id);
      if (r.success) {
        recovered.push({ task_id: task.id, title: task.title, blocked_reason: task.blocked_reason });
      }
    }

    if (recovered.length > 0) {
      console.log(`[task-updater] Auto-unblocked ${recovered.length} expired blocked task(s)`);
    }

    return recovered;
  } catch (err) {
    console.error('[task-updater] unblockExpiredTasks error:', err.message);
    return [];
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
