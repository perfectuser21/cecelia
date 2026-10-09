/**
 * Task Updater Service
 *
 * Centralized service for updating task status and broadcasting updates via WebSocket
 */

import pool from './db.js';
import { publishTaskStarted, publishTaskCompleted, publishTaskFailed, publishTaskProgress } from './events/taskEvents.js';
import { emit } from './event-bus.js';
import {
  assertOwnerDecisionProtocol, OwnerDecisionProtocolError, OWNER_DECISION_REASON,
  openOwnerDecisionPendingAction, closeOwnerDecisionPendingAction,
} from './lib/owner-decision.js';
import { finalizeTask, isTerminalStatus } from './lib/task-terminal.js';

// Security: Whitelist of allowed columns for dynamic updates
const ALLOWED_COLUMNS = ['assigned_to', 'priority', 'payload', 'error', 'artifacts', 'run_id', 'error_message'];
const VALID_STATUSES = ['queued', 'in_progress', 'completed', 'completed_no_pr', 'failed', 'pending_postdeploy'];
// 终态分支委托 lib/task-terminal.js：这些附加字段能映射成 finalizeTask 白名单列
const TERMINAL_SET_COLUMNS = ['assigned_to', 'priority', 'error_message'];

/**
 * 终态 → 唯一收口 finalizeTask（写完自动接棒）。返回 RETURNING * 行。
 * completed_at 用 'now' 覆盖：与本函数历史行为一致（executor 回写以本次为准）。
 */
async function finalizeViaHub(taskId, status, additionalFields) {
  const set = { completed_at: status === 'completed' || status === 'completed_no_pr' ? 'now' : undefined };
  if (set.completed_at === undefined) delete set.completed_at;
  let mergePayload = null;
  for (const [key, value] of Object.entries(additionalFields)) {
    if (key === 'payload') {
      mergePayload = value;
    } else if (TERMINAL_SET_COLUMNS.includes(key)) {
      set[key] = value;
    } else {
      console.warn(`[task-updater] Ignoring non-whitelisted column: ${key}`);
    }
  }
  const out = await finalizeTask(pool, taskId, status, { set, mergePayload, returning: ['*'] });
  return out.task;
}

/**
 * Update task status and broadcast to WebSocket clients
 * @param {string} taskId - Task ID
 * @param {string} status - New status (queued, in_progress, completed, completed_no_pr, failed)
 * @param {Object} additionalFields - Additional fields to update
 * @returns {Promise<Object>} - Update result
 */
export async function updateTaskStatus(taskId, status, additionalFields = {}) {
  try {
    // Input validation
    if (!VALID_STATUSES.includes(status)) {
      throw new Error(`Invalid status: ${status}`);
    }

    let updatedTask;
    if (isTerminalStatus(status)) {
      updatedTask = await finalizeViaHub(taskId, status, additionalFields);
    } else {
      // Build UPDATE query dynamically（非终态：queued / in_progress / pending_postdeploy）
      const updates = ['status = $2'];
      const params = [taskId, status];
      let paramIndex = 3;

      // Add timestamp updates based on status
      if (status === 'in_progress') {
        updates.push('started_at = NOW()');
      } else if (status === 'queued') {
        // Clear claim so the task can be re-selected by selectNextDispatchableTask
        updates.push('claimed_by = NULL');
        updates.push('claimed_at = NULL');
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
      updatedTask = result.rows[0];
    }

    if (!updatedTask) {
      throw new Error(`Task ${taskId} not found`);
    }

    // 终态/非活跃态 → 即时释放设备锁（低延迟优化；正确性由 recovery-loop sweeper 兜底）
    if (!['queued', 'in_progress'].includes(status)) {
      try {
        const { releaseDeviceLocksHeldBy } = await import('./device-lock-helpers.js');
        await releaseDeviceLocksHeldBy(taskId);
      } catch (err) {
        console.warn(`[task-updater] device lock release failed (non-fatal): ${err.message}`);
      }
    }

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
    // 守卫 2（决策 105a5868）：owner_decision 必须带协议，缺项直接拒，不写库
    assertOwnerDecisionProtocol({ reason, detail });
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

    // waiting_on=human 才进主理人待办；待办生成失败不回滚已成功的 block（记日志，触发器/校验已保证协议完整）
    if (reason === OWNER_DECISION_REASON) {
      try {
        await openOwnerDecisionPendingAction(pool, { taskId, title: task.title, detail });
      } catch (paErr) {
        console.error('[task-updater] owner_decision pending_action 生成失败', { task_id: taskId, error: paErr.message });
      }
    }

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
    console.error('[task-updater] Failed to block task', {
      task_id: taskId,
      error: err.message,
    });
    if (err instanceof OwnerDecisionProtocolError) {
      return { success: false, error: err.message, code: err.code, violations: err.violations };
    }
    // 触发器兜底（迁移 469）抛的 23514：同样按协议违规回 400
    if (err.code === '23514' && /owner_decision_protocol_violation/.test(err.message)) {
      return { success: false, error: err.message, code: 'owner_decision_protocol_violation', violations: [] };
    }
    return { success: false, error: err.message };
  }
}

/**
 * Unblock a task and return it to the queued state.
 * Clears blocked_at/blocked_reason/blocked_detail/blocked_until.
 * Emits 'task:unblocked' event.
 *
 * @param {string} taskId - Task ID
 * @param {Object} [opts]
 * @param {{query: Function}} [opts.db] - 事务内 client（owner_decision 应答与写 payload/decisions 同事务；默认走全局 pool）
 * @returns {Promise<Object>} - { success, task? }
 */
export async function unblockTask(taskId, { db = pool } = {}) {
  try {
    const result = await db.query(`
      UPDATE tasks
      SET status = 'queued',
          claimed_by = NULL,
          claimed_at = NULL,
          blocked_at = NULL,
          blocked_reason = NULL,
          blocked_detail = NULL,
          blocked_until = NULL,
          started_at = NULL,
          updated_at = NOW()
      WHERE id = $1
        AND status = 'blocked'
        AND NOT EXISTS (
          SELECT 1
          FROM harness_gaps
          WHERE source_task_id = tasks.id
            AND status <> 'resolved'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM task_dependencies
          WHERE from_task_id = tasks.id
            AND edge_type = 'hard'
            AND status = 'pending'
        )
      RETURNING *
    `, [taskId]);

    if (result.rows.length === 0) {
      throw new Error(`Task ${taskId} not found or not in blocked state`);
    }

    const task = result.rows[0];

    // 解除阻塞后关闭该任务未决的「等你拍板」待办（不留过期待办；失败只记日志）
    await closeOwnerDecisionPendingAction(db, taskId).catch((paErr) => {
      console.error('[task-updater] 关闭 owner_decision pending_action 失败', { task_id: taskId, error: paErr.message });
    });

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
export async function unblockExpiredTasks({ limit = Infinity } = {}) {
  try {
    const result = await pool.query(`
      SELECT id, title, blocked_reason
      FROM tasks
      WHERE status = 'blocked'
        AND blocked_until IS NOT NULL
        AND blocked_until < NOW()
        -- 等主理人的决策不在此自动放行：到期后由 owner-decision-deadline sweeper 按协议处理
        -- （可逆走默认并留痕；不可逆顺延再催）。放行它 = 无决议、无留痕地吞掉一个待拍板。
        AND NOT (blocked_reason = 'owner_decision' AND blocked_detail->>'waiting_on' = 'human')
    `);

    if (result.rows.length === 0) return [];

    const toProcess = Number.isFinite(limit) ? result.rows.slice(0, limit) : result.rows;
    const recovered = [];
    for (const task of toProcess) {
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
