/**
 * Task Updater Service
 *
 * Centralized service for updating task status and broadcasting updates via WebSocket
 */

import pool from './db.js';
import websocketService from './websocket.js';

/**
 * Update task status and broadcast to WebSocket clients
 * @param {string} taskId - Task ID
 * @param {string} status - New status (queued, in_progress, completed, failed)
 * @param {Object} additionalFields - Additional fields to update
 * @returns {Promise<Object>} - Update result
 */
export async function updateTaskStatus(taskId, status, additionalFields = {}) {
  try {
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

    // Add additional fields
    for (const [key, value] of Object.entries(additionalFields)) {
      if (key === 'payload') {
        // Merge JSON payload
        updates.push(`payload = COALESCE(payload, '{}'::jsonb) || $${paramIndex}::jsonb`);
        params.push(JSON.stringify(value));
      } else {
        updates.push(`${key} = $${paramIndex}`);
        params.push(value);
      }
      paramIndex++;
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
    return { success: false, error: err.message };
  }
}

/**
 * Broadcast task update to WebSocket clients
 * @param {Object} task - Task object from database
 */
function broadcastTaskUpdate(task) {
  const payload = task.payload || {};

  websocketService.broadcastRunUpdate({
    id: task.id,
    status: task.status,
    progress: payload.current_step ? parseInt(payload.current_step, 10) : 0,
    task_id: task.id,
    agent: payload.agent || 'unknown',
    started_at: task.started_at ? task.started_at.toISOString() : null,
    completed_at: task.completed_at ? task.completed_at.toISOString() : null,
    error: payload.error || null
  });
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
