/**
 * Review Gate - 拆解审查门控
 *
 * 拆解完成后不直接激活下一层，而是进入 pending_review → Vivian 审查 → 通过后激活。
 *
 * 核心函数：
 * - shouldTriggerReview(pool, entityType, entityId) → boolean
 * - createReviewTask(pool, { entityType, entityId, entityName, parentKrId }) → task
 * - processReviewResult(pool, taskId, verdict, findings) → void
 */

import { getTaskLocation } from './task-router.js';
import { createTask } from './actions.js';

/**
 * 检查是否需要触发审查。
 * 条件：entity 有拆解产出（子实体）且没有 pending review task。
 *
 * @param {import('pg').Pool} pool - 数据库连接池
 * @param {string} entityType - 'project'
 * @param {string} entityId - 实体 UUID
 * @returns {Promise<boolean>} true = 需要审查
 */
async function shouldTriggerReview(pool, entityType, entityId) {
  if (!entityType || !entityId) return false;

  // 四层模型：Project 的直接子实体是 Task；退役层不再触发审查。
  if (entityType !== 'project') return false;
  const children = await pool.query(
    `SELECT 1 FROM tasks WHERE project_id = $1 AND task_type <> 'project' LIMIT 1`, [entityId]
  );
  const hasChildren = children.rows.length > 0;

  if (!hasChildren) return false;

  // 2. 检查是否已有 pending review（verdict IS NULL = pending）
  const pending = await pool.query(
    `SELECT 1 FROM decomp_reviews
     WHERE entity_type = $1 AND entity_id = $2 AND verdict IS NULL
     LIMIT 1`,
    [entityType, entityId]
  );

  if (pending.rows.length > 0) return false;

  // 3. 也检查是否有 queued/in_progress 的 decomp_review task
  const activeTask = await pool.query(
    `SELECT 1 FROM tasks
     WHERE task_type = 'decomp_review'
       AND payload->>'entity_id' = $1
       AND status IN ('queued', 'in_progress')
     LIMIT 1`,
    [entityId]
  );

  return activeTask.rows.length === 0;
}

/**
 * 创建审查任务，路由到 HK（Vivian，MiniMax Ultra）。
 *
 * @param {import('pg').Pool} pool - 数据库连接池
 * @param {Object} params
 * @param {string} params.entityType - 'project'
 * @param {string} params.entityId - 实体 UUID
 * @param {string} params.entityName - 实体名称
 * @param {string} params.parentKrId - 所属 KR ID
 * @returns {Promise<Object>} 创建的 task + review 记录
 */
async function createReviewTask(pool, { entityType, entityId, entityName, parentKrId }, taskCreator = createTask) {
  // 1. 收集拆解产出信息
  let childrenSummary = '';
  if (entityType !== 'project') throw new Error('layer_retired');
  const children = await pool.query(
    `SELECT title, status FROM tasks WHERE project_id = $1 AND task_type <> 'project' ORDER BY sequence_no ASC NULLS LAST, created_at ASC`,
    [entityId]
  );
  childrenSummary = children.rows.map((c, i) => `${i + 1}. ${c.title} (${c.status})`).join('\n');

  // 2. 创建 decomp_reviews 记录（verdict=NULL 表示 pending）
  const reviewRow = await pool.query(
    `INSERT INTO decomp_reviews (entity_type, entity_id, reviewer)
     VALUES ($1, $2, 'vivian')
     RETURNING id`,
    [entityType, entityId]
  );
  const reviewId = reviewRow.rows[0].id;

  // 3. 创建 decomp_review task
  const location = getTaskLocation('decomp_review');
  const created = await taskCreator({
    db: pool,
    source: 'child',
    source_id: `decomposition-review:${reviewId}`,
    title: `拆解审查: ${entityName}`,
    description: [
        `请审查「${entityName}」的拆解质量。`,
        '',
        `实体类型: ${entityType}`,
        `实体 ID: ${entityId}`,
        `所属 KR: ${parentKrId || '(无)'}`,
        '',
        '拆解产出:',
        childrenSummary || '(无)',
        '',
        '审查要点:',
        '1. 拆解粒度是否合理（不过粗也不过细）',
        '2. 子实体覆盖度（是否遗漏关键工作）',
        '3. 命名和描述质量',
        '4. 与 KR 目标的对齐度',
        '',
        '请返回 verdict: approved / needs_revision / rejected',
        '以及 findings（JSON）说明审查发现。',
      ].join('\n'),
    project_id: entityId,
    goal_id: parentKrId || null,
    task_type: 'decomp_review',
    priority: 'P0',
    trigger_source: 'brain_auto',
    allow_unscoped: true,
    payload: {
      entity_type: entityType,
      entity_id: entityId,
      review_id: reviewId,
      review_scope: 'decomposition_quality',
      routing: location,
    },
  });
  const task = created.task;

  // 4. 回填 task_id 到 review 记录
  await pool.query(
    `UPDATE decomp_reviews SET task_id = $1 WHERE id = $2`,
    [task.id, reviewId]
  );

  console.log(`[review-gate] Created review task ${task.id} for ${entityType} "${entityName}" → ${location}`);

  return {
    task,
    review: { id: reviewId, entity_type: entityType, entity_id: entityId },
  };
}

