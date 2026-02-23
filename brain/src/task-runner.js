/**
 * Task Runner - 任务执行数据收集服务
 *
 * 负责：
 * 1. 任务开始时创建 run 记录
 * 2. 任务结束时更新 run 记录
 * 3. 记录执行上下文和结果
 */

import pool from './db.js';

/**
 * 创建一个新的 task run 记录
 *
 * @param {Object} params
 * @param {string} params.taskId - 任务 ID
 * @param {string} params.runId - 执行 ID
 * @param {Object} params.context - 执行上下文 (agent, skill, model, provider, repo_path 等)
 * @returns {Promise<Object>} 创建的 run 记录
 */
export async function createTaskRun({ taskId, runId, context = {} }) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `INSERT INTO task_runs (task_id, run_id, context, status, started_at)
       VALUES ($1, $2, $3, 'running', now())
       RETURNING *`,
      [taskId, runId, JSON.stringify(context)]
    );
    return result.rows[0];
  } finally {
    client.release();
  }
}

/**
 * 更新 task run 记录
 *
 * @param {Object} params
 * @param {string} params.runId - 执行 ID
 * @param {string} params.status - 执行状态 (success, failed, timeout, cancelled)
 * @param {Object} params.result - 执行结果
 * @param {string} params.errorMessage - 错误信息（可选）
 * @returns {Promise<Object>} 更新后的 run 记录
 */
export async function updateTaskRun({ runId, status, result = {}, errorMessage = null }) {
  const client = await pool.connect();
  try {
    const resultRow = await client.query(
      `UPDATE task_runs
       SET status = $1,
           result = $2,
           error_message = $3,
           ended_at = now(),
           updated_at = now()
       WHERE run_id = $4
       RETURNING *`,
      [status, JSON.stringify(result), errorMessage, runId]
    );
    return resultRow.rows[0];
  } finally {
    client.release();
  }
}

/**
 * 根据 task_id 查询执行历史
 *
 * @param {string} taskId - 任务 ID
 * @returns {Promise<Array>} 执行记录列表
 */
export async function getTaskRuns(taskId) {
  const result = await pool.query(
    `SELECT * FROM task_runs
     WHERE task_id = $1
     ORDER BY started_at DESC`,
    [taskId]
  );
  return result.rows;
}

/**
 * 查询所有执行记录（支持分页和筛选）
 *
 * @param {Object} params
 * @param {number} params.limit - 限制数量
 * @param {number} params.offset - 偏移量
 * @param {string} params.status - 状态筛选
 * @returns {Promise<{runs: Array, total: number}>}
 */
export async function getAllRuns({ limit = 20, offset = 0, status = null }) {
  let query = 'SELECT * FROM task_runs';
  let countQuery = 'SELECT COUNT(*) as total FROM task_runs';
  const params = [];

  if (status) {
    query += ' WHERE status = $1';
    countQuery += ' WHERE status = $1';
    params.push(status);
  }

  query += ' ORDER BY started_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
  params.push(limit, offset);

  const [runsResult, countResult] = await Promise.all([
    pool.query(query, params),
    pool.query(countQuery, status ? [status] : [])
  ]);

  return {
    runs: runsResult.rows,
    total: parseInt(countResult.rows[0].total, 10)
  };
}

/**
 * 根据 run_id 查询单条执行记录
 *
 * @param {string} runId - 执行 ID
 * @returns {Promise<Object|null>} 执行记录
 */
export async function getRunById(runId) {
  const result = await pool.query(
    'SELECT * FROM task_runs WHERE run_id = $1',
    [runId]
  );
  return result.rows[0] || null;
}

/**
 * 根据 task_id 获取最新的执行记录
 *
 * @param {string} taskId - 任务 ID
 * @returns {Promise<Object|null>} 最新的执行记录
 */
export async function getLatestRun(taskId) {
  const result = await pool.query(
    `SELECT * FROM task_runs
     WHERE task_id = $1
     ORDER BY started_at DESC
     LIMIT 1`,
    [taskId]
  );
  return result.rows[0] || null;
}
