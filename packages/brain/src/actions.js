import { COMPANY_KR_SQL_GUARD, isCompanyKr } from './lib/company-kr-metrics.js';
import {createTask} from './lib/task-create.js';
import pool from './db.js';
import { broadcastTaskState } from './task-updater.js';
import { afterTerminalTransition, isTerminalStatus } from './lib/task-terminal.js';
import { assertAuthoringCompletion } from './workflow-authoring/task-guard.js';
import { detectDomain } from './domain-detector.js';
import { getDomainRole } from './role-registry.js';

const N8N_API_URL = process.env.N8N_API_URL || 'http://localhost:5679';
const N8N_API_KEY = process.env.N8N_API_KEY || '';


/**
 * 已退役（决策 ee4842a6/3feeae3e，接力棒链 2afa6d69 棒4）：Initiative 层随
 * okr_initiatives 一起冻结，不再写入任何表。GTD 模型下"1-2 小时功能模块"直接
 * 建 tasks 行挂 project_id，不再经过 Initiative 这层。
 * 保留函数签名与调用方（routes/actions.js /action/create-initiative）兼容，
 * 恒返回 layer_retired，不查询数据库。
 * @param {Object} params
 * @param {string} params.name
 * @param {string} params.parent_id
 * @returns {Promise<{ success: false, error: string, decision: string, message: string }>}
 */
async function createInitiative({ name, parent_id } = {}) {
  if (!name || !parent_id) {
    return { success: false, error: 'name and parent_id are required' };
  }
  return {
    success: false,
    error: 'layer_retired',
    decision: 'ee4842a6',
    message: 'Initiative 层已退役，GTD 模型下请直接创建 task 并挂 project_id',
  };
}

/**
 * 已退役（决策 ee4842a6/3feeae3e，接力棒链 2afa6d69 棒4）：Scope 层随
 * okr_scopes 一起冻结，不再写入任何表。
 * 保留函数签名与调用方（routes/actions.js /action/create-scope）兼容，
 * 恒返回 layer_retired，不查询数据库。
 * @param {Object} params
 * @param {string} params.name
 * @param {string} params.parent_id
 * @returns {Promise<{ success: false, error: string, decision: string, message: string }>}
 */
async function createScope({ name, parent_id } = {}) {
  if (!name || !parent_id) {
    return { success: false, error: 'name and parent_id are required' };
  }
  return {
    success: false,
    error: 'layer_retired',
    decision: 'ee4842a6',
    message: 'Scope 层已退役，GTD 模型下请直接创建 task 并挂 project_id',
  };
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

  // 棒4（决策 ee4842a6/3feeae3e）：Project 创建真身表已改指 projects（与棒1
  // /api/brain/projects、/api/brain/okr/projects 同一张表）；okr_projects 停写
  // （migration 499 写保护），repo_path 落真身表自己的列，不再塞进 metadata。
  const primaryRepo = repo_path || (repo_paths?.[0]) || null;
  const result = await pool.query(`
    INSERT INTO projects (name, description, status, owner_role, repo_path, metadata)
    VALUES ($1, $2, 'active', $3, $4, $5)
    RETURNING *
  `, [
    name,
    description || '',
    owner_role,
    primaryRepo,
    JSON.stringify({ domain }),
  ]);

  const projectRow = result.rows[0];
  const project = { ...projectRow, repo_path: projectRow.repo_path || null };

  // Link to first KR if provided
  if (Array.isArray(kr_ids) && kr_ids.length > 0) {
    await pool.query(
      'UPDATE projects SET kr_id = $1 WHERE id = $2',
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
  await assertAuthoringCompletion(pool, status, 'id = $1', [task_id]);
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
    } else if (status === 'queued') {
      // Clear claim so the task can be re-selected by selectNextDispatchableTask
      updates.push(`claimed_by = NULL`);
      updates.push(`claimed_at = NULL`);
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
  // Atomic guards:
  // - in_progress: only from queued (prevents double-dispatch race)
  // - queued: never from terminal states (completed/cancelled) — monitor/retry
  //   callers must not resurrect finished tasks (issue 219a9efc oscillation);
  //   explicit manual psql bypasses this by design
  let whereClause = `id = $${idx}`;
  if (status === 'in_progress') {
    whereClause += ` AND status = 'queued'`;
  } else if (status === 'queued') {
    whereClause += ` AND status NOT IN ('completed', 'cancelled')`;
  }
  const result = await pool.query(`
    UPDATE tasks SET ${updates.join(', ')}
    WHERE ${whereClause}
    RETURNING *
  `, values);

  if (result.rows.length === 0) {
    const error = status === 'in_progress'
      ? 'Task not found or already dispatched'
      : (status === 'queued'
          ? 'Task not found or in terminal state (completed/cancelled cannot be requeued)'
          : 'Task not found');
    return { success: false, error };
  }

  const task = result.rows[0];
  console.log(`[Action] Updated task: ${task_id}`);

  // 终态收口（lib/task-terminal.js）：update_task 动作写成终态后必经钩子（completed / completed_no_pr 接棒）
  if (status && isTerminalStatus(status)) {
    await afterTerminalTransition(pool, task_id, status);
  }

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
  const _statusUpdates = updates.filter(u => !u.startsWith('progress'));
  const _statusValues = values.filter((_, i) => {
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
  if (progress !== undefined) {
    const identity = await pool.query('SELECT metadata,custom_props FROM key_results WHERE id=$1', [goal_id]);
    if (isCompanyKr(identity.rows[0])) return { success: false, error: '公司KR progress须由原指标公式计算' };
  }
  const krUpdates = [];
  const krValues = [];
  let krIdx = 1;
  if (status) { krUpdates.push(`status = $${krIdx++}`); krValues.push(status); }
  if (progress !== undefined) { krUpdates.push(`progress = $${krIdx++}`); krValues.push(progress); }
  krUpdates.push(`updated_at = NOW()`);
  krValues.push(goal_id);
  const krResult = await pool.query(
    `UPDATE key_results SET ${krUpdates.join(', ')} WHERE id = $${krIdx} ${progress !== undefined ? `AND ${COMPANY_KR_SQL_GUARD}` : ''} RETURNING *, title AS name`,
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

  await assertAuthoringCompletion(pool, update.status, whereClause, values);

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

  // 终态收口（lib/task-terminal.js）：批量写成终态的每一行都必经钩子
  if (update.status && isTerminalStatus(update.status)) {
    for (const row of result.rows ?? []) {
      await afterTerminalTransition(pool, row.id, update.status);
    }
  }

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
