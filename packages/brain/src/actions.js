/* global console */
import pool from './db.js';
import { broadcastTaskState } from './task-updater.js';
import { detectDomain } from './domain-detector.js';
import { getDomainRole } from './role-registry.js';

const N8N_API_URL = process.env.N8N_API_URL || 'http://localhost:5679';
const N8N_API_KEY = process.env.N8N_API_KEY || '';

/**
 * Check if a task type is a system/internal task that doesn't require goal_id
 * @param {string} task_type - Task type
 * @param {string} trigger_source - Trigger source
 * @returns {boolean} - True if system task
 */
function isSystemTask(task_type, trigger_source) {
  // System task types that don't need goal association
  const systemTypes = ['research', 'intent_expand'];

  // System trigger sources that don't need goal association
  const systemSources = ['manual', 'test', 'watchdog', 'circuit_breaker', 'cortex', 'self_drive', 'auto_fix'];

  return systemTypes.includes(task_type) || systemSources.includes(trigger_source);
}

/**
 * Build the 11-element common parameter array for task INSERT.
 * Centralises all default-value logic so createTask stays lean.
 */
function buildCommonParams({ title, description, context, priority, project_id, goal_id, tags, task_type, prd_content, execution_profile, payload, trigger_source }) {
  return [
    title,
    description || context || '',
    priority || 'P1',
    project_id || null,
    goal_id || null,
    tags || [],
    task_type || 'dev',
    prd_content || null,
    execution_profile || null,
    payload ? JSON.stringify(payload) : null,
    trigger_source || 'brain_auto',
  ];
}

/**
 * Build the INSERT SQL and bound parameters.
 * Two variants: explicit domain (includes owner_role) vs auto-detected domain.
 */
function buildInsertStatement(commonParams, { domainInput, ownerRoleInput, deliveryType, title, description, context }) {
  const deliveryTypeValue = deliveryType || 'code-only';
  if (domainInput !== undefined) {
    // Explicit domain: include owner_role ($13) + delivery_type ($14)
    const owner_role = ownerRoleInput ?? getDomainRole(domainInput);
    return {
      sql: `
        INSERT INTO tasks (title, description, priority, project_id, goal_id, tags, task_type, status, prd_content, execution_profile, payload, trigger_source, domain, owner_role, delivery_type)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT DO NOTHING
        RETURNING *
      `,
      params: [...commonParams, domainInput, owner_role, deliveryTypeValue],
    };
  }
  // Auto-detect domain from title + description; omit owner_role column
  const detected = detectDomain(`${title} ${description || context || ''}`);
  return {
    sql: `
      INSERT INTO tasks (title, description, priority, project_id, goal_id, tags, task_type, status, prd_content, execution_profile, payload, trigger_source, domain, delivery_type)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', $8, $9, $10, $11, $12, $13)
      ON CONFLICT DO NOTHING
      RETURNING *
    `,
    params: [...commonParams, detected.confidence > 0 ? detected.domain : null, deliveryTypeValue],
  };
}

/**
 * Create a new task
 * @param {Object} params
 * @param {string} params.title - Task title
 * @param {string} params.description - Task description
 * @param {string} params.priority - P0/P1/P2
 * @param {string} params.project_id - Feature ID (not Project!)
 * @param {string} params.goal_id - KR ID (required for most tasks)
 * @param {string[]} params.tags - Tags
 * @param {string} params.task_type - dev/talk/review
 * @param {string} params.context - Legacy description field
 * @param {string} params.prd_content - PRD content (秋米写的)
 * @param {string} params.execution_profile - US_CLAUDE_OPUS/US_CLAUDE_SONNET/etc
 * @param {Object} params.payload - Additional payload (initiative_id, kr_goal)
 * @param {string} params.domain - Business domain (coding/quality/agent_ops/...)
 * @param {string} params.owner_role - Role owning this task (auto-inferred from domain if omitted)
 */
