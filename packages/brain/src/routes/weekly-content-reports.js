/**
 * weekly-content-reports.js — 内容周报 API 路由
 *
 * GET  /api/brain/weekly-content-reports
 *   返回周报列表（支持 limit、offset 参数）
 *
 * GET  /api/brain/weekly-content-reports/:weekLabel
 *   返回指定周报详情（week_label 如 "2026-W14"）
 *
 * POST /api/brain/weekly-content-reports/generate
 *   手动生成周报
 *   Body: { week_label?: string, dry_run?: boolean }
 */

import { Router } from 'express';
import pool from '../db.js';
import { generateWeeklyContentReport, getLastWeekLabel } from '../weekly-content-report-generator.js';

const router = Router();

// GET /api/brain/weekly-content-reports
router.get('/', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 10, 52);
  const offset = parseInt(req.query.offset) || 0;
  try {
    const result = await pool.query(`
      SELECT id, week_label, period_start, period_end,
             content, metadata, created_at, updated_at
      FROM weekly_content_reports
      ORDER BY period_start DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
    const countRes = await pool.query('SELECT COUNT(*) FROM weekly_content_reports');
    res.json({
      items: result.rows,
      total: parseInt(countRes.rows[0].count),
      limit,
      offset,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/brain/weekly-content-reports/generate
router.post('/generate', async (req, res) => {
  const { week_label, dry_run = false } = req.body || {};
  try {
    const report = await generateWeeklyContentReport(pool, {
      weekLabel: week_label || getLastWeekLabel(),
      dryRun: dry_run,
    });
    res.json({ success: true, report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/brain/weekly-content-reports/:weekLabel
router.get('/:weekLabel', async (req, res) => {
  const { weekLabel } = req.params;
  try {
    const result = await pool.query(`
      SELECT id, week_label, period_start, period_end,
             content, metadata, created_at, updated_at
      FROM weekly_content_reports
      WHERE week_label = $1
    `, [weekLabel]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '周报不存在' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
