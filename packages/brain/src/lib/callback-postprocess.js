/**
 * callback-postprocess.js
 *
 * 共享的 execution callback 后处理管道。
 * routes/execution.js（HTTP 路径）和 callback-processor.js（DB 直写路径）共同引用。
 *
 * 当前包含：
 *   - serialUnlockNext   (5c11) dev task 完成→按 sequence_order 解锁下一个 blocked task
 *   - writeReviewResult  (5c8b) 审查任务完成→写入 review_result 字段
 */

import { REVIEW_TASK_TYPES as REVIEW_TASK_TYPES_ARRAY } from './review-task-types.js';
const REVIEW_TASK_TYPE_SET = new Set(REVIEW_TASK_TYPES_ARRAY);

/**
 * 5c11. 串行调度：dev task 完成（有 sequence_order）→ 解锁并注入 prev_task_result 到下一个 blocked task
 *
 * @param {string} task_id
 * @param {any}    result   - callback result 对象
 * @param {string} pr_url
 * @param {object} pool     - pg Pool
 */
export async function serialUnlockNext(task_id, result, pr_url, pool) {
  const seqRow = await pool.query(
    'SELECT task_type, project_id, goal_id, title, payload FROM tasks WHERE id = $1',
    [task_id]
  );
  const seqTask = seqRow.rows[0];
  if (!seqTask || seqTask.task_type !== 'dev' || !seqTask.project_id || seqTask.payload?.sequence_order == null) {
    return;
  }

  const projectId = seqTask.project_id;
  const currentSeq = Number(seqTask.payload.sequence_order);

  const nextTaskRow = await pool.query(
    `SELECT id, title, payload FROM tasks
     WHERE project_id = $1 AND task_type = 'dev' AND status = 'blocked'
       AND (payload->>'sequence_order')::int = $2
       AND payload->>'depends_on_prev' = 'true'
     LIMIT 1`,
    [projectId, currentSeq + 1]
  );

  if (nextTaskRow.rows.length === 0) {
    console.log(`[callback-postprocess] serialUnlockNext: task=${task_id} (seq=${currentSeq}) 无下一个串行 task`);
    return;
  }

  const nextTask = nextTaskRow.rows[0];
  const prevTaskResult = {
    task_id,
    summary: typeof result === 'object' && result !== null
      ? (result.summary || result.findings || 'completed')
      : String(result || 'completed'),
    pr_url: pr_url || null,
    sequence_order: currentSeq,
  };
  const newPayload = { ...(nextTask.payload || {}), prev_task_result: prevTaskResult };

  await pool.query(
    `UPDATE tasks SET status = 'queued', claimed_by = NULL, claimed_at = NULL, payload = $1::jsonb,
     blocked_at = NULL, blocked_reason = NULL, blocked_detail = NULL,
     blocked_until = NULL, started_at = NULL, updated_at = NOW()
     WHERE id = $2 AND status = 'blocked'`,
    [JSON.stringify(newPayload), nextTask.id]
  );

  console.log(`[callback-postprocess] serialUnlockNext: task=${task_id} (seq=${currentSeq}) → 解锁 next=${nextTask.id} (seq=${currentSeq + 1}) with prev_task_result`);
}

/**
 * 5c8b. 审查任务完成 → 写入 review_result（自身 + 父任务）
 *
 * @param {string} task_id
 * @param {any}    result
 * @param {object} pool
 */
export async function writeReviewResult(task_id, result, pool) {
  const reviewRow = await pool.query(
    'SELECT task_type, payload FROM tasks WHERE id = $1',
    [task_id]
  );
  const reviewTask = reviewRow.rows[0];
  if (!reviewTask || !REVIEW_TASK_TYPE_SET.has(reviewTask.task_type)) return;

  const reviewPayload = reviewTask.payload || {};
  const parentTaskId = reviewPayload.parent_task_id;

  const resultObj = typeof result === 'object' && result !== null ? result : {};
  const decision = resultObj.decision || (typeof result === 'string' ? result : 'PASS');
  const summary = resultObj.summary || (typeof result === 'string' ? result : '');
  const l1Count = resultObj.l1_count ?? 0;
  const l2Count = resultObj.l2_count ?? 0;

  const reviewResultText = [
    `决定: ${decision}`,
    summary ? `摘要: ${summary}` : '',
    `L1问题: ${l1Count}, L2问题: ${l2Count}`,
  ].filter(Boolean).join('\n');

  await pool.query('UPDATE tasks SET review_result = $1 WHERE id = $2', [reviewResultText, task_id]);
  console.log(`[callback-postprocess] writeReviewResult: ${reviewTask.task_type} task=${task_id}, decision=${decision}`);

  if (parentTaskId) {
    await pool.query('UPDATE tasks SET review_result = $1 WHERE id = $2', [reviewResultText, parentTaskId]);
    console.log(`[callback-postprocess] writeReviewResult: parent task=${parentTaskId}`);
  } else {
    console.warn(`[callback-postprocess] writeReviewResult: ${reviewTask.task_type} ${task_id} 无 parent_task_id，仅写入自身`);
  }
}
