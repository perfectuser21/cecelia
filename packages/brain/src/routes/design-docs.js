/**
 * design-docs 路由 — 设计文档 API
 *
 * GET    /api/brain/design-docs          列表
 * GET    /api/brain/design-docs/:id      单条
 * POST   /api/brain/design-docs          创建
 * PATCH  /api/brain/design-docs/:id      更新
 * DELETE /api/brain/design-docs/:id      归档（软删除）
 */

/* global console */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

/** GET /design-docs — 列表 */
router.get('/design-docs', async (req, res) => {
  try {
    const { doc_type, status = 'active', limit = '50' } = req.query;
    const params = [];
    const conditions = [];

    if (doc_type) {
      params.push(doc_type);
      conditions.push(`doc_type = $${params.length}`);
    }
    if (status !== 'all') {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    params.push(Math.min(parseInt(limit, 10) || 50, 200));
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT id, title, doc_type, tags, status, created_by, created_at, updated_at,
              LEFT(content, 300) AS content_preview
       FROM design_docs
       ${where}
       ORDER BY updated_at DESC
       LIMIT $${params.length}`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[design-docs] GET /design-docs error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** GET /design-docs/:id — 单条（含完整 content） */
router.get('/design-docs/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM design_docs WHERE id = $1',
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[design-docs] GET /design-docs/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** POST /design-docs — 创建 */
router.post('/design-docs', async (req, res) => {
  try {
    const {
      title, content = '', doc_type = 'design',
      tags = [], status = 'active', created_by = 'system'
    } = req.body;

    if (!title) return res.status(400).json({ error: 'title is required' });

    const result = await pool.query(
      `INSERT INTO design_docs (title, content, doc_type, tags, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [title, content, doc_type, tags, status, created_by]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[design-docs] POST /design-docs error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** PATCH /design-docs/:id — 更新 */
router.patch('/design-docs/:id', async (req, res) => {
  try {
    const { title, content, doc_type, tags, status } = req.body;
    const sets = [];
    const params = [];

    if (title !== undefined)    { params.push(title);    sets.push(`title = $${params.length}`); }
    if (content !== undefined)  { params.push(content);  sets.push(`content = $${params.length}`); }
    if (doc_type !== undefined) { params.push(doc_type); sets.push(`doc_type = $${params.length}`); }
    if (tags !== undefined)     { params.push(tags);     sets.push(`tags = $${params.length}`); }
    if (status !== undefined)   { params.push(status);   sets.push(`status = $${params.length}`); }

    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });

    sets.push(`updated_at = NOW()`);
    params.push(req.params.id);

    const result = await pool.query(
      `UPDATE design_docs SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[design-docs] PATCH /design-docs/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /design-docs/:id — 软删除（归档） */
router.delete('/design-docs/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE design_docs SET status = 'archived', updated_at = NOW()
       WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ archived: true, id: req.params.id });
  } catch (err) {
    console.error('[design-docs] DELETE /design-docs/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