async function createTask({ title, description, priority, project_id, goal_id, tags, task_type, context, prd_content, execution_profile, payload, trigger_source, domain: domainInput, owner_role: ownerRoleInput, delivery_type }) {
  // Validate goal_id (required for most tasks except system tasks)
  if (!goal_id && !isSystemTask(task_type, trigger_source)) {
    const error = `goal_id is required for task_type="${task_type}" trigger_source="${trigger_source}"`;
    console.error(`[Action] Validation failed: ${error}`);
    throw new Error(error);
  }

  // Dedup: skip if queued/in_progress, or completed within 24 h
  const dedupResult = await pool.query(`
    SELECT * FROM tasks
    WHERE title = $1
      AND (goal_id IS NOT DISTINCT FROM $2)
      AND (project_id IS NOT DISTINCT FROM $3)
      AND (status IN ('queued', 'in_progress') OR (status = 'completed' AND completed_at > NOW() - INTERVAL '24 hours'))
    LIMIT 1
  `, [title, goal_id || null, project_id || null]);

  if (dedupResult.rows.length > 0) {
    const existing = dedupResult.rows[0];
    console.log(`[Action] Dedup: task "${title}" already exists (id: ${existing.id}, status: ${existing.status})`);
    return { success: true, task: existing, deduplicated: true };
  }

  const commonParams = buildCommonParams({ title, description, context, priority, project_id, goal_id, tags, task_type, prd_content, execution_profile, payload, trigger_source });
  const { sql, params } = buildInsertStatement(commonParams, { domainInput, ownerRoleInput, deliveryType: delivery_type, title, description, context });

  const result = await pool.query(sql, params);

  // ON CONFLICT DO NOTHING returns 0 rows on race-condition duplicate
  if (result.rows.length === 0) {
    const raceResult = await pool.query(`
      SELECT * FROM tasks
      WHERE title = $1
        AND (goal_id IS NOT DISTINCT FROM $2)
        AND (project_id IS NOT DISTINCT FROM $3)
        AND status IN ('queued', 'in_progress')
      LIMIT 1
    `, [title, goal_id || null, project_id || null]);
    if (raceResult.rows.length > 0) {
      console.log(`[Action] Dedup (race): task "${title}" already exists (id: ${raceResult.rows[0].id})`);
      return { success: true, task: raceResult.rows[0], deduplicated: true };
    }
  }

  const task = result.rows[0];
  console.log(`[Action] Created task: ${task.id} - ${title} (type: ${task_type || 'dev'})`);

  // Broadcast task creation to WebSocket clients
  await broadcastTaskState(task.id);

  return { success: true, task };
}

/**
 * Create a new Initiative (写入 projects 表, type='initiative')
 * Initiative = 1-2 小时的功能模块，挂在 Project 下面
 * @param {Object} params
 * @param {string} params.name - Initiative name
 * @param {string} params.parent_id - Project ID (type='project' 的那个)
 * @param {string} params.kr_id - 关联的 KR ID
 * @param {string} params.decomposition_mode - 'known'
 * @param {string} params.description - Initiative description
 * @param {string} params.plan_content - Plan document content
 * @param {string} params.domain - Business domain (coding/quality/agent_ops/...)
 * @param {string} params.owner_role - Role owning this initiative (auto-inferred from domain if omitted)
 */
async function createInitiative({ name, parent_id, kr_id, decomposition_mode, description, plan_content, execution_mode, dod_content, domain, owner_role }) {
  if (!name || !parent_id) {
    return { success: false, error: 'name and parent_id are required' };
  }

  const isOrchestrated = execution_mode === 'orchestrated';

  const resolvedOwnerRole = domain
    ? (owner_role || getDomainRole(domain))
    : (owner_role || null);

  const result = await pool.query(`
    INSERT INTO okr_initiatives (title, scope_id, description, status, owner_role, metadata)
    VALUES ($1, $2, $3, 'active', $4, $5)
    RETURNING *, title AS name
  `, [
    name,
    parent_id,
    description || '',
    resolvedOwnerRole,
    JSON.stringify({
      kr_id: kr_id || null,
      decomposition_mode: decomposition_mode || 'known',
      plan_content: plan_content || null,
      execution_mode: execution_mode || 'cecelia',
      current_phase: isOrchestrated ? 'plan' : null,
      dod_content: dod_content ? JSON.stringify(dod_content) : null,
      domain: domain || null,
    }),
  ]);

  const initiativeRow = result.rows[0];
  const meta = typeof initiativeRow.metadata === 'string'
    ? JSON.parse(initiativeRow.metadata)
    : (initiativeRow.metadata || {});
  const initiative = { ...initiativeRow, ...meta };
  // dod_content stored as JSON string in metadata; parse back to object
  if (typeof initiative.dod_content === 'string') {
    try { initiative.dod_content = JSON.parse(initiative.dod_content); } catch (_) { /* leave as string */ }
  }
  const modeLabel = isOrchestrated ? 'orchestrated' : (decomposition_mode || 'known');
  console.log(`[Action] Created initiative: ${initiative.id} - ${name} (mode: ${modeLabel})`);

  return { success: true, initiative };
}

