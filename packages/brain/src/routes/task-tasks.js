/**
 * Task Tasks route — 对应 tasks 表（Cecelia 执行任务）
 *
 * GET /    — 列出任务（支持 status, area_id, project_id, task_type, limit 过滤）
 * GET /:id — 获取单个 task
 * PATCH /:id — 更新 status/priority/title
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

// GET /tasks — 列出任务
router.get('/', async (req, res) => {
  try {
    const { status, area_id, project_id, task_type, limit = '200', offset = '0' } = req.query;

    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(status);
    }
    if (area_id) {
      conditions.push(`area_id = $${paramIndex++}`);
      params.push(area_id);
    }
    if (project_id) {
      conditions.push(`project_id = $${paramIndex++}`);
      params.push(project_id);
    }
    if (task_type) {
      conditions.push(`task_type = $${paramIndex++}`);
      params.push(task_type);
    }

    let query = 'SELECT id, title, status, priority, task_type, project_id, area_id, created_at, completed_at, updated_at FROM tasks';
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list tasks', details: err.message });
  }
});

// GET /tasks/:id — 获取单个 task
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM tasks WHERE id = $1',
      [req.params.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Task not found', id: req.params.id });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get task', details: err.message });
  }
});

// PATCH /tasks/:id — 更新 task 字段
router.patch('/:id', async (req, res) => {
  try {
    const { status, priority, title } = req.body;

    const setClauses = [];
    const params = [];
    let paramIndex = 1;

    if (status !== undefined) {
      setClauses.push(`status = $${paramIndex++}`);
      params.push(status);
    }
    if (priority !== undefined) {
      setClauses.push(`priority = $${paramIndex++}`);
      params.push(priority);
    }
    if (title !== undefined) {
      setClauses.push(`title = $${paramIndex++}`);
      params.push(title);
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    setClauses.push(`updated_at = NOW()`);
    params.push(req.params.id);

    const result = await pool.query(
      `UPDATE tasks SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      params
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Task not found', id: req.params.id });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update task', details: err.message });
  }
});

export default router;
