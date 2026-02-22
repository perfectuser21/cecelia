/**
 * Progress Reviewer - 渐进验证循环
 *
 * Project 完成后，对比预期 → 审查 → 调整后续 Project 计划。
 *
 * 核心函数：
 * - reviewProjectCompletion(pool, projectId) → reviewResult
 * - shouldAdjustPlan(pool, krId, completedProjectId) → adjustment | null
 * - createPlanAdjustmentTask(pool, { krId, completedProjectId, suggestion }) → task
 */

import { getTaskLocation } from './task-router.js';

/**
 * 收集 Project 完成数据，对比时间预算。
 *
 * @param {import('pg').Pool} pool
 * @param {string} projectId - 已完成的 Project ID
 * @returns {Promise<Object>} 完成审查数据
 */
async function reviewProjectCompletion(pool, projectId) {
  // 1. 获取 Project 信息
  const projResult = await pool.query(
    `SELECT id, name, status, created_at, completed_at, time_budget_days, kr_id, parent_id
     FROM projects WHERE id = $1`,
    [projectId]
  );

  if (projResult.rows.length === 0) {
    return { found: false, projectId };
  }

  const project = projResult.rows[0];

  // 2. 收集 Initiative 统计
  const initResult = await pool.query(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status = 'completed') AS completed
     FROM projects WHERE parent_id = $1 AND type = 'initiative'`,
    [projectId]
  );
  const { total: initiativeTotal, completed: initiativeCompleted } = initResult.rows[0];

  // 3. 收集 Task 统计
  const taskResult = await pool.query(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status = 'completed') AS completed
     FROM tasks t
     JOIN projects p ON p.id = t.project_id
     WHERE p.parent_id = $1 AND p.type = 'initiative'`,
    [projectId]
  );
  const { total: taskTotal, completed: taskCompleted } = taskResult.rows[0];

  // 4. 计算实际天数
  const createdAt = new Date(project.created_at);
  const completedAt = project.completed_at ? new Date(project.completed_at) : new Date();
  const actualDays = Math.max(1, Math.round((completedAt - createdAt) / (24 * 60 * 60 * 1000)));

  // 5. 对比时间预算
  const budgetDays = project.time_budget_days || null;
  const timeRatio = budgetDays ? +(actualDays / budgetDays).toFixed(2) : null;

  return {
    found: true,
    projectId,
    projectName: project.name,
    status: project.status,
    krId: project.kr_id,
    initiativeCount: parseInt(initiativeTotal, 10),
    initiativeCompleted: parseInt(initiativeCompleted, 10),
    taskCount: parseInt(taskTotal, 10),
    taskCompleted: parseInt(taskCompleted, 10),
    actualDays,
    budgetDays,
    timeRatio,
    overBudget: timeRatio !== null && timeRatio > 1.0,
    underBudget: timeRatio !== null && timeRatio < 0.5,
  };
}

/**
 * 判断是否需要调整后续 Project 计划。
 *
 * @param {import('pg').Pool} pool
 * @param {string} krId - KR ID
 * @param {string} completedProjectId - 刚完成的 Project ID
 * @returns {Promise<Object|null>} adjustment 建议或 null
 */
async function shouldAdjustPlan(pool, krId, completedProjectId) {
  if (!krId) return null;

  // 1. 查询 KR 下所有 Projects
  const projectsResult = await pool.query(
    `SELECT p.id, p.name, p.status, p.sequence_order, p.time_budget_days, p.deadline
     FROM projects p
     JOIN project_kr_links pkl ON pkl.project_id = p.id
     WHERE pkl.kr_id = $1 AND p.type = 'project'
     ORDER BY p.sequence_order ASC NULLS LAST, p.created_at ASC`,
    [krId]
  );

  const projects = projectsResult.rows;
  const completedProjects = projects.filter(p => p.status === 'completed');
  const pendingProjects = projects.filter(p => p.status === 'pending' || p.status === 'pending_review');

  // 2. 没有后续 pending Project → 不需要调整
  if (pendingProjects.length === 0) {
    return null;
  }

  // 3. 获取完成的 Project 审查数据
  const reviewData = await reviewProjectCompletion(pool, completedProjectId);

  // 4. 生成调整建议
  const suggestion = {
    krId,
    completedProjectId,
    completedProjectName: reviewData.projectName,
    totalProjects: projects.length,
    completedCount: completedProjects.length,
    pendingCount: pendingProjects.length,
    pendingProjects: pendingProjects.map(p => ({ id: p.id, name: p.name, sequence_order: p.sequence_order })),
    timeRatio: reviewData.timeRatio,
    overBudget: reviewData.overBudget,
    underBudget: reviewData.underBudget,
    actualDays: reviewData.actualDays,
    budgetDays: reviewData.budgetDays,
  };

  // 时间超支/不足时标记需要调整
  if (reviewData.overBudget) {
    suggestion.adjustmentType = 'over_budget';
    suggestion.recommendation = '时间超支，建议精简后续 Project 范围或增加资源';
  } else if (reviewData.underBudget) {
    suggestion.adjustmentType = 'under_budget';
    suggestion.recommendation = '完成时间大幅低于预期，建议扩充后续 Project 范围';
  } else {
    suggestion.adjustmentType = 'on_track';
    suggestion.recommendation = '执行节奏符合预期，继续按计划执行';
  }

  return suggestion;
}

