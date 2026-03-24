/**
 * Design Docs 路由 — 设计文档 + 日报 API
 *
 * GET  /api/brain/design-docs       — 列表（?type=&area=&status=&limit=&offset=）
 * GET  /api/brain/design-docs/:id   — 详情
 * POST /api/brain/design-docs       — 创建（Cecelia 自动写入或用户）
 * PUT  /api/brain/design-docs/:id   — 更新状态/内容
 */

/* global console */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

/** GET / — 列表 */
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 30, 200);
    const offset = parseInt(req.query.offset) || 0;
    const params = [];
    const conditions = [];

    if (req.query.type) {
      // 支持逗号分隔多类型：?type=research,architecture
      const types = req.query.type.split(',').map(t => t.trim()).filter(Boolean);
      if (types.length === 1) {
        params.push(types[0]);
        conditions.push(`type = $${params.length}`);
      } else if (types.length > 1) {
        params.push(types);
        conditions.push(`type = ANY($${params.length})`);
      }
    }

    if (req.query.area) {
      params.push(req.query.area);
      conditions.push(`area = $${params.length}`);
    }

    if (req.query.status) {
      params.push(req.query.status);
      conditions.push(`status = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit, offset);

    const { rows } = await pool.query(
      `SELECT id, type, title, status, area, tags, author, diary_date, created_at, updated_at
       FROM design_docs
       ${whereClause}
       ORDER BY COALESCE(diary_date::text, '') DESC, created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countParams = params.slice(0, -2);
    const { rows: countRows } = await pool.query(
      `SELECT count(*) FROM design_docs ${whereClause}`,
      countParams
    );

    res.json({ success: true, data: rows, total: parseInt(countRows[0].count) });
  } catch (err) {
    console.error('[design-docs] GET / error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/** GET /:id — 详情（含完整 content） */
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM design_docs WHERE id = $1',
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('[design-docs] GET /:id error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/** POST / — 创建 */
router.post('/', async (req, res) => {
  try {
    const {
      type, title, content, status, area, tags, author, diary_date
    } = req.body;

    if (!type || !title) {
      return res.status(400).json({ success: false, error: 'type 和 title 为必填项' });
    }

    const { rows } = await pool.query(
      `INSERT INTO design_docs (type, title, content, status, area, tags, author, diary_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        type, title, content || '',
        status || 'draft', area || null,
        tags || null, author || 'cecelia',
        diary_date || null
      ]
    );

    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('[design-docs] POST / error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/** PUT /:id — 更新状态或内容 */
router.put('/:id', async (req, res) => {
  try {
    const allowed = ['title', 'content', 'status', 'area', 'tags'];
    const updates = [];
    const params = [req.params.id];

    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        params.push(req.body[field]);
        updates.push(`${field} = $${params.length}`);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: '无可更新字段' });
    }

    params.push(new Date().toISOString());
    updates.push(`updated_at = $${params.length}`);

    const { rows } = await pool.query(
      `UPDATE design_docs SET ${updates.join(', ')} WHERE id = $1 RETURNING *`,
      params
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('[design-docs] PUT /:id error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
