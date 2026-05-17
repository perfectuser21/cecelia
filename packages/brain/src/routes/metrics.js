/**
 * Metrics route — 任务执行成功率监控
 *
 * GET /success-rate               — 返回成功率统计（overall、by_task_type、recent_7days）
 * POST /tasks/:id/execution-attempt — 记录一次执行尝试（递增 execution_attempts）
 * PATCH /tasks/:id/pr-merged      — 标记 PR 已合并
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

// GET /success-rate — 返回任务执行成功率统计
router.get('/success-rate', async (_req, res) => {
  try {
    // Overall 统计
    const overallResult = await pool.query(`
      SELECT
        COUNT(*) AS total_tasks,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed_tasks,
        COUNT(*) FILTER (WHERE pr_merged_at IS NOT NULL) AS pr_merged_tasks,
        ROUND(AVG(COALESCE(execution_attempts, 0))::numeric, 2) AS avg_attempts
      FROM tasks
    `);

    const overall = overallResult.rows[0];
    const totalTasks = parseInt(overall.total_tasks, 10);
    const prMergedTasks = parseInt(overall.pr_merged_tasks, 10);
    const overallSuccessRate = totalTasks > 0 ? prMergedTasks / totalTasks : 0;

    // By task_type 统计
    const byTypeResult = await pool.query(`
      SELECT
        task_type,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE pr_merged_at IS NOT NULL) AS pr_merged
      FROM tasks
      GROUP BY task_type
      ORDER BY total DESC
    `);

    const byTaskType = {};
    for (const row of byTypeResult.rows) {
      const total = parseInt(row.total, 10);
      const prMerged = parseInt(row.pr_merged, 10);
      byTaskType[row.task_type] = {
        total,
        pr_merged: prMerged,
        success_rate: total > 0 ? prMerged / total : 0,
      };
    }

    // Recent 7 days 统计
    const recent7Result = await pool.query(`
      SELECT
        COUNT(*) AS total_tasks,
        COUNT(*) FILTER (WHERE pr_merged_at IS NOT NULL) AS pr_merged_tasks,
        COUNT(*) FILTER (WHERE pr_merged_at IS NOT NULL AND pr_merged_at >= NOW() - INTERVAL '3 days') AS recent_3days_merged,
        COUNT(*) FILTER (WHERE pr_merged_at IS NOT NULL AND pr_merged_at < NOW() - INTERVAL '3 days') AS older_merged
      FROM tasks
      WHERE created_at >= NOW() - INTERVAL '7 days'
    `);

    const recent7 = recent7Result.rows[0];
    const recent7Total = parseInt(recent7.total_tasks, 10);
    const recent7Merged = parseInt(recent7.pr_merged_tasks, 10);
    const recent7Rate = recent7Total > 0 ? recent7Merged / recent7Total : 0;

    // 趋势判断：最近 3 天合并率 vs 更早的 4 天合并率
    const recent3Merged = parseInt(recent7.recent_3days_merged, 10);
    const olderMerged = parseInt(recent7.older_merged, 10);
    let trend = 'stable';
    if (recent3Merged > olderMerged) {
      trend = 'improving';
    } else if (recent3Merged < olderMerged) {
      trend = 'declining';
    }

    res.json({
      overall: {
        total_tasks: totalTasks,
        completed_tasks: parseInt(overall.completed_tasks, 10),
        pr_merged_tasks: prMergedTasks,
        success_rate: Math.round(overallSuccessRate * 1000) / 1000,
        avg_attempts: parseFloat(overall.avg_attempts) || 0,
      },
      by_task_type: byTaskType,
      recent_7days: {
        total_tasks: recent7Total,
        pr_merged_tasks: recent7Merged,
        success_rate: Math.round(recent7Rate * 1000) / 1000,
        trend,
      },
    });
  } catch (err) {
    console.error('[metrics] success-rate query failed:', err.message);
    res.status(500).json({ error: 'Failed to calculate success rate', details: err.message });
  }
});

// POST /tasks/:id/execution-attempt — 记录一次执行尝试
router.post('/tasks/:id/execution-attempt', async (req, res) => {
  const { id } = req.params;
  const { attempt_number, started_at, error_details } = req.body;

  try {
    const result = await pool.query(
      `UPDATE tasks
       SET
         execution_attempts = COALESCE(execution_attempts, 0) + 1,
         last_attempt_at = COALESCE($2::timestamp, NOW()),
         updated_at = NOW()
       WHERE id = $1
       RETURNING id, title, execution_attempts, last_attempt_at`,
      [id, started_at || null]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const task = result.rows[0];

    // 记录 attempt 详情到 metadata（可选，不影响主流程）
    if (attempt_number !== undefined || error_details !== undefined) {
      try {
        await pool.query(
          `UPDATE tasks
           SET metadata = COALESCE(metadata, '{}'::jsonb) ||
             jsonb_build_object('last_attempt', jsonb_build_object(
               'attempt_number', $2::int,
               'started_at', $3,
               'error_details', $4::jsonb
             ))
           WHERE id = $1`,
          [
            id,
            attempt_number || task.execution_attempts,
            started_at || new Date().toISOString(),
            error_details ? JSON.stringify(error_details) : null,
          ]
        );
      } catch (metaErr) {
        // P3 级别：不影响主流程
        console.warn('[metrics] execution_attempt_record_failed:', metaErr.message);
      }
    }

    res.json({
      task_id: task.id,
      title: task.title,
      execution_attempts: task.execution_attempts,
      last_attempt_at: task.last_attempt_at,
    });
  } catch (err) {
    console.error('[metrics] execution-attempt failed:', err.message);
    res.status(500).json({ error: 'Failed to record execution attempt', details: err.message });
  }
});

// PATCH /tasks/:id/pr-merged — 标记 PR 已合并
router.patch('/tasks/:id/pr-merged', async (req, res) => {
  const { id } = req.params;
  const { pr_url, merged_at, metrics } = req.body;

  if (!pr_url) {
    return res.status(400).json({ error: 'pr_url is required' });
  }

  try {
    const result = await pool.query(
      `UPDATE tasks
       SET
         pr_url = $2,
         pr_merged_at = COALESCE($3::timestamp, NOW()),
         success_metrics = $4::jsonb,
         status = CASE WHEN status != 'completed' THEN 'completed' ELSE status END,
         completed_at = CASE WHEN completed_at IS NULL THEN NOW() ELSE completed_at END,
         updated_at = NOW()
       WHERE id = $1
       RETURNING id, title, status, pr_url, pr_merged_at, success_metrics, execution_attempts`,
      [id, pr_url, merged_at || null, metrics ? JSON.stringify(metrics) : null]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[metrics] pr_merged_update_failed:', err.message);
    res.status(500).json({ error: 'Failed to mark PR as merged', details: err.message });
  }
});

export default router;
