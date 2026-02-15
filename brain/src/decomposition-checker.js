/**
 * Decomposition Checker - 7-Layer OKR Decomposition Gap Detection
 *
 * Scans the 6-layer OKR hierarchy for missing child entities and creates
 * decomposition tasks for autumnrice (/okr) to fill the gaps.
 *
 * Hierarchy (strict, no layer skipping):
 *   L1 Global OKR  → L2 Global KR   (goals table, parent_id)
 *   L2 Global KR   → L3 Area OKR    (goals table, parent_id)
 *   L3 Area OKR    → L4 Area KR     (goals table, parent_id)
 *   L4 Area KR     → L5 Project     (project_kr_links table)
 *   L5 Project     → L5b Initiative (projects table, parent_id)
 *   L5b Initiative  → L6 Task       (tasks table, project_id)
 *
 * Plus: exploratory decomposition continue (check 7).
 */

import pool from './db.js';

// Dedup window: skip if decomposition task completed within this period
const DEDUP_WINDOW_HOURS = 24;

// ───────────────────────────────────────────────────────────────────
// Shared helpers
// ───────────────────────────────────────────────────────────────────

/**
 * Check if a decomposition task already exists for the given goal_id.
 * Matches queued/in_progress, or completed within DEDUP_WINDOW_HOURS.
 *
 * @param {string} goalId - Goal UUID to check
 * @returns {boolean} true if a decomposition task already exists
 */
async function hasExistingDecompositionTask(goalId) {
  const result = await pool.query(`
    SELECT id FROM tasks
    WHERE goal_id = $1
      AND (payload->>'decomposition' IN ('true', 'continue') OR title LIKE '%拆解%')
      AND (
        status IN ('queued', 'in_progress')
        OR (status = 'completed' AND completed_at > NOW() - INTERVAL '${DEDUP_WINDOW_HOURS} hours')
      )
    LIMIT 1
  `, [goalId]);
  return result.rows.length > 0;
}

/**
 * Create a decomposition task for autumnrice.
 *
 * @param {Object} params
 * @param {string} params.title - Task title
 * @param {string} params.description - Task description (prompt for autumnrice)
 * @param {string} params.goalId - Goal ID to attach decomposition task to
 * @param {string|null} params.projectId - Optional project ID
 * @param {Object} params.payload - Payload with decomposition metadata
 * @returns {Object} Created task row
 */
async function createDecompositionTask({ title, description, goalId, projectId, payload }) {
  const result = await pool.query(`
    INSERT INTO tasks (title, description, status, priority, goal_id, project_id, task_type, payload, trigger_source)
    VALUES ($1, $2, 'queued', 'P0', $3, $4, 'dev', $5, 'brain_auto')
    RETURNING id, title
  `, [
    title,
    description,
    goalId,
    projectId || null,
    JSON.stringify({ decomposition: 'true', ...payload })
  ]);
  return result.rows[0];
}

// ───────────────────────────────────────────────────────────────────
// Check 1: Global OKR → Global KR
// ───────────────────────────────────────────────────────────────────

/**
 * Find Global OKRs that have no Global KR children and create decomposition tasks.
 * L1 → L2: Global OKR should have at least one Global KR child.
 *
 * @returns {Object[]} Array of actions taken
 */
