/* global console */
import pool from './db.js';

const N8N_API_URL = process.env.N8N_API_URL || 'http://localhost:5679';
const N8N_API_KEY = process.env.N8N_API_KEY || '';

/**
 * Create a new task
 */
async function createTask({ title, description, priority, project_id, goal_id, tags, task_type, context }) {
  const result = await pool.query(`
    INSERT INTO tasks (title, description, priority, project_id, goal_id, tags, task_type, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued')
    RETURNING *
  `, [
    title,
    description || context || '',
    priority || 'P1',
    project_id || null,
    goal_id || null,
    tags || [],
    task_type || 'dev'
  ]);

  console.log(`[Action] Created task: ${result.rows[0].id} - ${title} (type: ${task_type || 'dev'})`);
  return { success: true, task: result.rows[0] };
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

  console.log(`[Action] Updated task: ${task_id}`);
  return { success: true, task: result.rows[0] };
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
 * Log a decision (for audit trail)
 */
async function logDecision({ trigger, input_summary, decision, result }) {
  await pool.query(`
    INSERT INTO decision_log (trigger, input_summary, llm_output_json, action_result_json, status)
    VALUES ($1, $2, $3, $4, $5)
  `, [
    trigger || 'claude_code',
    input_summary || '',
    decision || {},
    result || {},
    result?.success ? 'success' : 'failed'
  ]);

  return { success: true };
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
  updateTask,
  createGoal,
  updateGoal,
  triggerN8n,
  setMemory,
  logDecision,
  batchUpdateTasks
};