/**
 * 创建计划调整审查任务（复用 Vivian decomp_review）。
 *
 * @param {import('pg').Pool} pool
 * @param {Object} params
 * @param {string} params.krId - KR ID
 * @param {string} params.completedProjectId - 已完成 Project ID
 * @param {Object} params.suggestion - 调整建议
 * @returns {Promise<Object>} 创建的 task + review 记录
 */
async function createPlanAdjustmentTask(pool, { krId, completedProjectId, suggestion }) {
  // 1. 创建 decomp_reviews 记录
  const reviewRow = await pool.query(
    `INSERT INTO decomp_reviews (entity_type, entity_id, reviewer)
     VALUES ('project', $1, 'vivian')
     RETURNING id`,
    [completedProjectId]
  );
  const reviewId = reviewRow.rows[0].id;

  // 2. 创建 decomp_review task
  const location = getTaskLocation('decomp_review');
  const task = await pool.query(
    `INSERT INTO tasks (title, description, status, priority, goal_id, task_type, payload, trigger_source)
     VALUES ($1, $2, 'queued', 'P1', $3, 'decomp_review', $4, 'brain_auto')
     RETURNING id, title`,
    [
      `计划调整审查: ${suggestion.completedProjectName}`,
      [
        `Project「${suggestion.completedProjectName}」已完成，请审查执行情况并决定是否调整后续计划。`,
        '',
        `执行数据:`,
        `- 实际耗时: ${suggestion.actualDays} 天`,
        `- 预算: ${suggestion.budgetDays || '(未设定)'} 天`,
        `- 时间比率: ${suggestion.timeRatio || 'N/A'}`,
        `- 状态: ${suggestion.adjustmentType}`,
        '',
        `KR 下 Project 进度: ${suggestion.completedCount}/${suggestion.totalProjects} 完成`,
        `待执行 Project:`,
        ...(suggestion.pendingProjects || []).map((p, i) => `  ${i + 1}. ${p.name}`),
        '',
        `建议: ${suggestion.recommendation}`,
        '',
        '请返回:',
        '- verdict: approved（继续按计划）/ needs_revision（需要调整）',
        '- findings: { plan_adjustment: true/false, adjustments: [...] }',
      ].join('\n'),
      krId,
      JSON.stringify({
        entity_type: 'project',
        entity_id: completedProjectId,
        review_id: reviewId,
        review_scope: 'plan_adjustment',
        plan_context: suggestion,
        routing: location,
      }),
    ]
  );

  // 3. 回填 task_id
  await pool.query(
    `UPDATE decomp_reviews SET task_id = $1 WHERE id = $2`,
    [task.rows[0].id, reviewId]
  );

  console.log(`[progress-reviewer] Created plan adjustment task ${task.rows[0].id} for project "${suggestion.completedProjectName}"`);

  return {
    task: task.rows[0],
    review: { id: reviewId },
  };
}

/**
 * 执行计划调整：根据 Vivian 审查结果更新后续 Project。
 *
 * @param {import('pg').Pool} pool
 * @param {Object} findings - 审查发现
 * @param {Object} planContext - plan_context from payload
 */
async function executePlanAdjustment(pool, findings, planContext) {
  if (!findings?.plan_adjustment || !findings?.adjustments) {
    console.log('[progress-reviewer] No plan adjustments to execute');
    return;
  }

  for (const adj of findings.adjustments) {
    if (!adj.project_id) continue;

    const updates = [];
    const values = [adj.project_id];
    let paramIdx = 2;

    if (adj.time_budget_days !== undefined) {
      updates.push(`time_budget_days = $${paramIdx++}`);
      values.push(adj.time_budget_days);
    }
    if (adj.deadline !== undefined) {
      updates.push(`deadline = $${paramIdx++}`);
      values.push(adj.deadline);
    }

    if (updates.length > 0) {
      updates.push('updated_at = NOW()');
      await pool.query(
        `UPDATE projects SET ${updates.join(', ')} WHERE id = $1`,
        values
      );
      console.log(`[progress-reviewer] Adjusted project ${adj.project_id}: ${updates.join(', ')}`);
    }
  }
}

export {
  reviewProjectCompletion,
  shouldAdjustPlan,
  createPlanAdjustmentTask,
  executePlanAdjustment,
};
