/**
 * Self Reports 路由 — Layer 4 欲望轨迹 API
 *
 * GET /api/brain/self-reports?limit=20
 *   返回最近 N 条 Cecelia 欲望自述记录
 *
 * POST /api/brain/self-reports/collect
 *   立即触发一次采集（忽略时间间隔，用于调试/初始采集）
 */

import { Router } from 'express';
import pool from '../db.js';
import { collectSelfReport, _resetTimer } from '../self-report-collector.js';

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

/**
 * POST /collect
 * 立即触发一次采集（调试用，强制忽略时间间隔）
 */
router.post('/collect', async (_req, res) => {
  try {
    _resetTimer(); // 重置计时器，强制采集
    const record = await collectSelfReport(pool);
    if (!record) {
      return res.status(500).json({ error: '采集失败，请查看 Brain 日志' });
    }
    res.json({ success: true, record });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