async function checkGlobalOkrDecomposition() {
  const actions = [];

  const result = await pool.query(`
    SELECT g.id, g.title, g.description, g.priority
    FROM goals g
    WHERE g.type = 'global_okr'
      AND g.parent_id IS NULL
      AND g.status NOT IN ('completed', 'cancelled', 'decomposing')
      AND NOT EXISTS (
        SELECT 1 FROM goals child
        WHERE child.parent_id = g.id
          AND child.type = 'global_kr'
      )
  `);

  for (const okr of result.rows) {
    if (await hasExistingDecompositionTask(okr.id)) {
      actions.push({
        action: 'skip_dedup',
        check: 'global_okr_decomposition',
        goal_id: okr.id,
        title: okr.title
      });
      continue;
    }

    const task = await createDecompositionTask({
      title: `Global OKR 拆解: ${okr.title}`,
      description: [
        `请为全局目标「${okr.title}」拆解 Global KR（全局关键结果）。`,
        '',
        '要求：',
        '1. 分析目标，拆解为 2-5 个 Global KR',
        '2. 每个 Global KR 需要可量化的衡量标准',
        '3. 调用 Brain API 创建 Global KR:',
        '   POST http://localhost:5221/api/brain/action/create-goal',
        `   Body: { "title": "...", "type": "global_kr", "parent_id": "${okr.id}", "priority": "P0" }`,
        '',
        `目标 ID: ${okr.id}`,
        `目标标题: ${okr.title}`,
        `目标描述: ${okr.description || '(无)'}`,
      ].join('\n'),
      goalId: okr.id,
      projectId: null,
      payload: { level: 'global_okr', parent_id: okr.id }
    });

    console.log(`[decomp-checker] Created Global OKR decomposition: ${okr.title}`);
    actions.push({
      action: 'create_decomposition',
      check: 'global_okr_decomposition',
      task_id: task.id,
      goal_id: okr.id,
      title: okr.title
    });
  }

  return actions;
}

// ───────────────────────────────────────────────────────────────────
// Check 2: Global KR → Area OKR (KEY new check)
// ───────────────────────────────────────────────────────────────────

/**
 * Find Global KRs that have no Area OKR children and create decomposition tasks.
 * L2 → L3: Each Global KR should decompose into 1+ Area OKRs.
 * Area OKR.parent_id MUST point to Global KR (not Global OKR!).
 *
 * @returns {Object[]} Array of actions taken
 */
async function checkGlobalKrDecomposition() {
  const actions = [];

  const result = await pool.query(`
    SELECT g.id, g.title, g.description, g.priority, g.parent_id
    FROM goals g
    WHERE g.type = 'global_kr'
      AND g.status NOT IN ('completed', 'cancelled', 'decomposing')
      AND NOT EXISTS (
        SELECT 1 FROM goals child
        WHERE child.parent_id = g.id
          AND child.type = 'area_okr'
      )
  `);

  for (const gkr of result.rows) {
    if (await hasExistingDecompositionTask(gkr.id)) {
      actions.push({
        action: 'skip_dedup',
        check: 'global_kr_decomposition',
        goal_id: gkr.id,
        title: gkr.title
      });
      continue;
    }

    const task = await createDecompositionTask({
      title: `Global KR 拆解: ${gkr.title}`,
      description: [
        `请为全局关键结果「${gkr.title}」拆解 Area OKR（领域目标）。`,
        '',
        '要求：',
        '1. 分析 Global KR，拆解为 1-3 个 Area OKR（领域月度目标）',
        '2. 每个 Area OKR 聚焦一个具体领域',
        '3. Area OKR 的 parent_id 必须指向此 Global KR（不是 Global OKR）',
        '4. 调用 Brain API 创建 Area OKR:',
        '   POST http://localhost:5221/api/brain/action/create-goal',
        `   Body: { "title": "...", "type": "area_okr", "parent_id": "${gkr.id}", "priority": "P0" }`,
        '',
        `Global KR ID: ${gkr.id}`,
        `Global KR 标题: ${gkr.title}`,
        `所属 Global OKR ID: ${gkr.parent_id}`,
      ].join('\n'),
      goalId: gkr.id,
      projectId: null,
      payload: { level: 'global_kr', parent_id: gkr.id, global_okr_id: gkr.parent_id }
    });

    console.log(`[decomp-checker] Created Global KR decomposition: ${gkr.title}`);
    actions.push({
      action: 'create_decomposition',
      check: 'global_kr_decomposition',
      task_id: task.id,
      goal_id: gkr.id,
      title: gkr.title
    });
  }

  return actions;
}

// ───────────────────────────────────────────────────────────────────
// Check 3: Area OKR → Area KR
// ───────────────────────────────────────────────────────────────────

/**
 * Find Area OKRs that have no Area KR children and create decomposition tasks.
 * L3 → L4: Each Area OKR should have at least one Area KR.
 *
 * @returns {Object[]} Array of actions taken
 */
