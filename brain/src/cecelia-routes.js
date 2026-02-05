/**
 * Cecelia task execution API routes.
 *
 * Provides /overview and /runs/:id endpoints
 * for the frontend CeceliaRuns and RunDetail pages.
 */
import { Router } from 'express';
import pool from './db.js';

const router = Router();

// Dev workflow steps (11 total)
const DEV_STEPS = [
  { id: 'S1', name: 'PRD 确认' },
  { id: 'S2', name: '环境检测' },
  { id: 'S3', name: '分支创建' },
  { id: 'S4', name: 'DoD 定稿' },
  { id: 'S5', name: '写代码' },
  { id: 'S6', name: '写测试' },
  { id: 'S7', name: '质检' },
  { id: 'S8', name: '提交 PR' },
  { id: 'S9', name: 'CI 监控' },
  { id: 'S10', name: 'Learning' },
  { id: 'S11', name: '清理' },
];

const STATUS_MAP = {
  queued: 'pending',
  in_progress: 'running',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'failed',
};

function mapStatus(dbStatus) {
  return STATUS_MAP[dbStatus] || 'pending';
}

function inferStepProgress(task) {
  const payload = task.payload || {};
  const status = task.status || 'queued';
  const total = DEV_STEPS.length;

  if (status === 'completed') {
    return { total, completed: total, failed: 0, current: null };
  }
  if (status === 'failed' || status === 'cancelled') {
    const stepStr = payload.current_step;
    if (stepStr) {
      const idx = parseInt(stepStr, 10);
      if (!isNaN(idx) && idx >= 1 && idx <= total) {
        return { total, completed: idx - 1, failed: 1, current: DEV_STEPS[idx - 1].name };
      }
    }
    return { total, completed: 0, failed: 1, current: null };
  }
  if (status === 'queued') {
    return { total, completed: 0, failed: 0, current: DEV_STEPS[0].name };
  }

  // in_progress / running
  const stepStr = payload.current_step;
  if (stepStr) {
    const idx = parseInt(stepStr, 10);
    if (!isNaN(idx) && idx >= 1 && idx <= total) {
      return { total, completed: idx - 1, failed: 0, current: DEV_STEPS[idx - 1].name };
    }
  }
  return { total, completed: 0, failed: 0, current: DEV_STEPS[0].name };
}

function formatTaskRun(task) {
  const payload = task.payload || {};
  const progress = inferStepProgress(task);

  return {
    id: task.id,
    prd_path: payload.prd_path || null,
    project: task.title || 'Unknown',
    feature_branch: payload.feature_branch || '',
    status: mapStatus(task.status),
    total_checkpoints: progress.total,
    completed_checkpoints: progress.completed,
    failed_checkpoints: progress.failed,
    current_checkpoint: progress.current,
    started_at: task.started_at ? task.started_at.toISOString() : null,
    updated_at: task.updated_at ? task.updated_at.toISOString() : null,
    completed_at: task.completed_at ? task.completed_at.toISOString() : null,
    error: payload.error || null,
    mode: payload.run_status ? 'headless' : null,
  };
}

function buildCheckpoints(task) {
  const payload = task.payload || {};
  const status = task.status || 'queued';
  const runId = task.id;

  let currentStepIdx = 0;
  const stepStr = payload.current_step;
  if (stepStr) {
    const idx = parseInt(stepStr, 10);
    if (!isNaN(idx)) currentStepIdx = idx;
  }

  return DEV_STEPS.map((step, i) => {
    const stepNum = i + 1;
    let cpStatus;

    if (status === 'completed') {
      cpStatus = 'done';
    } else if (status === 'failed' || status === 'cancelled') {
      if (stepNum < currentStepIdx) cpStatus = 'done';
      else if (stepNum === currentStepIdx) cpStatus = 'failed';
      else cpStatus = 'skipped';
    } else if (status === 'queued') {
      cpStatus = 'pending';
    } else {
      // in_progress
      if (stepNum < currentStepIdx) cpStatus = 'done';
      else if (stepNum === currentStepIdx) cpStatus = 'in_progress';
      else cpStatus = 'pending';
    }

    return {
      run_id: runId,
      checkpoint_id: step.id,
      status: cpStatus,
      started_at: null,
      completed_at: null,
      duration: null,
      output: null,
      error: null,
      pr_url: null,
    };
  });
}

// GET /overview
router.get('/overview', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    // Count by status
    const countsResult = await pool.query(`
      SELECT
        CASE
          WHEN status IN ('in_progress', 'running') THEN 'running'
          WHEN status = 'completed' THEN 'completed'
          WHEN status IN ('failed', 'cancelled') THEN 'failed'
          ELSE 'pending'
        END as mapped_status,
        count(*)::int as cnt
      FROM tasks
      WHERE status != 'cancelled'
      GROUP BY mapped_status
    `);

    const counts = {};
    for (const row of countsResult.rows) {
      counts[row.mapped_status] = row.cnt;
    }

    const running = counts.running || 0;
    const completed = counts.completed || 0;
    const failed = counts.failed || 0;
    const pending = counts.pending || 0;

    // Recent tasks
    const tasksResult = await pool.query(`
      SELECT id, title, status, payload, started_at, updated_at, completed_at
      FROM tasks
      WHERE status != 'cancelled'
      ORDER BY
        CASE WHEN status IN ('in_progress', 'running') THEN 0 ELSE 1 END,
        updated_at DESC
      LIMIT $1
    `, [limit]);

    const recentRuns = tasksResult.rows.map(formatTaskRun);

    res.json({
      success: true,
      total_runs: running + completed + failed + pending,
      running,
      completed,
      failed,
      recent_runs: recentRuns,
    });
  } catch (err) {
    console.error('Error fetching cecelia overview:', err.message);
    res.json({ success: false, error: err.message });
  }
});

// GET /runs/:runId
router.get('/runs/:runId', async (req, res) => {
  try {
    const { runId } = req.params;

    const result = await pool.query(`
      SELECT id, title, status, payload, started_at, updated_at, completed_at
      FROM tasks
      WHERE id = $1
    `, [runId]);

    if (result.rows.length === 0) {
      return res.json({ success: false, error: '任务不存在' });
    }

    const task = result.rows[0];
    const run = formatTaskRun(task);
    const checkpoints = buildCheckpoints(task);

    res.json({
      success: true,
      run,
      checkpoints,
    });
  } catch (err) {
    console.error(`Error fetching run ${req.params.runId}:`, err.message);
    res.json({ success: false, error: err.message });
  }
});

export default router;
