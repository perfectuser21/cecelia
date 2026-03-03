/**
 * Reports Routes - 简报 API
 *
 * GET  /api/brain/reports/latest   - 获取最新简报
 * GET  /api/brain/reports          - 获取简报列表（分页）
 * POST /api/brain/reports/generate - 手动触发简报生成
 */

import { Router } from 'express';
import pool from './db.js';
import { generateSystemReport } from './report-scheduler.js';

const router = Router();

/**
 * GET /api/brain/reports/latest
 * 返回最新的一条简报
 */
router.get('/latest', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, report_type, interval_hours, period_start, period_end,
              summary, tasks_completed, tasks_failed, tasks_total,
              health_status, generated_by, pushed_to_ws, created_at
       FROM reports
       ORDER BY created_at DESC
       LIMIT 1`
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No reports found', reports: [] });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[reports-routes] GET /latest failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brain/reports
 * 获取简报列表，支持分页
 * Query: ?limit=10&offset=0
 */
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '10', 10), 100);
    const offset = parseInt(req.query.offset || '0', 10);

    const result = await pool.query(
      `SELECT id, report_type, interval_hours, period_start, period_end,
              summary, tasks_completed, tasks_failed, tasks_total,
              health_status, generated_by, pushed_to_ws, created_at
       FROM reports
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await pool.query('SELECT COUNT(*) FROM reports');
    const total = parseInt(countResult.rows[0].count, 10);

    res.json({
      reports: result.rows,
      total,
      limit,
      offset,
    });
  } catch (err) {
    console.error('[reports-routes] GET / failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/brain/reports/generate
 * 手动触发简报生成（不受 48h 间隔限制）
 */
router.post('/generate', async (req, res) => {
  try {
    console.log('[reports-routes] Manual report generation triggered');
    const report = await generateSystemReport(pool);
    res.json({
      success: true,
      report_id: report.id,
      summary: report.summary,
      tasks_completed: report.tasks_completed,
      tasks_failed: report.tasks_failed,
      tasks_total: report.tasks_total,
      health_status: report.health_status,
      generated_by: report.generated_by,
      pushed_to_ws: report.pushed_to_ws,
    });
  } catch (err) {
    console.error('[reports-routes] POST /generate failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