/**
 * Create a new Scope (写入 projects 表, type='scope')
 * Scope = 2-3 天的功能边界分组，挂在 Project 下面
 * 行业术语来自 Shape Up 方法论，作为 Project→Initiative 之间的中间层
 * @param {Object} params
 * @param {string} params.name - Scope name
 * @param {string} params.parent_id - Project ID (type='project' 的那个)
 * @param {string} params.description - Scope description
 * @param {string} params.domain - Business domain
 * @param {string} params.owner_role - Role owning this scope
 */
async function createScope({ name, parent_id, description, domain: domainInput, owner_role: ownerRoleInput }) {
  if (!name || !parent_id) {
    return { success: false, error: 'name and parent_id are required' };
  }

  const detected = detectDomain(`${name} ${description || ''}`);
  const domain = domainInput ?? detected.domain;
  const owner_role = ownerRoleInput ?? detected.owner_role;

  const result = await pool.query(`
    INSERT INTO okr_scopes (title, project_id, description, status, owner_role, metadata)
    VALUES ($1, $2, $3, 'active', $4, $5)
    RETURNING *, title AS name
  `, [
    name,
    parent_id,
    description || '',
    owner_role,
    JSON.stringify({ decomposition_depth: 1, domain }),
  ]);

  const scopeRow = result.rows[0];
  const scopeMeta = typeof scopeRow.metadata === 'string'
    ? JSON.parse(scopeRow.metadata)
    : (scopeRow.metadata || {});
  const scope = { ...scopeRow, ...scopeMeta };
  console.log(`[Action] Created scope: ${scope.id} - ${name} (parent: ${parent_id})`);
  return { success: true, scope };
}

/**
 * Create a new Project (写入 projects 表, type='project')
 * Project = 1-2 周的项目，可以跨多个 Repository
 * @param {Object} params
 * @param {string} params.name - Project name
 * @param {string} params.description - Project description
 * @param {string} params.repo_path - Primary repository path (optional, use project_repos for multi-repo)
 * @param {string[]} params.repo_paths - Multiple repository paths
 * @param {string[]} params.kr_ids - Associated KR IDs
 */
async function createProject({ name, description, repo_path, repo_paths, kr_ids, domain: domainInput, owner_role: ownerRoleInput }) {
  if (!name) {
    return { success: false, error: 'name is required' };
  }

  // 未提供 domain/owner_role 时自动检测
  const detected = detectDomain(`${name} ${description || ''}`);
  const domain = domainInput ?? detected.domain;
  const owner_role = ownerRoleInput ?? detected.owner_role;

  const primaryRepo = repo_path || (repo_paths?.[0]) || null;
  const result = await pool.query(`
    INSERT INTO okr_projects (title, description, status, owner_role, metadata)
    VALUES ($1, $2, 'active', $3, $4)
    RETURNING *, title AS name
  `, [
    name,
    description || '',
    owner_role,
    JSON.stringify({ repo_path: primaryRepo, domain }),
  ]);

  const projectRow = result.rows[0];
  const projMeta = typeof projectRow.metadata === 'string'
    ? JSON.parse(projectRow.metadata)
    : (projectRow.metadata || {});
  const project = { ...projectRow, repo_path: projMeta.repo_path || null };

  // Link to first KR if provided (okr_projects has kr_id column)
  if (Array.isArray(kr_ids) && kr_ids.length > 0) {
    await pool.query(
      'UPDATE okr_projects SET kr_id = $1 WHERE id = $2',
      [kr_ids[0], project.id]
    );
    project.kr_id = kr_ids[0];
  }

  console.log(`[Action] Created project: ${project.id} - ${name}`);
  return { success: true, project };
}

/**
 * Update task status/priority
 */
async function updateTask({ task_id, status, priority }) {
  const updates = [];
  const values = [];
  let idx = 1;

  if (status) {
    updates.push(`status = $${idx++}`);
    values.push(status);

    // Update timestamps based on status
    if (status === 'in_progress') {
      updates.push(`started_at = NOW()`);
    } else if (status === 'completed') {
      updates.push(`completed_at = NOW()`);
    }
  }
  if (priority) {
    updates.push(`priority = $${idx++}`);
    values.push(priority);
  }

  if (updates.length === 0) {
    return { success: false, error: 'No updates provided' };
  }

  values.push(task_id);
  // Atomic guard: when transitioning to in_progress, only update if still queued
  // This prevents double-dispatch race conditions
  const whereClause = status === 'in_progress'
    ? `id = $${idx} AND status = 'queued'`
    : `id = $${idx}`;
  const result = await pool.query(`
    UPDATE tasks SET ${updates.join(', ')}
    WHERE ${whereClause}
    RETURNING *
  `, values);

  if (result.rows.length === 0) {
    return { success: false, error: status === 'in_progress' ? 'Task not found or already dispatched' : 'Task not found' };
  }

  const task = result.rows[0];
  console.log(`[Action] Updated task: ${task_id}`);

  // Broadcast task update to WebSocket clients
  await broadcastTaskState(task_id);

  return { success: true, task };
}

