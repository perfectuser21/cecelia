/* global console */
import pool from './db.js';
import { getLatestSnapshot } from './perception.js';

/**
 * Get active policy
 */
async function getActivePolicy() {
  const result = await pool.query(`
    SELECT id, version, name, content_json
    FROM policy
    WHERE active = true
    ORDER BY version DESC
    LIMIT 1
  `);
  return result.rows[0] || null;
}

/**
 * Get working memory
 */
async function getWorkingMemory() {
  const result = await pool.query(`
    SELECT key, value_json FROM working_memory
  `);
  const memory = {};
  for (const row of result.rows) {
    memory[row.key] = row.value_json;
  }
  return memory;
}

/**
 * Update working memory
 */
async function updateWorkingMemory(key, value) {
  await pool.query(`
    INSERT INTO working_memory (key, value_json, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
  `, [key, value]);
}

/**
 * Get top priority tasks
 */
async function getTopTasks(limit = 10) {
  const result = await pool.query(`
    SELECT id, title, description, priority, status, project_id, queued_at
    FROM tasks
    WHERE status NOT IN ('completed', 'cancelled')
    ORDER BY
      CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
      created_at ASC
    LIMIT $1
  `, [limit]);
  return result.rows;
}

/**
 * Get recent decisions
 */
async function getRecentDecisions(limit = 10) {
  const result = await pool.query(`
    SELECT id, ts, trigger, input_summary, llm_output_json, action_result_json, status
    FROM decision_log
    ORDER BY ts DESC
    LIMIT $1
  `, [limit]);
  return result.rows;
}

/**
 * Get system status summary (for Claude Code to read)
 */
async function getSystemStatus() {
  const [snapshot, workingMemory, topTasks, recentDecisions, policy] = await Promise.all([
    getLatestSnapshot(),
    getWorkingMemory(),
    getTopTasks(10),
    getRecentDecisions(3),
    getActivePolicy()
  ]);

  return {
    // 最新快照
    snapshot: snapshot?.snapshot_json || null,
    snapshot_ts: snapshot?.ts || null,

    // 工作记忆
    working_memory: workingMemory,

    // 优先级排序的任务
    top_tasks: topTasks,

    // 最近决策（审计）
    recent_decisions: recentDecisions.map(d => ({
      ts: d.ts,
      trigger: d.trigger,
      input: d.input_summary,
      action: d.llm_output_json?.next_action,
      status: d.status
    })),

    // 当前策略
    policy: policy?.content_json || {},

    // 快速统计
    stats: {
      open_p0: topTasks.filter(t => t.priority === 'P0' && t.status !== 'completed').length,
      open_p1: topTasks.filter(t => t.priority === 'P1' && t.status !== 'completed').length,
      in_progress: topTasks.filter(t => t.status === 'in_progress').length,
      queued: topTasks.filter(t => t.status === 'queued').length
    }
  };
}

export {
  getActivePolicy,
  getWorkingMemory,
  updateWorkingMemory,
  getTopTasks,
  getRecentDecisions,
  getSystemStatus
};