async function checkAreaOkrDecomposition() {
  const actions = [];

  const result = await pool.query(`
    SELECT g.id, g.title, g.description, g.priority, g.parent_id
    FROM goals g
    WHERE g.type = 'area_okr'
      AND g.status NOT IN ('completed', 'cancelled', 'decomposing')
      AND NOT EXISTS (
        SELECT 1 FROM goals child
        WHERE child.parent_id = g.id
          AND child.type = 'area_kr'
      )
  `);

  for (const aokr of result.rows) {
    if (await hasExistingDecompositionTask(aokr.id)) {
      actions.push({
        action: 'skip_dedup',
        check: 'area_okr_decomposition',
        goal_id: aokr.id,
        title: aokr.title
      });
      continue;
    }

    const task = await createDecompositionTask({
      title: `Area OKR 拆解: ${aokr.title}`,
      description: [
        `请为领域目标「${aokr.title}」拆解 Area KR（领域关键结果）。`,
        '',
        '要求：',
        '1. 分析 Area OKR，拆解为 2-5 个可量化的 Area KR',
        '2. 每个 Area KR 有明确的衡量标准和目标值',
        '3. 调用 Brain API 创建 Area KR:',
        '   POST http://localhost:5221/api/brain/action/create-goal',
        `   Body: { "title": "...", "type": "area_kr", "parent_id": "${aokr.id}", "priority": "P0" }`,
        '',
        `Area OKR ID: ${aokr.id}`,
        `Area OKR 标题: ${aokr.title}`,
        `所属 Global KR ID: ${aokr.parent_id}`,
      ].join('\n'),
      goalId: aokr.id,
      projectId: null,
      payload: { level: 'area_okr', parent_id: aokr.id }
    });

    console.log(`[decomp-checker] Created Area OKR decomposition: ${aokr.title}`);
    actions.push({
      action: 'create_decomposition',
      check: 'area_okr_decomposition',
      task_id: task.id,
      goal_id: aokr.id,
      title: aokr.title
    });
  }

  return actions;
}

// ───────────────────────────────────────────────────────────────────
// Check 4: Area KR → Project (link check via project_kr_links)
// ───────────────────────────────────────────────────────────────────

/**
 * Find Area KRs that have no linked Project and create linking tasks.
 * L4 → L5: Each Area KR should be linked to at least one Project via project_kr_links.
 *
 * @returns {Object[]} Array of actions taken
 */
async function checkAreaKrProjectLink() {
  const actions = [];

  const result = await pool.query(`
    SELECT g.id, g.title, g.description, g.priority, g.parent_id
    FROM goals g
    WHERE g.type = 'area_kr'
      AND g.status NOT IN ('completed', 'cancelled')
      AND NOT EXISTS (
        SELECT 1 FROM project_kr_links pkl
        WHERE pkl.kr_id = g.id
      )
  `);

  for (const akr of result.rows) {
    if (await hasExistingDecompositionTask(akr.id)) {
      actions.push({
        action: 'skip_dedup',
        check: 'area_kr_project_link',
        goal_id: akr.id,
        title: akr.title
      });
      continue;
    }

    const task = await createDecompositionTask({
      title: `KR-Project 关联: ${akr.title}`,
      description: [
        `请为领域关键结果「${akr.title}」创建或关联 Project。`,
        '',
        '要求：',
        '1. 确定此 Area KR 需要哪个 Project（仓库）来实现',
        '2. 如果 Project 已存在，创建关联；如果不存在，先创建 Project',
        '3. 创建 Project:',
        '   POST http://localhost:5221/api/brain/action/create-project',
        `   Body: { "title": "...", "repo_path": "/home/xx/...", "kr_ids": ["${akr.id}"] }`,
        '4. 或关联已有 Project:',
        '   POST http://localhost:5221/api/brain/okr/link-project-kr',
        `   Body: { "project_id": "...", "kr_id": "${akr.id}" }`,
        '',
        `Area KR ID: ${akr.id}`,
        `Area KR 标题: ${akr.title}`,
        `所属 Area OKR ID: ${akr.parent_id}`,
      ].join('\n'),
      goalId: akr.id,
      projectId: null,
      payload: { level: 'area_kr_project_link', kr_id: akr.id }
    });

    console.log(`[decomp-checker] Created Area KR-Project link task: ${akr.title}`);
    actions.push({
      action: 'create_decomposition',
      check: 'area_kr_project_link',
      task_id: task.id,
      goal_id: akr.id,
      title: akr.title
    });
  }

  return actions;
}

