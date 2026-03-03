/**
 * Task Goals route
 *
 * GET /        — 列出所有目标（支持 type, status, parent_id, area_id, limit, offset 过滤）
 * GET /:id     — 获取单个 goal
 * PATCH /:id   — 更新 goal 字段（title, status, priority, progress, weight, area_id, custom_props）
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

// GET /goals — 列出目标（支持多种过滤）
router.get('/', async (req, res) => {
  try {
    const { type, status, parent_id, area_id, limit, offset } = req.query;

    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (type) {
      conditions.push(`type = $${paramIndex++}`);
      params.push(type);
    }
    if (status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(status);
    }
    if (parent_id) {
      conditions.push(`parent_id = $${paramIndex++}`);
      params.push(parent_id);
    }
    if (area_id) {
      conditions.push(`area_id = $${paramIndex++}`);
      params.push(area_id);
    }

    let query = 'SELECT * FROM goals';
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY created_at DESC';

    if (limit) {
      query += ` LIMIT $${paramIndex++}`;
      params.push(parseInt(limit, 10));
    }
    if (offset) {
      query += ` OFFSET $${paramIndex++}`;
      params.push(parseInt(offset, 10));
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list goals', details: err.message });
  }
});

// GET /goals/:id — 获取单个 goal
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM goals WHERE id = $1', [req.params.id]);
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Goal not found', id: req.params.id });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get goal', details: err.message });
  }
});

// PATCH /goals/:id — 更新 goal 字段
router.patch('/:id', async (req, res) => {
  try {
    const { title, status, priority, progress, weight, area_id, custom_props } = req.body;

    const setClauses = [];
    const params = [];
    let paramIndex = 1;

    if (title !== undefined) {
      setClauses.push(`title = $${paramIndex++}`);
      params.push(title);
    }
    if (status !== undefined) {
      setClauses.push(`status = $${paramIndex++}`);
      params.push(status);
    }
    if (priority !== undefined) {
      setClauses.push(`priority = $${paramIndex++}`);
      params.push(priority);
    }
    if (progress !== undefined) {
      setClauses.push(`progress = $${paramIndex++}`);
      params.push(progress);
    }
    if (weight !== undefined) {
      setClauses.push(`weight = $${paramIndex++}`);
      params.push(weight);
    }
    if (area_id !== undefined) {
      setClauses.push(`area_id = $${paramIndex++}`);
      params.push(area_id);
    }
    if (custom_props !== undefined) {
      setClauses.push(`custom_props = custom_props || $${paramIndex++}::jsonb`);
      params.push(JSON.stringify(custom_props));
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    setClauses.push(`updated_at = NOW()`);
    params.push(req.params.id);

    const result = await pool.query(
      `UPDATE goals SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      params
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Goal not found', id: req.params.id });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update goal', details: err.message });
  }
});

export default router;
