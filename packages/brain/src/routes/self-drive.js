/**
 * Self-Drive route — Cecelia 自我驱动数据查询
 *
 * GET /latest — 获取最近一次 SelfDrive 思考事件
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

/**
 * GET /api/brain/self-drive/latest
 * 返回最近一次 SelfDrive 事件（cycle_complete 类型，含 reasoning）
 */
router.get('/latest', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, event_type, source, payload, created_at
      FROM cecelia_events
      WHERE event_type = 'self_drive'
        AND payload->>'subtype' = 'cycle_complete'
      ORDER BY created_at DESC
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        event: null,
        message: '暂无 SelfDrive 思考记录',
      });
    }

    const row = result.rows[0];
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;

    res.json({
      success: true,
      event: {
        id: row.id,
        created_at: row.created_at,
        reasoning: payload.reasoning || '',
        tasks_created: payload.tasks_created || 0,
        adjustments_executed: payload.adjustments_executed || 0,
        tasks: payload.tasks || [],
        adjustments: payload.adjustments || [],
        probe_summary: payload.probe_summary || null,
        scan_summary: payload.scan_summary || null,
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: '获取 SelfDrive 最近思考失败',
      details: err.message,
    });
  }
});

export default router;
