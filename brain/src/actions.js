/* global console */
import pool from './db.js';
import { broadcastTaskState } from './task-updater.js';

const N8N_API_URL = process.env.N8N_API_URL || 'http://localhost:5679';
const N8N_API_KEY = process.env.N8N_API_KEY || '';

/**
 * Create a new task
 * @param {Object} params
 * @param {string} params.title - Task title
 * @param {string} params.description - Task description
 * @param {string} params.priority - P0/P1/P2
 * @param {string} params.project_id - Feature ID (not Project!)
 * @param {string} params.goal_id - KR ID
 * @param {string[]} params.tags - Tags
 * @param {string} params.task_type - dev/talk/review
 * @param {string} params.context - Legacy description field
 * @param {string} params.prd_content - PRD content (秋米写的)
 * @param {string} params.execution_profile - US_CLAUDE_OPUS/US_CLAUDE_SONNET/etc
 * @param {Object} params.payload - Additional payload (exploratory, feature_id, kr_goal)
 */
async function createTask({ title, description, priority, project_id, goal_id, tags, task_type, context, prd_content, execution_profile, payload, trigger_source }) {
  // Dedup: check for existing task with same title + goal_id + project_id
  // Skip if queued/in_progress, or completed within 24h
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

  const result = await pool.query(`
    INSERT INTO tasks (title, description, priority, project_id, goal_id, tags, task_type, status, prd_content, execution_profile, payload, trigger_source)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', $8, $9, $10, $11)
    RETURNING *
  `, [
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
    trigger_source || 'brain_auto'
  ]);

  const task = result.rows[0];
  const isExploratory = payload?.exploratory ? ' [exploratory]' : '';
  console.log(`[Action] Created task: ${task.id} - ${title} (type: ${task_type || 'dev'})${isExploratory}`);

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
 * @param {string} params.decomposition_mode - 'known' | 'exploratory'
 * @param {string} params.description - Initiative description
 * @param {string} params.plan_content - Plan document content
 */
async function createInitiative({ name, parent_id, kr_id, decomposition_mode, description, plan_content }) {
  if (!name || !parent_id) {
    return { success: false, error: 'name and parent_id are required' };
  }

  const result = await pool.query(`
    INSERT INTO projects (name, parent_id, kr_id, decomposition_mode, description, type, plan_content, status)
    VALUES ($1, $2, $3, $4, $5, 'initiative', $6, 'active')
    RETURNING *
  `, [
    name,
    parent_id,
    kr_id || null,
    decomposition_mode || 'known',
    description || '',
    plan_content || null
  ]);

  const initiative = result.rows[0];
  console.log(`[Action] Created initiative: ${initiative.id} - ${name} (mode: ${decomposition_mode || 'known'})`);

  return { success: true, initiative };
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
async function createProject({ name, description, repo_path, repo_paths, kr_ids }) {
  if (!name) {
    return { success: false, error: 'name is required' };
  }

  const result = await pool.query(`
    INSERT INTO projects (name, description, repo_path, type, status)
    VALUES ($1, $2, $3, 'project', 'active')
    RETURNING *
  `, [
    name,
    description || '',
    repo_path || (repo_paths?.[0]) || null
  ]);

  const project = result.rows[0];

  // Insert into project_repos for multi-repo support
  const allPaths = repo_paths || (repo_path ? [repo_path] : []);
  for (const rp of allPaths) {
    await pool.query(`
      INSERT INTO project_repos (project_id, repo_path)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
    `, [project.id, rp]);
  }

  // Link to KRs if provided
  if (Array.isArray(kr_ids)) {
    for (const krId of kr_ids) {
      await pool.query(
        'INSERT INTO project_kr_links (project_id, kr_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [project.id, krId]
      );
    }
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
  const result = await pool.query(`
    UPDATE tasks SET ${updates.join(', ')}
    WHERE id = $${idx}
    RETURNING *
  `, values);

  if (result.rows.length === 0) {
    return { success: false, error: 'Task not found' };
  }

  const task = result.rows[0];
  console.log(`[Action] Updated task: ${task_id}`);

  // Broadcast task update to WebSocket clients
  await broadcastTaskState(task_id);

  return { success: true, task };
}

/**
 * Create a new goal
 */
async function createGoal({ title, description, priority, project_id, target_date, parent_id }) {
  const result = await pool.query(`
    INSERT INTO goals (title, description, priority, project_id, target_date, parent_id, status, progress)
    VALUES ($1, $2, $3, $4, $5, $6, 'pending', 0)
    RETURNING *
  `, [
    title,
    description || '',
    priority || 'P1',
    project_id || null,
    target_date || null,
    parent_id || null
  ]);

  console.log(`[Action] Created goal: ${result.rows[0].id} - ${title}`);
  return { success: true, goal: result.rows[0] };
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
  values.push(goal_id);
  const result = await pool.query(`
    UPDATE goals SET ${updates.join(', ')}
    WHERE id = $${idx}
    RETURNING *
  `, values);

  if (result.rows.length === 0) {
    return { success: false, error: 'Goal not found' };
  }

  console.log(`[Action] Updated goal: ${goal_id}`);
  return { success: true, goal: result.rows[0] };
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
  createProject,
  updateTask,
  createGoal,
  updateGoal,
  triggerN8n,
  setMemory,
  batchUpdateTasks
};
