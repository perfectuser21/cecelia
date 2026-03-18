/**
 * Task Goals route
 *
 * GET /        — 列出所有目标（支持 type, status, parent_id, area_id, limit, offset 过滤）
 * GET /audit   — KR 进度审计：比较 stated_progress vs initiative 实际完成率
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

// GET /goals/audit — KR 进度审计
router.get('/audit', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        g.id,
        g.title,
        g.type,
        g.status,
        g.progress AS stated_progress,
        COUNT(p.id) AS total_initiatives,
        COUNT(p.id) FILTER (WHERE p.status = 'completed') AS completed_initiatives,
        CASE
          WHEN COUNT(p.id) = 0 THEN NULL
          ELSE ROUND(COUNT(p.id) FILTER (WHERE p.status = 'completed') * 100.0 / COUNT(p.id))
        END AS actual_progress
      FROM goals g
      LEFT JOIN projects p ON p.kr_id = g.id AND p.type = 'initiative'
      WHERE g.type IN ('area_okr', 'kr')
      GROUP BY g.id, g.title, g.type, g.status, g.progress
      ORDER BY g.progress DESC, g.title
    `);

    const rows = result.rows.map(r => ({
      id: r.id,
      title: r.title,
      type: r.type,
      status: r.status,
      stated_progress: r.stated_progress,
      actual_progress: r.actual_progress !== null ? Number(r.actual_progress) : null,
      total_initiatives: Number(r.total_initiatives),
      completed_initiatives: Number(r.completed_initiatives),
      discrepancy: r.actual_progress !== null
        ? r.stated_progress - Number(r.actual_progress)
        : null,
    }));

    const summary = {
      total_goals: rows.length,
      overstated: rows.filter(r => r.discrepancy !== null && r.discrepancy > 10).length,
      no_initiatives: rows.filter(r => r.total_initiatives === 0).length,
      accurate: rows.filter(r => r.discrepancy !== null && Math.abs(r.discrepancy) <= 10).length,
    };

    res.json({ summary, goals: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to audit goals', details: err.message });
  }
});

// GET /goals/:id — 获取单个 goal（返回 intent-expand 所需字段）
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const result = await pool.query(
    'SELECT id, type, title, description, parent_id, project_id FROM goals WHERE id = $1',
    [id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'goal not found' });
  res.json(result.rows[0]);
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
