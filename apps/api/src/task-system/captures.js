import { Router } from 'express';
import pool from './db.js';

const router = Router();

// GET /api/captures — 列表查询
// 支持 ?status=inbox|processing|done|archived&source=&limit=&offset=
router.get('/', async (req, res) => {
  try {
    const { status, source, owner, limit = 50, offset = 0 } = req.query;
    const conditions = [];
    const values = [];

    if (status) {
      values.push(status);
      conditions.push(`status = $${values.length}`);
    }
    if (source) {
      values.push(source);
      conditions.push(`source = $${values.length}`);
    }
    if (owner) {
      values.push(owner);
      conditions.push(`owner = $${values.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    values.push(parseInt(limit, 10) || 50);
    values.push(parseInt(offset, 10) || 0);

    const sql = `
      SELECT id, content, source, status, area_id, project_id, extracted_to, owner, created_at, updated_at
      FROM captures
      ${where}
      ORDER BY created_at DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}
    `;

    const result = await pool.query(sql, values);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list captures', details: err.message });
  }
});

// GET /api/captures/:id — 单条查询
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM captures WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Capture not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get capture', details: err.message });
  }
});

// POST /api/captures — 创建
router.post('/', async (req, res) => {
  try {
    const { content, source = 'dashboard', area_id, project_id, owner = 'user' } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'content is required' });
    }

    const result = await pool.query(
      `INSERT INTO captures (content, source, area_id, project_id, owner)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [content.trim(), source, area_id || null, project_id || null, owner]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create capture', details: err.message });
  }
});

// PATCH /api/captures/:id — 更新
router.patch('/:id', async (req, res) => {
  try {
    const { status, area_id, project_id, extracted_to } = req.body;
    const fields = [];
    const values = [];

    if (status !== undefined) {
      values.push(status);
      fields.push(`status = $${values.length}`);
    }
    if (area_id !== undefined) {
      values.push(area_id || null);
      fields.push(`area_id = $${values.length}`);
    }
    if (project_id !== undefined) {
      values.push(project_id || null);
      fields.push(`project_id = $${values.length}`);
    }
    if (extracted_to !== undefined) {
      values.push(JSON.stringify(extracted_to));
      fields.push(`extracted_to = $${values.length}`);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(req.params.id);
    const result = await pool.query(
      `UPDATE captures SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Capture not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update capture', details: err.message });
  }
});

// DELETE /api/captures/:id — 软删除（归档）
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE captures SET status = 'archived' WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Capture not found' });
    }
    res.json({ id: result.rows[0].id, status: 'archived' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to archive capture', details: err.message });
  }
});

export default router;
