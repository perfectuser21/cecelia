/**
 * System Reports 路由 — 48h 系统简报 API
 *
 * GET /api/brain/reports?type=&limit=20&offset=0
 *   返回简报列表（按创建时间降序）
 *
 * GET /api/brain/reports/:id
 *   返回简报详情
 *
 * POST /api/brain/reports/generate
 *   手动触发生成一份简报（端到端测试用）
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

/**
 * GET /
 * 获取简报列表
 */
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;
    const type = req.query.type || null;

    let query;
    let params;

    if (type) {
      query = `
        SELECT
          id,
          type,
          created_at,
          metadata,
          content->>'title' AS title,
          content->>'summary' AS summary
        FROM system_reports
        WHERE type = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
      `;
      params = [type, limit, offset];
    } else {
      query = `
        SELECT
          id,
          type,
          created_at,
          metadata,
          content->>'title' AS title,
          content->>'summary' AS summary
        FROM system_reports
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
      `;
      params = [limit, offset];
    }

    const { rows } = await pool.query(query, params);

    // 获取总数
    const countResult = await pool.query(
      type
        ? 'SELECT COUNT(*) FROM system_reports WHERE type = $1'
        : 'SELECT COUNT(*) FROM system_reports',
      type ? [type] : []
    );

    res.json({
      records: rows,
      count: rows.length,
      total: parseInt(countResult.rows[0].count),
      limit,
      offset,
    });
  } catch (err) {
    console.error('[reports] GET / error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /:id
 * 获取简报详情
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { rows } = await pool.query(
      'SELECT * FROM system_reports WHERE id = $1',
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Report not found', id });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('[reports] GET /:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /generate
 * 手动触发生成简报（端到端测试用）
 */
router.post('/generate', async (req, res) => {
  try {
    const type = req.body?.type || '48h_system_report';

    // 插入一条测试简报记录
    const { rows } = await pool.query(
      `INSERT INTO system_reports (type, content, metadata)
       VALUES ($1, $2::jsonb, $3::jsonb)
       RETURNING *`,
      [
        type,
        JSON.stringify({
          title: `系统简报 (${new Date().toLocaleDateString('zh-CN')})`,
          summary: '手动触发生成的系统简报',
          kr_progress: [],
          task_stats: { completed: 0, failed: 0, in_progress: 0, queued: 0 },
          system_health: { status: 'ok' },
          anomalies: [],
          risks: [],
          generated_at: new Date().toISOString(),
          generated_by: 'manual',
        }),
        JSON.stringify({
          triggered_by: 'api',
          trigger_time: new Date().toISOString(),
        }),
      ]
    );

    res.json({ success: true, report: rows[0] });
  } catch (err) {
    console.error('[reports] POST /generate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
