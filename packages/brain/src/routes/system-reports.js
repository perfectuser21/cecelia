/**
 * System Reports 路由 — 系统简报 API
 *
 * GET /api/brain/reports
 *   返回简报列表（支持 limit、type 参数）
 *   表结构：id, type, content, metadata, created_at
 *
 * GET /api/brain/reports/:id
 *   返回指定简报详情
 */

import { Router } from 'express';
import pool from '../db.js';

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
    const type = req.query.type;

    let queryText = `
      SELECT
        id,
        type,
        metadata,
        created_at
      FROM system_reports
    `;
    const params = [];

    if (type) {
      params.push(type);
      queryText += ` WHERE type = $${params.length}`;
    }

    queryText += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const { rows } = await pool.query(queryText, params);

    res.json({ reports: rows, count: rows.length });
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

export default router;
