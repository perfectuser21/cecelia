import { Router } from 'express';
import pool from './db.js';

const router = Router();

// GET /api/capture-atoms — 列表查询
router.get('/', async (req, res) => {
  try {
    const { status, target_type, capture_id, limit = 50, offset = 0 } = req.query;
    const conditions = [];
    const values = [];

    if (status) {
      values.push(status);
      conditions.push(`status = $${values.length}`);
    }
    if (target_type) {
      values.push(target_type);
      conditions.push(`target_type = $${values.length}`);
    }
    if (capture_id) {
      values.push(capture_id);
      conditions.push(`capture_id = $${values.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    values.push(parseInt(limit, 10) || 50);
    values.push(parseInt(offset, 10) || 0);

    const { rows } = await pool.query(
      `SELECT * FROM capture_atoms ${where} ORDER BY created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    res.json(rows);
  } catch (err) {
    console.error('[capture-atoms] GET error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/capture-atoms/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM capture_atoms WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/capture-atoms — 创建 atom
router.post('/', async (req, res) => {
  try {
    const { capture_id, content, target_type, target_subtype, suggested_area_id, confidence, ai_reason } = req.body;
    if (!content || !target_type) {
      return res.status(400).json({ error: 'content and target_type are required' });
    }

    const { rows } = await pool.query(
      `INSERT INTO capture_atoms (capture_id, content, target_type, target_subtype, suggested_area_id, confidence, ai_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [capture_id || null, content, target_type, target_subtype || null, suggested_area_id || null, confidence || 0, ai_reason || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[capture-atoms] POST error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/capture-atoms/:id — 确认/驳回/修改
router.patch('/:id', async (req, res) => {
  try {
    const { action, target_type, target_subtype, suggested_area_id, routed_to_table, routed_to_id } = req.body;

    if (action === 'confirm') {
      const { rows } = await pool.query(
        `UPDATE capture_atoms SET status = 'confirmed', routed_to_table = $2, routed_to_id = $3, updated_at = now()
         WHERE id = $1 RETURNING *`,
        [req.params.id, routed_to_table || null, routed_to_id || null]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
      return res.json(rows[0]);
    }

    if (action === 'dismiss') {
      const { rows } = await pool.query(
        `UPDATE capture_atoms SET status = 'dismissed', updated_at = now() WHERE id = $1 RETURNING *`,
        [req.params.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
      return res.json(rows[0]);
    }

    // 普通更新（修改类型等）
    const updates = [];
    const values = [req.params.id];
    if (target_type) { values.push(target_type); updates.push(`target_type = $${values.length}`); }
    if (target_subtype !== undefined) { values.push(target_subtype); updates.push(`target_subtype = $${values.length}`); }
    if (suggested_area_id !== undefined) { values.push(suggested_area_id); updates.push(`suggested_area_id = $${values.length}`); }
    updates.push('updated_at = now()');

    const { rows } = await pool.query(
      `UPDATE capture_atoms SET ${updates.join(', ')} WHERE id = $1 RETURNING *`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[capture-atoms] PATCH error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
