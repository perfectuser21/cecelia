/**
 * dev-records 路由 — 开发记录 API
 *
 * GET  /api/brain/dev-records          列表（支持 type/area/limit 过滤）
 * GET  /api/brain/dev-records/:id      单条
 * POST /api/brain/dev-records          创建
 */

/* global console */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

/** GET /dev-records — 列表 */
router.get('/dev-records', async (req, res) => {
  try {
    const { record_type, area, limit = '50' } = req.query;
    const params = [];
    const conditions = [];

    if (record_type) {
      params.push(record_type);
      conditions.push(`record_type = $${params.length}`);
    }
    if (area) {
      params.push(area);
      conditions.push(`area = $${params.length}`);
    }

    params.push(Math.min(parseInt(limit, 10) || 50, 200));
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT id, title, pr_number, pr_url, branch, summary, record_type, area,
              components_affected, created_at, metadata
       FROM dev_records
       ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[dev-records] GET /dev-records error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** GET /dev-records/:id — 单条 */
router.get('/dev-records/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM dev_records WHERE id = $1',
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[dev-records] GET /dev-records/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** POST /dev-records — 创建 */
router.post('/dev-records', async (req, res) => {
  try {
    const {
      title, pr_number, pr_url, branch, summary = '',
      record_type = 'manual', area, components_affected = [], metadata = {}
    } = req.body;

    if (!title) return res.status(400).json({ error: 'title is required' });

    const result = await pool.query(
      `INSERT INTO dev_records
         (title, pr_number, pr_url, branch, summary, record_type, area, components_affected, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (pr_number) WHERE pr_number IS NOT NULL
       DO UPDATE SET
         title = EXCLUDED.title,
         pr_url = EXCLUDED.pr_url,
         summary = EXCLUDED.summary,
         components_affected = EXCLUDED.components_affected,
         metadata = EXCLUDED.metadata
       RETURNING *`,
      [
        title,
        pr_number || null,
        pr_url || null,
        branch || null,
        summary,
        record_type,
        area || null,
        components_affected,
        JSON.stringify(metadata)
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[dev-records] POST /dev-records error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