/**
 * Create a new goal
 * @param {string} params.domain - Business domain (coding/quality/agent_ops/...)
 * @param {string} params.owner_role - Role owning this goal (auto-inferred from domain if omitted)
 */
async function createGoal({ title, description, priority, project_id, target_date, parent_id, type, domain: domainInput, owner_role: ownerRoleInput }) {
  // Auto-determine type based on parent if not provided
  let goalType = type;
  if (!goalType && parent_id) {
    // 新 OKR 表：先查 key_results，再查 objectives，再查 visions（UUID 相同）
    const parentResult = await pool.query(`
      SELECT 'global_kr' AS type FROM key_results WHERE id = $1
      UNION ALL
      SELECT 'area_okr' AS type FROM objectives WHERE id = $1
      UNION ALL
      SELECT 'vision' AS type FROM visions WHERE id = $1
      LIMIT 1
    `, [parent_id]);
    if (parentResult.rows.length > 0) {
      const parentType = parentResult.rows[0].type;
      // Map parent type to child type
      if (parentType === 'mission') {
        goalType = 'global_kr';
      } else if (parentType === 'vision') {
        goalType = 'area_kr';
      } else if (parentType === 'global_kr') {
        goalType = 'area_okr';
      } else {
        goalType = 'area_okr'; // Default to area_okr for other cases
      }
    }
  } else if (!goalType) {
    // No parent and no type specified - assume it's a top-level mission
    goalType = 'mission';
  }

  // domain 明确传入时使用，否则从 title+description 自动检测
  let domain, owner_role;
  if (domainInput !== undefined) {
    domain = domainInput;
    owner_role = ownerRoleInput ?? getDomainRole(domain);
  } else {
    const detected = detectDomain(`${title} ${description || ''}`);
    if (detected.confidence > 0) {
      domain = detected.domain;
      owner_role = ownerRoleInput ?? detected.owner_role;
    } else {
      domain = null;
      owner_role = ownerRoleInput ?? null;
    }
  }

  let goalResult;
  const endDate = target_date || null;
  const metaJson = JSON.stringify({ type: goalType, project_id: project_id || null, domain });

  if (goalType === 'vision' || goalType === 'mission') {
    goalResult = await pool.query(`
      INSERT INTO visions (title, description, status, owner_role, end_date, metadata)
      VALUES ($1, $2, 'active', $3, $4, $5)
      RETURNING *, title AS name
    `, [title, description || '', owner_role, endDate, metaJson]);
  } else if (goalType === 'area_okr' || goalType === 'global_kr') {
    goalResult = await pool.query(`
      INSERT INTO objectives (title, description, priority, status, owner_role, vision_id, end_date, metadata)
      VALUES ($1, $2, $3, 'active', $4, $5, $6, $7)
      RETURNING *, title AS name
    `, [title, description || '', priority || 'P1', owner_role, parent_id || null, endDate, metaJson]);
  } else if (goalType === 'area_kr') {
    goalResult = await pool.query(`
      INSERT INTO key_results (title, description, priority, status, owner_role, objective_id, end_date, metadata)
      VALUES ($1, $2, $3, 'active', $4, $5, $6, $7)
      RETURNING *, title AS name
    `, [title, description || '', priority || 'P1', owner_role, parent_id || null, endDate, metaJson]);
  } else {
    throw new Error(`createGoal: unsupported goalType '${goalType}'`);
  }

  const goal = goalResult.rows[0];
  console.log(`[Action] Created goal: ${goal.id} - ${title} (type: ${goalType})`);
  return { success: true, goal };
}

/**
 * Update goal status/progress
 */
