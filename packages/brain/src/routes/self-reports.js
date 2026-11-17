/**
 * Self Reports 路由 — Layer 4 欲望轨迹 API
 *
 * GET /api/brain/self-reports?limit=20
 *   返回最近 N 条 Cecelia 欲望自述记录
 *
 * POST /api/brain/self-reports/collect
 *   已退役，返回 410，不触发数据库查询或模型调用
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

/**
 * GET /
 * 获取欲望轨迹历史
 */
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const { rows } = await pool.query(`
      SELECT
        id,
        created_at,
        top_desire,
        top_concerns,
        requested_power,
        self_rating,
        raw_response,
        signals_snapshot
      FROM self_reports
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);

    res.json({ records: rows, count: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 已退役入口保留明确响应，历史查询继续只读。 */
router.post('/collect', (_req, res) => {
  res.status(410).json({
    error: 'self_report_collection_retired',
    message: 'Brain 自述采集已停用，历史记录仍可查询。',
  });
});

export default router;
