/**
 * callback-postprocess.js
 *
 * 共享的 execution callback 后处理管道。
 * routes/execution.js（HTTP 路径）和 callback-processor.js（DB 直写路径）共同引用。
 *
 * 当前包含：
 *   - serialUnlockNext   (5c11) dev task 完成→按 sequence_order 解锁下一个 blocked task
 *   - writeReviewResult  (5c8b) 审查任务完成→写入 review_result 字段
 *   - promoteRegressionOnHarnessMerged (T2) harness 任务 merged 终态→golden_path 冻结（dbOnly）
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
  const gateVerdict = ['PASS', 'FAIL'].includes(resultObj.verdict)
    ? resultObj.verdict
    : 'FAIL';
  const legacyDecision = (
    typeof resultObj.decision === 'string'
      && resultObj.decision.length > 0
      && resultObj.decision.length <= 100
  )
    ? resultObj.decision
    : (
      typeof result === 'string'
        && result.length > 0
        && result.length <= 100
    )
      ? result
      : 'FAIL';
  const decision = ['spec_review', 'code_review_gate'].includes(reviewTask.task_type)
    ? gateVerdict
    : legacyDecision;
  const summary = resultObj.summary || (typeof result === 'string' ? result : '');
  const l1Count = resultObj.l1_count ?? 0;
  const l2Count = resultObj.l2_count ?? 0;
  const reviewEvidence = (
    resultObj.review_evidence !== null
    && typeof resultObj.review_evidence === 'object'
  )
    ? resultObj.review_evidence
    : null;

  const reviewResultText = [
    `决定: ${decision}`,
    summary ? `摘要: ${summary}` : '',
    reviewEvidence?.head_sha ? `Head SHA: ${reviewEvidence.head_sha}` : '',
    reviewEvidence?.snapshot_digest
      ? `Snapshot Digest: ${reviewEvidence.snapshot_digest}`
      : '',
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

/**
 * T2. harness 任务 merged 终态 → promoteToRegression（累积 FR 通电，九要素 T2）
 *
 * 只写 golden_path 表（dbOnly:true），yaml PR ② 本版不通电（架构文档风险条）。
 * 多路触发幂等安全：promoteToRegression ① 为 DELETE by owner_task_id + INSERT 覆盖写。
 * 调用点（4 处，全部 .catch 只 warn）：callback-processor.js / routes/execution.js /
 * routes/tasks.js PATCH completed / harness-relay-watchdog.js 两处直写。
 *
 * @param {string} task_id
 * @param {any}    result  - callback/PATCH body 里的 result（可 null）
 * @param {string} pr_url  - 已知 merged PR URL（可 null，回退 tasks.pr_url / result.pr_url）
 * @param {object} pool    - pg Pool
 */
export async function promoteRegressionOnHarnessMerged(task_id, result, pr_url, pool) {
  const { rows } = await pool.query(
    'SELECT id, task_type, ability_id, payload, pr_url FROM tasks WHERE id = $1',
    [task_id]
  );
  const task = rows[0];
  if (!task || task.task_type !== 'harness_initiative') return;

  const resultObj = typeof result === 'object' && result !== null ? result : {};
  const effectivePrUrl = pr_url || task.pr_url || resultObj.pr_url || null;
  if (!effectivePrUrl && !resultObj.merged) {
    console.warn(`[callback-postprocess] promoteRegression: task=${task_id} 无 merged PR 证据，跳过`);
    return;
  }

  const payload = typeof task.payload === 'string' ? JSON.parse(task.payload) : (task.payload || {});
  const sprintDir = payload.sprint_dir;
  if (!sprintDir) {
    console.warn(`[callback-postprocess] promoteRegression: task=${task_id} payload 缺 sprint_dir，跳过`);
    return;
  }

  const { promoteToRegression } = await import('../harness-promote-regression.js');
  const { harnessTaskWorktreePath, DEFAULT_BASE_REPO } = await import('../harness-worktree.js');
  const { existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  // worktree 可能已被收割 → 回退主仓（merge 后 sprint 文件已在 main；主仓常驻 main）
  let worktreePath = payload.worktree_path || harnessTaskWorktreePath(task_id);
  if (!existsSync(join(worktreePath, sprintDir, 'sprint-prd.md'))
      && existsSync(join(DEFAULT_BASE_REPO, sprintDir, 'sprint-prd.md'))) {
    worktreePath = DEFAULT_BASE_REPO;
  }

  const outcome = await promoteToRegression(
    { pool },
    {
      task: { id: task.id, ability_id: task.ability_id, payload },
      sprintDir,
      subTasks: [{ pr_url: effectivePrUrl }],
      worktreePath,
      dbOnly: true,
    }
  );
  console.log(`[callback-postprocess] promoteRegression: task=${task_id} dbWritten=${outcome?.dbWritten ?? false} reason=${outcome?.reason || 'ok'}`);
}