async function updateGoal({ goal_id, status, progress }) {
  const updates = [];
  const values = [];
  let idx = 1;

  if (status) {
    updates.push(`status = $${idx++}`);
    values.push(status);
  }
  if (progress !== undefined) {
    updates.push(`progress = $${idx++}`);
    values.push(progress);
  }

  if (updates.length === 0) {
    return { success: false, error: 'No updates provided' };
  }

  updates.push(`updated_at = NOW()`);

  // 1. Try objectives (status only — no progress column)
  const statusUpdates = updates.filter(u => !u.startsWith('progress'));
  const statusValues = values.filter((_, i) => {
    const uStr = updates[i];
    return !uStr || !uStr.startsWith('progress');
  });
  // Build status-only update for tables without progress
  const statusOnlyUpdates = [];
  const statusOnlyValues = [];
  let sIdx = 1;
  if (status) { statusOnlyUpdates.push(`status = $${sIdx++}`); statusOnlyValues.push(status); }
  statusOnlyUpdates.push(`updated_at = NOW()`);
  statusOnlyValues.push(goal_id);

  const objResult = await pool.query(
    `UPDATE objectives SET ${statusOnlyUpdates.join(', ')} WHERE id = $${sIdx} RETURNING *, title AS name`,
    statusOnlyValues
  );
  if (objResult.rows.length > 0) {
    console.log(`[Action] Updated goal (objectives): ${goal_id}`);
    return { success: true, goal: objResult.rows[0] };
  }

  // 2. Try key_results (has progress column)
  const krUpdates = [];
  const krValues = [];
  let krIdx = 1;
  if (status) { krUpdates.push(`status = $${krIdx++}`); krValues.push(status); }
  if (progress !== undefined) { krUpdates.push(`progress = $${krIdx++}`); krValues.push(progress); }
  krUpdates.push(`updated_at = NOW()`);
  krValues.push(goal_id);
  const krResult = await pool.query(
    `UPDATE key_results SET ${krUpdates.join(', ')} WHERE id = $${krIdx} RETURNING *, title AS name`,
    krValues
  );
  if (krResult.rows.length > 0) {
    console.log(`[Action] Updated goal (key_results): ${goal_id}`);
    return { success: true, goal: krResult.rows[0] };
  }

  // 3. Try visions (status only)
  const visResult = await pool.query(
    `UPDATE visions SET ${statusOnlyUpdates.join(', ')} WHERE id = $${sIdx} RETURNING *, title AS name`,
    statusOnlyValues
  );
  if (visResult.rows.length > 0) {
    console.log(`[Action] Updated goal (visions): ${goal_id}`);
    return { success: true, goal: visResult.rows[0] };
  }

  // 三新表均未找到，返回失败
  return { success: false, error: 'Goal not found' };
}

/**
 * Trigger n8n webhook
 */
async function triggerN8n({ webhook_path, data }) {
  try {
    const headers = {
      'Content-Type': 'application/json',
      ...(N8N_API_KEY ? { 'X-N8N-API-KEY': N8N_API_KEY } : {})
    };

    const url = webhook_path.startsWith('http')
      ? webhook_path
      : `${N8N_API_URL}/webhook/${webhook_path}`;

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(data || {})
    });

    const responseData = await response.text();
    console.log(`[Action] Triggered n8n webhook: ${webhook_path}`);

    return {
      success: response.ok,
      status: response.status,
      response: responseData
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Update working memory
 */
async function setMemory({ key, value }) {
  await pool.query(`
    INSERT INTO working_memory (key, value_json, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
  `, [key, value]);

  console.log(`[Action] Set memory: ${key}`);
  return { success: true, key, value };
}

/**
 * Batch update tasks (pause all, resume all, etc.)
 */
async function batchUpdateTasks({ filter, update }) {
  let whereClause = '1=1';
  const values = [];
  let idx = 1;

  // Build filter
  if (filter.status) {
    whereClause += ` AND status = $${idx++}`;
    values.push(filter.status);
  }
  if (filter.priority) {
    whereClause += ` AND priority = $${idx++}`;
    values.push(filter.priority);
  }
  if (filter.project_id) {
    whereClause += ` AND project_id = $${idx++}`;
    values.push(filter.project_id);
  }

  // Build update
  const updates = [];
  if (update.status) {
    updates.push(`status = $${idx++}`);
    values.push(update.status);
  }
  if (update.priority) {
    updates.push(`priority = $${idx++}`);
    values.push(update.priority);
  }

  if (updates.length === 0) {
    return { success: false, error: 'No updates provided' };
  }

  const result = await pool.query(`
    UPDATE tasks SET ${updates.join(', ')}
    WHERE ${whereClause}
    RETURNING id
  `, values);

  console.log(`[Action] Batch updated ${result.rowCount} tasks`);
  return { success: true, count: result.rowCount };
}

export {
  createTask,
  createInitiative,
  createScope,
  createProject,
  updateTask,
  createGoal,
  updateGoal,
  triggerN8n,
  setMemory,
  batchUpdateTasks
};
