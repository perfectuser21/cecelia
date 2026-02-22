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

/**
 * 检查是否需要触发审查。
 * 条件：entity 有拆解产出（子实体）且没有 pending review task。
 *
 * @param {import('pg').Pool} pool - 数据库连接池
 * @param {string} entityType - 'project' | 'initiative'
 * @param {string} entityId - 实体 UUID
 * @returns {Promise<boolean>} true = 需要审查
 */
async function shouldTriggerReview(pool, entityType, entityId) {
  if (!entityType || !entityId) return false;

  // 1. 检查是否有拆解产出
  let hasChildren = false;
  if (entityType === 'project') {
    // Project 的子实体是 Initiative
    const r = await pool.query(
      `SELECT 1 FROM projects WHERE parent_id = $1 AND type = 'initiative' LIMIT 1`,
      [entityId]
    );
    hasChildren = r.rows.length > 0;
  } else if (entityType === 'initiative') {
    // Initiative 的子实体是 Task
    const r = await pool.query(
      `SELECT 1 FROM tasks WHERE project_id = $1 LIMIT 1`,
      [entityId]
    );
    hasChildren = r.rows.length > 0;
  }

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
 * @param {string} params.entityType - 'project' | 'initiative'
 * @param {string} params.entityId - 实体 UUID
 * @param {string} params.entityName - 实体名称
 * @param {string} params.parentKrId - 所属 KR ID
 * @returns {Promise<Object>} 创建的 task + review 记录
 */
async function createReviewTask(pool, { entityType, entityId, entityName, parentKrId }) {
  // 1. 收集拆解产出信息
  let childrenSummary = '';
  if (entityType === 'project') {
    const r = await pool.query(
      `SELECT name, status FROM projects WHERE parent_id = $1 AND type = 'initiative' ORDER BY sequence_order ASC NULLS LAST, created_at ASC`,
      [entityId]
    );
    childrenSummary = r.rows.map((c, i) => `${i + 1}. ${c.name} (${c.status})`).join('\n');
  } else if (entityType === 'initiative') {
    const r = await pool.query(
      `SELECT title, status FROM tasks WHERE project_id = $1 ORDER BY created_at ASC`,
      [entityId]
    );
    childrenSummary = r.rows.map((c, i) => `${i + 1}. ${c.title} (${c.status})`).join('\n');
  }

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
  const task = await pool.query(
    `INSERT INTO tasks (title, description, status, priority, goal_id, task_type, payload, trigger_source)
     VALUES ($1, $2, 'queued', 'P0', $3, 'decomp_review', $4, 'brain_auto')
     RETURNING id, title`,
    [
      `拆解审查: ${entityName}`,
      [
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
      parentKrId || null,
      JSON.stringify({
        entity_type: entityType,
        entity_id: entityId,
        review_id: reviewId,
        review_scope: 'decomposition_quality',
        routing: location,
      }),
    ]
  );

  // 4. 回填 task_id 到 review 记录
  await pool.query(
    `UPDATE decomp_reviews SET task_id = $1 WHERE id = $2`,
    [task.rows[0].id, reviewId]
  );

  console.log(`[review-gate] Created review task ${task.rows[0].id} for ${entityType} "${entityName}" → ${location}`);

  return {
    task: task.rows[0],
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
async function processReviewResult(pool, taskId, verdict, findings) {
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
      `SELECT name, parent_id FROM projects WHERE id = $1`,
      [entityId]
    );
    const entityName = entityRow.rows[0]?.name || 'Unknown';

    // 找到关联的 KR
    let krId = null;
    if (entityRow.rows[0]?.parent_id) {
      const krResult = await pool.query(
        `SELECT kr_id FROM project_kr_links WHERE project_id = $1 LIMIT 1`,
        [entityRow.rows[0].parent_id]
      );
      krId = krResult.rows[0]?.kr_id || null;
    }

    const revisionTask = await pool.query(
      `INSERT INTO tasks (title, description, status, priority, goal_id, task_type, payload, trigger_source)
       VALUES ($1, $2, 'queued', 'P0', $3, 'dev', $4, 'brain_auto')
       RETURNING id, title`,
      [
        `修正拆解: ${entityName}`,
        [
          `Vivian 审查发现问题，请修正「${entityName}」的拆解。`,
          '',
          `审查发现:`,
          JSON.stringify(findings || {}, null, 2),
          '',
          '请根据审查意见修正拆解结构。',
        ].join('\n'),
        krId,
        JSON.stringify({
          decomposition: 'true',
          revision: true,
          review_id: reviewId,
          entity_type: entityType,
          entity_id: entityId,
        }),
      ]
    );
    console.log(`[review-gate] Created revision task ${revisionTask.rows[0].id} for ${entityName}`);

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