// ───────────────────────────────────────────────────────────────────
// Check 5: Project → Initiative
// ───────────────────────────────────────────────────────────────────

/**
 * Find Projects (type='project') linked to KRs that have no Initiative children.
 * L5 → L5b: Each active Project should have at least one Initiative.
 *
 * @returns {Object[]} Array of actions taken
 */
async function checkProjectDecomposition() {
  const actions = [];

  // Only check projects linked to active KRs via project_kr_links
  const result = await pool.query(`
    SELECT DISTINCT p.id, p.name, p.repo_path
    FROM projects p
    INNER JOIN project_kr_links pkl ON pkl.project_id = p.id
    INNER JOIN goals g ON g.id = pkl.kr_id AND g.status NOT IN ('completed', 'cancelled')
    WHERE p.type = 'project'
      AND p.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM projects child
        WHERE child.parent_id = p.id
          AND child.type = 'initiative'
      )
  `);

  for (const proj of result.rows) {
    // Dedup using project_id instead of goal_id
    const existingDecomp = await pool.query(`
      SELECT id FROM tasks
      WHERE project_id = $1
        AND (payload->>'decomposition' IN ('true', 'continue') OR title LIKE '%拆解%')
        AND (payload->>'level' = 'project')
        AND (
          status IN ('queued', 'in_progress')
          OR (status = 'completed' AND completed_at > NOW() - INTERVAL '${DEDUP_WINDOW_HOURS} hours')
        )
      LIMIT 1
    `, [proj.id]);

    if (existingDecomp.rows.length > 0) {
      actions.push({
        action: 'skip_dedup',
        check: 'project_decomposition',
        project_id: proj.id,
        name: proj.name
      });
      continue;
    }

    // Get linked KRs for context
    const krResult = await pool.query(`
      SELECT g.id, g.title FROM goals g
      INNER JOIN project_kr_links pkl ON pkl.kr_id = g.id
      WHERE pkl.project_id = $1
    `, [proj.id]);
    const krs = krResult.rows;

    const task = await createDecompositionTask({
      title: `Project 拆解: ${proj.name}`,
      description: [
        `请为项目「${proj.name}」创建 Initiative（子项目）。`,
        '',
        '要求：',
        '1. 分析项目需要完成的工作，拆解为 1-5 个 Initiative',
        '2. 每个 Initiative 应在 1-2 小时内可完成',
        '3. 调用 Brain API 创建 Initiative:',
        '   POST http://localhost:5221/api/brain/action/create-initiative',
        `   Body: { "name": "...", "parent_id": "${proj.id}", "kr_id": "<kr_id>" }`,
        '',
        `Project ID: ${proj.id}`,
        `Project 名称: ${proj.name}`,
        `Repo: ${proj.repo_path || '(无)'}`,
        `关联 KRs: ${krs.map(kr => `${kr.title} (${kr.id})`).join(', ') || '(无)'}`,
      ].join('\n'),
      goalId: krs[0]?.id || null,
      projectId: proj.id,
      payload: { level: 'project', project_id: proj.id }
    });

    console.log(`[decomp-checker] Created Project decomposition: ${proj.name}`);
    actions.push({
      action: 'create_decomposition',
      check: 'project_decomposition',
      task_id: task.id,
      project_id: proj.id,
      name: proj.name
    });
  }

  return actions;
}

// ───────────────────────────────────────────────────────────────────
// Check 6: Initiative → Task
// ───────────────────────────────────────────────────────────────────

/**
 * Find Initiatives (type='initiative') that have no queued/in_progress tasks.
 * L5b → L6: Each active Initiative should have at least one Task.
 *
 * @returns {Object[]} Array of actions taken
 */
