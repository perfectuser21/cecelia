/* global process, console */
import pool from './db.js';
import crypto from 'crypto';

const N8N_API_URL = process.env.N8N_API_URL || 'http://localhost:5679';
const N8N_API_KEY = process.env.N8N_API_KEY || '';

/**
 * Probe n8n status
 */
async function probeN8n() {
  try {
    const headers = N8N_API_KEY ? { 'X-N8N-API-KEY': N8N_API_KEY } : {};

    // Get recent executions
    const execRes = await fetch(`${N8N_API_URL}/api/v1/executions?limit=20`, { headers });
    const execData = await execRes.json();

    const executions = execData.data || [];
    const oneHourAgo = Date.now() - 60 * 60 * 1000;

    // Calculate metrics
    const recentExecs = executions.filter(e => new Date(e.startedAt).getTime() > oneHourAgo);
    const failures1h = recentExecs.filter(e => e.status === 'failed' || e.status === 'error').length;
    const lastSuccess = executions.find(e => e.status === 'success');

    // Get active workflows count
    const wfRes = await fetch(`${N8N_API_URL}/api/v1/workflows?active=true`, { headers });
    const wfData = await wfRes.json();
    const activeWorkflows = wfData.data?.length || 0;

    return {
      status: 'ok',
      active_workflows: activeWorkflows,
      executions_1h: recentExecs.length,
      failures_1h: failures1h,
      last_success_ts: lastSuccess?.stoppedAt || null,
      error_rate_1h: recentExecs.length > 0 ? (failures1h / recentExecs.length) : 0
    };
  } catch (err) {
    return {
      status: 'error',
      error: err.message,
      active_workflows: 0,
      executions_1h: 0,
      failures_1h: 0,
      last_success_ts: null,
      error_rate_1h: 0
    };
  }
}

/**
 * Probe Task System status
 */
async function probeTaskSystem() {
  try {
    // Get task counts by priority and status
    const taskResult = await pool.query(`
      SELECT
        priority,
        status,
        COUNT(*) as count
      FROM tasks
      GROUP BY priority, status
    `);

    const taskStats = {
      P0: { queued: 0, in_progress: 0, completed: 0, failed: 0 },
      P1: { queued: 0, in_progress: 0, completed: 0, failed: 0 },
      P2: { queued: 0, in_progress: 0, completed: 0, failed: 0 }
    };

    for (const row of taskResult.rows) {
      const p = row.priority || 'P2';
      const s = row.status || 'queued';
      if (taskStats[p] && taskStats[p][s] !== undefined) {
        taskStats[p][s] = parseInt(row.count);
      }
    }

    // Get stale tasks (queued for more than 7 days and not completed)
    const staleResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM tasks
      WHERE queued_at < NOW() - INTERVAL '7 days' AND status NOT IN ('completed', 'cancelled')
    `);
    const staleCount = parseInt(staleResult.rows[0]?.count || 0);

    // Get goals progress
    const goalsResult = await pool.query(`
      SELECT
        status,
        COUNT(*) as count,
        AVG(progress) as avg_progress
      FROM goals
      GROUP BY status
    `);

    const goalStats = {};
    for (const row of goalsResult.rows) {
      goalStats[row.status] = {
        count: parseInt(row.count),
        avg_progress: parseFloat(row.avg_progress || 0)
      };
    }

    // Get current focus from working_memory
    const focusResult = await pool.query(`
      SELECT value_json FROM working_memory WHERE key = 'current_focus'
    `);
    const currentFocus = focusResult.rows[0]?.value_json || null;

    return {
      status: 'ok',
      tasks: taskStats,
      stale_count: staleCount,
      goals: goalStats,
      current_focus: currentFocus,
      open_p0: taskStats.P0.queued + taskStats.P0.in_progress,
      open_p1: taskStats.P1.queued + taskStats.P1.in_progress
    };
  } catch (err) {
    return {
      status: 'error',
      error: err.message,
      tasks: {},
      stale_count: 0,
      goals: {},
      current_focus: null,
      open_p0: 0,
      open_p1: 0
    };
  }
}

/**
 * Create a combined system snapshot
 */
async function createSnapshot() {
  const n8nStatus = await probeN8n();
  const taskStatus = await probeTaskSystem();

  const snapshot = {
    n8n: n8nStatus,
    task_system: taskStatus,
    timestamp: new Date().toISOString()
  };

  // Create hash for deduplication
  const hash = crypto.createHash('sha256')
    .update(JSON.stringify(snapshot))
    .digest('hex')
    .substring(0, 16);

  // Check if same snapshot already exists (within last 5 minutes)
  const existing = await pool.query(`
    SELECT id FROM system_snapshot
    WHERE hash = $1 AND ts > NOW() - INTERVAL '5 minutes'
    LIMIT 1
  `, [hash]);

  if (existing.rows.length > 0) {
    console.log('[Perception] Snapshot unchanged, skipping');
    return null;
  }

  // Insert new snapshot
  const result = await pool.query(`
    INSERT INTO system_snapshot (source, snapshot_json, hash)
    VALUES ('combined', $1, $2)
    RETURNING id, ts
  `, [snapshot, hash]);

  console.log(`[Perception] Snapshot created: ${result.rows[0].id}`);
  return result.rows[0];
}

/**
 * Get recent snapshots
 */
async function getRecentSnapshots(limit = 10) {
  const result = await pool.query(`
    SELECT id, ts, source, snapshot_json
    FROM system_snapshot
    ORDER BY ts DESC
    LIMIT $1
  `, [limit]);
  return result.rows;
}

/**
 * Get latest snapshot
 */
async function getLatestSnapshot() {
  const result = await pool.query(`
    SELECT id, ts, source, snapshot_json
    FROM system_snapshot
    ORDER BY ts DESC
    LIMIT 1
  `);
  return result.rows[0] || null;
}

export {
  probeN8n,
  probeTaskSystem,
  createSnapshot,
  getRecentSnapshots,
  getLatestSnapshot
};
