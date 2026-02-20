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
// Execution Frontier Model - Inventory Management
// ───────────────────────────────────────────────────────────────────

/**
 * Inventory configuration for task stock management
 * Instead of decomposing everything upfront, we maintain a "ready tasks inventory"
 * and replenish it when running low (like warehouse restocking).
 */
const INVENTORY_CONFIG = {
  // Target number of ready tasks per initiative
  TARGET_READY_TASKS: 5,

  // Low watermark - trigger replenishment when below this
  LOW_WATERMARK: 2,

  // Batch size for each decomposition (replenishment amount)
  BATCH_SIZE: 3,

  // Maximum active execution paths to check
  MAX_ACTIVE_PATHS: 10,

  // Time window for "active" definition (24 hours)
  ACTIVE_WINDOW_HOURS: 24,
};

/**
 * Global WIP limits for decomposition tasks
 */
const WIP_LIMITS = {
  // Maximum concurrent decomposition tasks (across all levels)
  MAX_DECOMP_IN_FLIGHT: 3,
};

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
        status IN ('queued', 'in_progress', 'canceled', 'cancelled')
        OR (status = 'completed' AND completed_at > NOW() - INTERVAL '${DEDUP_WINDOW_HOURS} hours')
        OR (status = 'failed' AND created_at > NOW() - INTERVAL '${DEDUP_WINDOW_HOURS} hours')
      )
    LIMIT 1
  `, [goalId]);
  return result.rows.length > 0;
}

/**
 * Check if a decomposition task already exists for the given project_id and level.
 * Matches queued/in_progress, completed within DEDUP_WINDOW_HOURS, or failed within DEDUP_WINDOW_HOURS.
 *
 * @param {string} projectId - Project UUID to check
 * @param {string} level - Decomposition level ('project' or 'initiative')
 * @returns {boolean} true if a decomposition task already exists
 */
async function hasExistingDecompositionTaskByProject(projectId, level) {
  const result = await pool.query(`
    SELECT id FROM tasks
    WHERE project_id = $1
      AND (payload->>'decomposition' IN ('true', 'continue') OR title LIKE '%拆解%')
      AND (payload->>'level' = $2)
      AND (
        status IN ('queued', 'in_progress', 'canceled', 'cancelled')
        OR (status = 'completed' AND completed_at > NOW() - INTERVAL '${DEDUP_WINDOW_HOURS} hours')
        OR (status = 'failed' AND created_at > NOW() - INTERVAL '${DEDUP_WINDOW_HOURS} hours')
      )
    LIMIT 1
  `, [projectId, level]);
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
  if (!goalId) {
    throw new Error(`[decomp-checker] Refusing to create task without goalId: "${title}"`);
  }
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
// Execution Frontier - Active Paths & Inventory Management
// ───────────────────────────────────────────────────────────────────

/**
 * Get active execution paths (Initiatives with recent activity).
 * Only these paths will be checked for inventory replenishment.
 *
 * @returns {Array} Array of active initiatives
 */
async function getActiveExecutionPaths() {
  // Fixed SQL: removed DISTINCT, added GROUP BY for MAX aggregation
  // PostgreSQL requires ORDER BY expressions to appear in SELECT list when using DISTINCT
  const result = await pool.query(`
    SELECT p.id, p.name, pkl.kr_id, MAX(t.updated_at) as last_activity
    FROM projects p
    INNER JOIN tasks t ON t.project_id = p.id
    LEFT JOIN project_kr_links pkl ON pkl.project_id = p.parent_id
    WHERE p.type = 'initiative'
      AND p.status = 'active'
      AND t.updated_at > NOW() - INTERVAL '${INVENTORY_CONFIG.ACTIVE_WINDOW_HOURS} hours'
      AND t.status IN ('in_progress', 'completed', 'queued')
    GROUP BY p.id, p.name, pkl.kr_id
    ORDER BY last_activity DESC
    LIMIT ${INVENTORY_CONFIG.MAX_ACTIVE_PATHS}
  `);

  return result.rows;
}

/**
 * Check if we can create a new decomposition task (WIP limit check).
 *
 * @returns {boolean} true if we can create more decomposition tasks
 */
async function canCreateDecompositionTask() {
  const result = await pool.query(`
    SELECT COUNT(*) as count FROM tasks
    WHERE (payload->>'decomposition' IN ('true', 'continue') OR title LIKE '%拆解%')
      AND status IN ('queued', 'in_progress')
  `);

  const count = parseInt(result.rows[0].count, 10);
  return count < WIP_LIMITS.MAX_DECOMP_IN_FLIGHT;
}

/**
 * Ensure task inventory for an initiative (replenish if running low).
 * This is the core of the "execution frontier" model - we only decompose
 * when we're about to run out of tasks to execute.
 *
 * @param {Object} initiative - Initiative to check inventory for
 * @returns {Object|null} Created decomposition task or null
 */
async function ensureTaskInventory(initiative) {
  // Fix: null kr_id → graceful skip（无法创建有效 goal 关联的 task）
  if (!initiative.kr_id) {
    console.warn(`[decomp-checker] Initiative ${initiative.id} (${initiative.name}) has no kr_id, skipping inventory check`);
    return null;
  }

  // KR saturation check - skip if KR already has >= 3 active tasks
  if (initiative.kr_id) {
    const satCheck = await pool.query(
      "SELECT COUNT(*) FROM tasks WHERE goal_id = $1 AND status IN ('queued','in_progress')",
      [initiative.kr_id]
    );
    if (parseInt(satCheck.rows[0].count) >= 3) {
      console.log(`[decomp-checker] KR ${initiative.kr_id} already has ${satCheck.rows[0].count} active tasks, skipping`);
      return null;
    }
  }

  // 1. Count current ready tasks
  const readyTasksResult = await pool.query(`
    SELECT COUNT(*) as count FROM tasks
    WHERE project_id = $1
      AND status = 'queued'
  `, [initiative.id]);

  const readyTasks = parseInt(readyTasksResult.rows[0].count, 10);

  // 2. Check if above low watermark
  if (readyTasks >= INVENTORY_CONFIG.LOW_WATERMARK) {
    return null;  // Inventory sufficient
  }

  // 3. Check if replenishment already in progress
  if (await hasExistingDecompositionTaskByProject(initiative.id, 'initiative')) {
    return null;  // Replenishment task already exists
  }

  // 4. Check global WIP limit
  if (!(await canCreateDecompositionTask())) {
    console.log(`[decomp] WIP limit reached, skipping inventory replenishment for ${initiative.name}`);
    return null;
  }

  // 5. Create replenishment task (small batch)
  const task = await createDecompositionTask({
    title: `Initiative 库存补货: ${initiative.name}`,
    description: [
      `请为 Initiative「${initiative.name}」补充任务库存。`,
      '',
      `当前库存：${readyTasks} 个 tasks`,
      `目标库存：${INVENTORY_CONFIG.TARGET_READY_TASKS} 个 tasks`,
      `本次补货：生成 ${INVENTORY_CONFIG.BATCH_SIZE} 个新 tasks`,
      '',
      '要求：',
      `1. 分析 Initiative 范围，创建 ${INVENTORY_CONFIG.BATCH_SIZE} 个具体的 Tasks`,
      '2. 每个 Task 约 20 分钟可完成',
      '3. 为每个 Task 写完整 PRD',
      '4. 调用 Brain API 创建 Task:',
      '   POST http://localhost:5221/api/brain/action/create-task',
      `   Body: { "title": "...", "project_id": "${initiative.id}", "goal_id": "${initiative.kr_id || ''}", "task_type": "dev", "prd_content": "..." }`,
      '',
      `Initiative ID: ${initiative.id}`,
      `Initiative 名称: ${initiative.name}`,
    ].join('\n'),
    goalId: initiative.kr_id,
    projectId: initiative.id,
    payload: {
      level: 'initiative',
      initiative_id: initiative.id,
      inventory_replenishment: true,
      batch_size: INVENTORY_CONFIG.BATCH_SIZE,
    }
  });

  console.log(`[decomp] Created inventory replenishment task for ${initiative.name}`);
  return task;
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
    // Dedup using shared function
    if (await hasExistingDecompositionTaskByProject(proj.id, 'project')) {
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
          -- Note: 'canceled' (US) is intentionally NOT excluded here — it acts as
          -- a guard preventing automatic re-decomposition when tasks are abandoned.
          -- Adding 'canceled' to this list would cause re-decomposition loops.
      )
  `);

  for (const init of result.rows) {
    // Dedup using shared function
    if (await hasExistingDecompositionTaskByProject(init.id, 'initiative')) {
      actions.push({
        action: 'skip_dedup',
        check: 'initiative_decomposition',
        initiative_id: init.id,
        name: init.name
      });
      continue;
    }

    // Get linked KR for this initiative — 4-layer fallback chain
    let krId = null;
    // Layer 1: project_kr_links on parent project (original behavior)
    if (init.parent_id) {
      const krResult = await pool.query(
        `SELECT pkl.kr_id FROM project_kr_links pkl WHERE pkl.project_id = $1 LIMIT 1`,
        [init.parent_id]
      );
      krId = krResult.rows[0]?.kr_id || null;
    }
    // Layer 2: initiative's own kr_id field
    if (!krId) {
      const selfResult = await pool.query(
        `SELECT kr_id FROM projects WHERE id = $1 AND kr_id IS NOT NULL LIMIT 1`,
        [init.id]
      );
      krId = selfResult.rows[0]?.kr_id || null;
    }
    // Layer 3: parent project's kr_id field
    if (!krId && init.parent_id) {
      const parentResult = await pool.query(
        `SELECT kr_id FROM projects WHERE id = $1 AND kr_id IS NOT NULL LIMIT 1`,
        [init.parent_id]
      );
      krId = parentResult.rows[0]?.kr_id || null;
    }
    // Layer 4: project_kr_links on initiative itself
    if (!krId) {
      const selfLinkResult = await pool.query(
        `SELECT kr_id FROM project_kr_links WHERE project_id = $1 LIMIT 1`,
        [init.id]
      );
      krId = selfLinkResult.rows[0]?.kr_id || null;
    }
    // No KR found — skip to avoid accumulating NULL-goal_id tasks
    if (!krId) {
      console.log(`[decomp-checker] Check 6: Skip "${init.name}" — no KR linkage found`);
      continue;
    }

    // KR saturation check - skip if KR already has >= 3 active tasks
    const satCheck = await pool.query(
      "SELECT COUNT(*) FROM tasks WHERE goal_id = $1 AND status IN ('queued','in_progress')",
      [krId]
    );
    if (parseInt(satCheck.rows[0].count) >= 3) {
      console.log(`[decomp-checker] Check 6: KR ${krId} already has ${satCheck.rows[0].count} active tasks, skipping "${init.name}"`);
      actions.push({ action: 'skip_saturated', check: 'initiative_decomposition', initiative_id: init.id, name: init.name, kr_id: krId });
      continue;
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
          AND follow.status IN ('queued', 'in_progress', 'completed', 'canceled', 'cancelled')
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
        decomposition: 'continue',  // override 'true' default so NOT EXISTS dedup check matches
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
 * Run decomposition checks using Execution Frontier Model.
 * Instead of scanning all gaps, we only check active execution paths
 * and replenish task inventory when running low.
 *
 * @returns {Object} Summary of actions taken
 */
async function runDecompositionChecks() {
  const allActions = [];

  try {
    // Manual mode check - skip all auto-creation if enabled
    const manualModeResult = await pool.query(
      "SELECT value_json FROM working_memory WHERE key = 'manual_mode'"
    );
    if (manualModeResult.rows.length > 0 && manualModeResult.rows[0].value_json?.enabled === true) {
      console.log('[decomp-checker] Manual mode enabled, skipping auto task creation');
      return { skipped: true, reason: 'manual_mode', actions: [], summary: { manual_mode: true }, total_created: 0, total_skipped: 0, active_paths: [], created_tasks: [] };
    }

    // 1. Get active execution paths (initiatives with recent activity)
    const activePaths = await getActiveExecutionPaths();

    console.log(`[decomp-checker] Found ${activePaths.length} active execution paths`);

    // 2. Check inventory for each active path
    for (const path of activePaths) {
      try {
        const task = await ensureTaskInventory(path);

        if (task) {
          allActions.push({
            action: 'create_decomposition',
            check: 'inventory_replenishment',
            task_id: task.id,
            initiative_id: path.id,
            initiative_name: path.name,
          });
        } else {
          allActions.push({
            action: 'skip_inventory',
            check: 'inventory_replenishment',
            initiative_id: path.id,
            initiative_name: path.name,
            reason: 'inventory_sufficient_or_wip_limit',
          });
        }
      } catch (err) {
        console.error(`[decomp-checker] Inventory check failed for ${path.name}:`, err.message);
        allActions.push({
          action: 'error',
          check: 'inventory_replenishment',
          initiative_id: path.id,
          initiative_name: path.name,
          error: err.message,
        });
      }
    }

    // 3. Check 6: Seed empty initiatives (run independently of execution paths)
    // Finds active initiatives with no tasks and creates decomposition seed tasks
    try {
      const initiativeActions = await checkInitiativeDecomposition();
      allActions.push(...initiativeActions);
      const initiativeSeeded = initiativeActions.filter(a => a.action === 'create_decomposition').length;
      if (initiativeSeeded > 0) {
        console.log(`[decomp-checker] Check 6: Seeded ${initiativeSeeded} empty initiative(s)`);
      }
    } catch (err) {
      console.error('[decomp-checker] Check 6 (initiative decomposition) failed:', err.message);
    }

    // 4. Check 7: Exploratory continuation (run independently of execution paths)
    try {
      const exploratoryActions = await checkExploratoryDecompositionContinue();
      allActions.push(...exploratoryActions);
    } catch (err) {
      console.error('[decomp-checker] Check 7 (exploratory continuation) failed:', err.message);
    }

    // 5. Summary
    const totalCreated = allActions.filter(a => a.action === 'create_decomposition').length;
    const totalSkipped = allActions.filter(a => a.action === 'skip_inventory').length;

    if (totalCreated > 0) {
      console.log(`[decomp-checker] Created ${totalCreated} inventory replenishment tasks`);
    }

    return {
      actions: allActions,
      summary: {
        active_paths: activePaths.length,
        created: totalCreated,
        skipped: totalSkipped,
        errors: allActions.filter(a => a.action === 'error').length,
      },
      total_created: totalCreated,
      total_skipped: totalSkipped,
      active_paths: activePaths.map(p => ({ id: p.id, name: p.name })),
      created_tasks: allActions
        .filter(a => a.action === 'create_decomposition')
        .map(a => ({ id: a.task_id, initiative: a.initiative_name })),
    };
  } catch (err) {
    console.error('[decomp-checker] Execution frontier check failed:', err.message);
    return {
      actions: [],
      summary: { error: err.message },
      total_created: 0,
      total_skipped: 0,
      active_paths: [],
      created_tasks: [],
    };
  }
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
  // Execution Frontier functions
  getActiveExecutionPaths,
  ensureTaskInventory,
  canCreateDecompositionTask,
  // Exported for testing
  hasExistingDecompositionTask,
  hasExistingDecompositionTaskByProject,
  createDecompositionTask,
  DEDUP_WINDOW_HOURS,
  INVENTORY_CONFIG,
  WIP_LIMITS,
};