/**
 * 处理审查结果。
 *
 * @param {import('pg').Pool} pool - 数据库连接池
 * @param {string} taskId - decomp_review task ID
 * @param {string} verdict - 'approved' | 'needs_revision' | 'rejected'
 * @param {Object} findings - 审查发现（JSON）
 */
async function processReviewResult(pool, taskId, verdict, findings, taskCreator = createTask) {
  // 1. 查找关联的 review 记录
  const reviewResult = await pool.query(
    `SELECT id, entity_type, entity_id FROM decomp_reviews WHERE task_id = $1`,
    [taskId]
  );

  if (reviewResult.rows.length === 0) {
    console.warn(`[review-gate] No review record found for task ${taskId}`);
    return;
  }

  const { id: reviewId, entity_type: entityType, entity_id: entityId } = reviewResult.rows[0];

  // 2. 更新 review 记录
  await pool.query(
    `UPDATE decomp_reviews SET verdict = $1, findings = $2, reviewed_at = NOW() WHERE id = $3`,
    [verdict, JSON.stringify(findings || {}), reviewId]
  );

  console.log(`[review-gate] Review ${reviewId} verdict: ${verdict} for ${entityType} ${entityId}`);

  if (entityType !== 'project') return;

  // 3. 根据 verdict 执行后续动作
  if (verdict === 'approved') {
    // 激活实体
    await pool.query(
      `UPDATE projects SET status = 'active' WHERE id = $1 AND status = 'pending_review'`,
      [entityId]
    );
    console.log(`[review-gate] Entity ${entityId} activated (approved)`);

  } else if (verdict === 'needs_revision') {
    // 创建修正 decomp task
    const entityRow = await pool.query(
      `SELECT name, kr_id FROM projects WHERE id = $1`, [entityId]
    );
    const entityName = entityRow.rows[0]?.name || 'Unknown';
    const krId = entityRow.rows[0]?.kr_id || null;

    const revisionTask = await taskCreator({
      db: pool,
      source: 'child',
      source_id: `decomposition-revision:${reviewId}`,
      title: `修正拆解: ${entityName}`,
      description: [
          `Vivian 审查发现问题，请修正「${entityName}」的拆解。`,
          '',
          `审查发现:`,
          JSON.stringify(findings || {}, null, 2),
          '',
          '请根据审查意见修正拆解结构。',
        ].join('\n'),
      project_id: entityId,
      goal_id: krId,
      task_type: 'project_plan',
      priority: 'P0',
      trigger_source: 'brain_auto',
      allow_unscoped: true,
      payload: {
          decomposition: 'true',
          revision: true,
          review_id: reviewId,
          entity_type: entityType,
          entity_id: entityId,
      },
    });
    console.log(`[review-gate] Created revision task ${revisionTask.task.id} for ${entityName}`);

  } else if (verdict === 'rejected') {
    // 标记实体 blocked
    await pool.query(
      `UPDATE projects SET status = 'blocked' WHERE id = $1`,
      [entityId]
    );
    console.log(`[review-gate] Entity ${entityId} blocked (rejected)`);
  }
}

export {
  shouldTriggerReview,
  createReviewTask,
  processReviewResult,
};
