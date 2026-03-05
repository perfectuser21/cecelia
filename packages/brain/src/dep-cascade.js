/**
 * Dependency Cascade - 依赖链级联传播
 *
 * 当一个 task fail/quarantined 后，递归标记下游依赖为 dep_failed。
 * 当一个 task completed 后，检查下游是否可以恢复为 queued。
 *
 * 依赖关系存储在 tasks.payload.depends_on (string[])
 */

import pool from './db.js';

/**
 * 当任务失败时，递归传播 dep_failed 状态到所有下游任务。
 *
 * @param {string} failedTaskId - 失败的任务 ID
 * @returns {Promise<{ affected: string[] }>} 被标记为 dep_failed 的任务 ID 列表
 */
async function propagateDependencyFailure(failedTaskId) {
  const affected = [];
  const visited = new Set();

  async function propagate(taskId) {
    if (visited.has(taskId)) return;
    visited.add(taskId);

    // Find all tasks that depend on this taskId
    const result = await pool.query(`
      SELECT id, status FROM tasks
      WHERE payload->'depends_on' ? $1
        AND status IN ('queued', 'in_progress', 'dep_failed')
    `, [taskId]);

    for (const row of result.rows) {
      if (row.status === 'dep_failed') {
        // Already marked, but still need to propagate further
        await propagate(row.id);
        continue;
      }

      // Mark as dep_failed
      const updateResult = await pool.query(`
        UPDATE tasks SET status = 'dep_failed',
        payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb
        WHERE id = $1 AND status IN ('queued', 'in_progress')
      `, [row.id, JSON.stringify({
        dep_failed_by: taskId,
        dep_failed_at: new Date().toISOString(),
        dep_failed_original_status: row.status,
      })]);

      if (updateResult.rowCount > 0) {
        affected.push(row.id);
        console.log(`[dep-cascade] Task ${row.id} → dep_failed (blocked by ${taskId})`);
      }

      // Recurse: this task's dependents also need to be marked
      await propagate(row.id);
    }
  }

  await propagate(failedTaskId);

  if (affected.length > 0) {
    console.log(`[dep-cascade] propagateFailure(${failedTaskId}): ${affected.length} tasks affected`);
  }

  return { affected };
}

/**
 * 当任务完成时，检查下游 dep_failed 任务是否可以恢复。
 * 只恢复那些所有依赖都已 completed 的任务。
 *
 * @param {string} completedTaskId - 完成的任务 ID
 * @returns {Promise<{ recovered: string[] }>} 被恢复为 queued 的任务 ID 列表
 */
async function recoverDependencyChain(completedTaskId) {
  const recovered = [];

  // Find all dep_failed tasks that depend on the completed task
  const result = await pool.query(`
    SELECT id, payload FROM tasks
    WHERE payload->'depends_on' ? $1
      AND status = 'dep_failed'
  `, [completedTaskId]);

  for (const row of result.rows) {
    const dependsOn = row.payload?.depends_on || [];

    // Check if ALL dependencies are now completed
    if (dependsOn.length > 0) {
      const depCheck = await pool.query(
        "SELECT COUNT(*) FROM tasks WHERE id = ANY($1) AND status != 'completed'",
        [dependsOn]
      );
      if (parseInt(depCheck.rows[0].count) > 0) {
        continue; // Still has unmet dependencies
      }
    }

    // Restore to queued
    const originalStatus = row.payload?.dep_failed_original_status || 'queued';
    const restoreStatus = originalStatus === 'in_progress' ? 'queued' : originalStatus;

    const updateResult = await pool.query(`
      UPDATE tasks SET status = $2,
      payload = COALESCE(payload, '{}'::jsonb) || $3::jsonb
      WHERE id = $1 AND status = 'dep_failed'
    `, [row.id, restoreStatus, JSON.stringify({
      dep_recovered_at: new Date().toISOString(),
      dep_recovered_by: completedTaskId,
      dep_failed_by: null,
      dep_failed_at: null,
      dep_failed_original_status: null,
    })]);

    if (updateResult.rowCount > 0) {
      recovered.push(row.id);
      console.log(`[dep-cascade] Task ${row.id} → ${restoreStatus} (recovered by ${completedTaskId})`);

      // Recursively recover tasks that depend on this recovered task
      // (they might also be unblocked now)
      const childResult = await recoverDependencyChain(row.id);
      recovered.push(...childResult.recovered);
    }
  }

  if (recovered.length > 0) {
    console.log(`[dep-cascade] recoverChain(${completedTaskId}): ${recovered.length} tasks recovered`);
  }

  return { recovered };
}

export { propagateDependencyFailure, recoverDependencyChain };
