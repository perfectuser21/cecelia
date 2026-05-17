/**
 * System Reports 路由 — 系统简报 API
 *
 * GET /api/brain/reports
 *   返回简报列表（支持 limit、type 参数）
 *   表结构：id, type, content, metadata, created_at
 *
 * GET /api/brain/reports/:id
 *   返回指定简报详情
 *
 * POST /api/brain/reports/generate
 *   手动生成一条简报。type=weekly_report 触发真实周报生成；其他类型生成测试简报。
 */

import { Router } from 'express';
import pool from '../db.js';
import { generateWeeklyReport } from '../weekly-report-generator.js';

const router = Router();

/**
 * GET /
 * 获取简报列表
 * @query {number} limit - 最多返回数量（默认 20，最大 100）
 * @query {string} type - 筛选报告类型（可选）
 */
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;
    const type = req.query.type;

    const whereClause = type ? `WHERE type = $1` : '';
    const params = type ? [type, limit, offset] : [limit, offset];
    const limitParam = type ? '$2' : '$1';
    const offsetParam = type ? '$3' : '$2';

    const queryText = `
      SELECT
        id,
        type,
        content->>'title' AS title,
        content->>'summary' AS summary,
        metadata,
        created_at
      FROM system_reports
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `;

    const countParams = type ? [type] : [];
    const countWhere = type ? `WHERE type = $1` : '';
    const countQuery = `SELECT COUNT(*) FROM system_reports ${countWhere}`;

    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query(queryText, params),
      pool.query(countQuery, countParams),
    ]);

    res.json({
      reports: rows,
      count: rows.length,
      total: parseInt(countRows[0].count),
      limit,
      offset,
    });
  } catch (err) {
    console.error('[system-reports] GET / error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /:id
 * 获取指定简报详情（含完整 content）
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { rows } = await pool.query(
      `SELECT id, type, content, metadata, created_at
       FROM system_reports
       WHERE id = $1`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Report not found' });
    }

    res.json({ report: rows[0] });
  } catch (err) {
    console.error('[system-reports] GET /:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /generate
 * 手动生成一条简报。
 * - type=weekly_report：触发真实周报生成（force 模式，跳过时间窗口），写入 system_reports
 * - 其他类型：写入测试简报
 * @body {string} type - 报告类型（默认 '48h_summary'）
 * @body {string} title - 报告标题（可选，非 weekly_report 时生效）
 */
router.post('/generate', async (req, res) => {
  try {
    const type = req.body.type || '48h_summary';

    if (type === 'weekly_report') {
      const result = await generateWeeklyReport(pool, new Date(), { force: true });
      if (!result.generated) {
        return res.status(500).json({ error: '周报生成失败', detail: result });
      }
      const { rows } = await pool.query(
        `SELECT id, type, metadata, created_at FROM system_reports WHERE type = 'weekly_report' ORDER BY created_at DESC LIMIT 1`
      );
      return res.json({ success: true, report: rows[0] || { week: result.week, report_id: result.report_id } });
    }

    const title = req.body.title || `手动生成简报 ${new Date().toISOString()}`;
    const content = {
      title,
      summary: '手动生成的测试简报，用于端到端验证。',
      period: '48h',
      generated_at: new Date().toISOString(),
      kr_progress: [],
      task_stats: { completed: 0, failed: 0, in_progress: 0, queued: 0 },
      health: { status: 'ok', issues: [] },
      anomalies: [],
      risks: [],
    };

    const { rows } = await pool.query(
      `INSERT INTO system_reports (type, content, metadata)
       VALUES ($1, $2::jsonb, $3::jsonb)
       RETURNING id, type, metadata, created_at`,
      [type, JSON.stringify(content), JSON.stringify({ triggered_by: 'api', version: '1.0' })]
    );

    res.json({ success: true, report: rows[0] });
  } catch (err) {
    console.error('[system-reports] POST /generate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
