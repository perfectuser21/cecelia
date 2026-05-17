import { Router } from 'express';
import pool from './db.js';

const router = Router();

// GET /api/events — 列表查询
router.get('/', async (req, res) => {
  try {
    const { event_type, area_id, limit = 50, offset = 0 } = req.query;
    const conditions = [];
    const values = [];

    if (event_type) {
      values.push(event_type);
      conditions.push(`event_type = $${values.length}`);
    }
    if (area_id) {
      values.push(area_id);
      conditions.push(`area_id = $${values.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    values.push(parseInt(limit, 10) || 50);
    values.push(parseInt(offset, 10) || 0);

    const { rows } = await pool.query(
      `SELECT * FROM life_events ${where} ORDER BY date DESC NULLS LAST, created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    res.json(rows);
  } catch (err) {
    console.error('[life-events] GET error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/events/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM life_events WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/events — 创建事件
router.post('/', async (req, res) => {
  try {
    const { name, date, event_type, location, people, description, area_id, capture_atom_id } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const { rows } = await pool.query(
      `INSERT INTO life_events (name, date, event_type, location, people, description, area_id, capture_atom_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [name, date || null, event_type || null, location || null, people || null, description || null, area_id || null, capture_atom_id || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[life-events] POST error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/events/:id — 更新事件
router.patch('/:id', async (req, res) => {
  try {
    const { name, date, event_type, location, people, description, area_id } = req.body;
    const updates = [];
    const values = [req.params.id];

    if (name) { values.push(name); updates.push(`name = $${values.length}`); }
    if (date !== undefined) { values.push(date); updates.push(`date = $${values.length}`); }
    if (event_type !== undefined) { values.push(event_type); updates.push(`event_type = $${values.length}`); }
    if (location !== undefined) { values.push(location); updates.push(`location = $${values.length}`); }
    if (people !== undefined) { values.push(people); updates.push(`people = $${values.length}`); }
    if (description !== undefined) { values.push(description); updates.push(`description = $${values.length}`); }
    if (area_id !== undefined) { values.push(area_id); updates.push(`area_id = $${values.length}`); }
    updates.push('updated_at = now()');

    if (updates.length <= 1) return res.status(400).json({ error: 'No fields to update' });

    const { rows } = await pool.query(
      `UPDATE life_events SET ${updates.join(', ')} WHERE id = $1 RETURNING *`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[life-events] PATCH error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