async function checkInitiativeDecomposition() {
  const actions = [];

  const result = await pool.query(`
    SELECT p.id, p.name, p.parent_id, p.plan_content,
           parent_proj.name AS parent_name, parent_proj.repo_path
    FROM projects p
    LEFT JOIN projects parent_proj ON parent_proj.id = p.parent_id
    WHERE p.type = 'initiative'
      AND p.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM tasks t
        WHERE t.project_id = p.id
          AND t.status NOT IN ('completed', 'cancelled')
      )
  `);

  for (const init of result.rows) {
    // Dedup: check for existing decomposition tasks targeting this initiative
    const existingDecomp = await pool.query(`
      SELECT id FROM tasks
      WHERE project_id = $1
        AND (payload->>'decomposition' IN ('true', 'continue') OR title LIKE '%拆解%')
        AND (payload->>'level' = 'initiative')
        AND (
          status IN ('queued', 'in_progress')
          OR (status = 'completed' AND completed_at > NOW() - INTERVAL '${DEDUP_WINDOW_HOURS} hours')
        )
      LIMIT 1
    `, [init.id]);

    if (existingDecomp.rows.length > 0) {
      actions.push({
        action: 'skip_dedup',
        check: 'initiative_decomposition',
        initiative_id: init.id,
        name: init.name
      });
      continue;
    }

    // Get linked KR for this initiative's parent project
    let krId = null;
    if (init.parent_id) {
      const krResult = await pool.query(`
        SELECT pkl.kr_id FROM project_kr_links pkl
        WHERE pkl.project_id = $1
        LIMIT 1
      `, [init.parent_id]);
      krId = krResult.rows[0]?.kr_id || null;
    }

    const task = await createDecompositionTask({
      title: `Initiative 拆解: ${init.name}`,
      description: [
        `请为 Initiative「${init.name}」创建具体的 Tasks。`,
        '',
        '要求：',
        '1. 分析 Initiative 的范围，创建 1-5 个 Task',
        '2. 每个 Task 约 20 分钟可完成',
        '3. 为每个 Task 写完整 PRD',
        '4. 调用 Brain API 创建 Task:',
        '   POST http://localhost:5221/api/brain/action/create-task',
        `   Body: { "title": "...", "project_id": "${init.id}", "goal_id": "${krId || ''}", "task_type": "dev", "prd_content": "..." }`,
        '',
        `Initiative ID: ${init.id}`,
        `Initiative 名称: ${init.name}`,
        `所属 Project: ${init.parent_name || '(未知)'} (${init.parent_id || 'N/A'})`,
        `Repo: ${init.repo_path || '(无)'}`,
        init.plan_content ? `Plan:\n${init.plan_content}` : '',
      ].filter(Boolean).join('\n'),
      goalId: krId,
      projectId: init.id,
      payload: { level: 'initiative', initiative_id: init.id }
    });

    console.log(`[decomp-checker] Created Initiative decomposition: ${init.name}`);
    actions.push({
      action: 'create_decomposition',
      check: 'initiative_decomposition',
      task_id: task.id,
      initiative_id: init.id,
      name: init.name
    });
  }

  return actions;
}

// ───────────────────────────────────────────────────────────────────
// Check 7: Exploratory decomposition continue
// ───────────────────────────────────────────────────────────────────

/**
 * Find completed exploratory tasks that recommend continuing decomposition.
 * When an exploratory task completes with payload.next_action = 'decompose',
 * create a follow-up decomposition task to continue the work.
 *
 * @returns {Object[]} Array of actions taken
 */
