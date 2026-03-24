/**
 * user-annotations 路由 — 用户批注 API
 *
 * GET    /api/brain/user-annotations          列表
 * GET    /api/brain/user-annotations/:id      单条
 * POST   /api/brain/user-annotations          创建
 * PATCH  /api/brain/user-annotations/:id      更新
 * DELETE /api/brain/user-annotations/:id      删除
 */

/* global console */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

/** GET /user-annotations — 列表 */
router.get('/user-annotations', async (req, res) => {
  try {
    const { annotation_type, subject_type, subject_id, limit = '50' } = req.query;
    const params = [];
    const conditions = [];

    if (annotation_type) {
      params.push(annotation_type);
      conditions.push(`annotation_type = $${params.length}`);
    }
    if (subject_type) {
      params.push(subject_type);
      conditions.push(`subject_type = $${params.length}`);
    }
    if (subject_id) {
      params.push(subject_id);
      conditions.push(`subject_id = $${params.length}`);
    }

    params.push(Math.min(parseInt(limit, 10) || 50, 200));
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT id, subject_type, subject_id, content, tags, annotation_type,
              diary_date, created_at, updated_at
       FROM user_annotations
       ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[user-annotations] GET /user-annotations error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** GET /user-annotations/:id — 单条 */
router.get('/user-annotations/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM user_annotations WHERE id = $1',
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[user-annotations] GET /user-annotations/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** POST /user-annotations — 创建 */
router.post('/user-annotations', async (req, res) => {
  try {
    const {
      subject_type, subject_id, content,
      tags = [], annotation_type = 'note', diary_date
    } = req.body;

    if (!content) return res.status(400).json({ error: 'content is required' });

    const result = await pool.query(
      `INSERT INTO user_annotations
         (subject_type, subject_id, content, tags, annotation_type, diary_date)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (diary_date) WHERE annotation_type = 'daily_diary'
       DO UPDATE SET content = EXCLUDED.content, updated_at = NOW()
       RETURNING *`,
      [
        subject_type || null,
        subject_id || null,
        content,
        tags,
        annotation_type,
        diary_date || null
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[user-annotations] POST /user-annotations error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** PATCH /user-annotations/:id — 更新 */
router.patch('/user-annotations/:id', async (req, res) => {
  try {
    const { content, tags, annotation_type } = req.body;
    const sets = [];
    const params = [];

    if (content !== undefined)         { params.push(content);         sets.push(`content = $${params.length}`); }
    if (tags !== undefined)            { params.push(tags);            sets.push(`tags = $${params.length}`); }
    if (annotation_type !== undefined) { params.push(annotation_type); sets.push(`annotation_type = $${params.length}`); }

    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });

    sets.push(`updated_at = NOW()`);
    params.push(req.params.id);

    const result = await pool.query(
      `UPDATE user_annotations SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[user-annotations] PATCH /user-annotations/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /user-annotations/:id — 物理删除 */
router.delete('/user-annotations/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM user_annotations WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true, id: req.params.id });
  } catch (err) {
    console.error('[user-annotations] DELETE /user-annotations/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