async function checkExploratoryDecompositionContinue() {
  const actions = [];

  // Find completed exploratory tasks that flagged decomposition continue
  const result = await pool.query(`
    SELECT t.id, t.title, t.project_id, t.goal_id, t.payload
    FROM tasks t
    WHERE t.task_type = 'exploratory'
      AND t.status = 'completed'
      AND t.completed_at > NOW() - INTERVAL '${DEDUP_WINDOW_HOURS} hours'
      AND t.payload->>'next_action' = 'decompose'
      AND NOT EXISTS (
        SELECT 1 FROM tasks follow
        WHERE follow.goal_id = t.goal_id
          AND follow.project_id = t.project_id
          AND follow.payload->>'decomposition' = 'continue'
          AND follow.payload->>'exploratory_source' = t.id::text
          AND follow.status IN ('queued', 'in_progress')
      )
  `);

  for (const expTask of result.rows) {
    const findings = expTask.payload?.findings || expTask.payload?.result || '';

    const task = await createDecompositionTask({
      title: `探索续拆: ${expTask.title}`,
      description: [
        `探索型任务「${expTask.title}」已完成，建议继续拆解。`,
        '',
        '背景：',
        `原始探索结果：${typeof findings === 'string' ? findings : JSON.stringify(findings)}`,
        '',
        '要求：',
        '1. 基于探索结果，创建具体的 dev Tasks',
        '2. 调用 Brain API 创建 Task:',
        '   POST http://localhost:5221/api/brain/action/create-task',
        `   Body: { "title": "...", "project_id": "${expTask.project_id}", "goal_id": "${expTask.goal_id}", "task_type": "dev" }`,
        '',
        `探索任务 ID: ${expTask.id}`,
        `Project ID: ${expTask.project_id}`,
        `Goal ID: ${expTask.goal_id}`,
      ].join('\n'),
      goalId: expTask.goal_id,
      projectId: expTask.project_id,
      payload: {
        level: 'exploratory_continue',
        exploratory_source: expTask.id
      }
    });

    console.log(`[decomp-checker] Created exploratory continue: ${expTask.title}`);
    actions.push({
      action: 'create_decomposition',
      check: 'exploratory_continue',
      task_id: task.id,
      source_task_id: expTask.id,
      title: expTask.title
    });
  }

  return actions;
}

// ───────────────────────────────────────────────────────────────────
// Main entry point
// ───────────────────────────────────────────────────────────────────

/**
 * Run all 7 decomposition checks.
 * Called by tick.js to detect and fill gaps in the OKR hierarchy.
 *
 * @returns {Object} Summary of all actions taken
 */
async function runDecompositionChecks() {
  const allActions = [];
  const summary = {};

  const checks = [
    { name: 'global_okr', fn: checkGlobalOkrDecomposition },
    { name: 'global_kr', fn: checkGlobalKrDecomposition },
    { name: 'area_okr', fn: checkAreaOkrDecomposition },
    { name: 'area_kr_project', fn: checkAreaKrProjectLink },
    { name: 'project', fn: checkProjectDecomposition },
    { name: 'initiative', fn: checkInitiativeDecomposition },
    { name: 'exploratory', fn: checkExploratoryDecompositionContinue },
  ];

  for (const check of checks) {
    try {
      const actions = await check.fn();
      allActions.push(...actions);
      summary[check.name] = {
        created: actions.filter(a => a.action === 'create_decomposition').length,
        skipped: actions.filter(a => a.action === 'skip_dedup').length,
      };
    } catch (err) {
      console.error(`[decomp-checker] Check ${check.name} failed:`, err.message);
      summary[check.name] = { error: err.message };
    }
  }

  const totalCreated = allActions.filter(a => a.action === 'create_decomposition').length;
  if (totalCreated > 0) {
    console.log(`[decomp-checker] Created ${totalCreated} decomposition tasks`);
  }

  // Extract layers that were triggered (created at least one task)
  const layersTriggered = checks
    .filter(c => summary[c.name]?.created > 0)
    .map(c => c.name);

  // Extract created task IDs
  const createdTasks = allActions
    .filter(a => a.action === 'create_decomposition')
    .map(a => ({ id: a.task_id, check: a.check }));

  return {
    actions: allActions,
    summary,
    total_created: totalCreated,
    total_skipped: allActions.filter(a => a.action === 'skip_dedup').length,
    layers_triggered: layersTriggered,
    created_tasks: createdTasks,
  };
}

export {
  runDecompositionChecks,
  checkGlobalOkrDecomposition,
  checkGlobalKrDecomposition,
  checkAreaOkrDecomposition,
  checkAreaKrProjectLink,
  checkProjectDecomposition,
  checkInitiativeDecomposition,
  checkExploratoryDecompositionContinue,
  // Exported for testing
  hasExistingDecompositionTask,
  createDecompositionTask,
  DEDUP_WINDOW_HOURS,
};
