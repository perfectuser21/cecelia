/**
 * Task Tasks route — 对应 tasks 表（Cecelia 执行任务）
 *
 * POST /   — 创建新任务（供 /architect Phase 5 和外部 agent 注册任务）
 * GET /    — 列出任务（支持 status, area_id, project_id, task_type, limit 过滤）
 * GET /:id — 获取单个 task
 * PATCH /:id — 更新 status/priority/title
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

// POST /tasks — 创建新任务（供外部 agent 如 /architect 注册任务到 Brain 队列）
router.post('/', async (req, res) => {
  try {
    const {
      title,
      description = null,
      priority = 'P2',
      task_type = 'dev',
      project_id = null,
      area_id = null,
      goal_id = null,
      location = null,
      metadata = null,
      trigger_source = 'api',
    } = req.body;

    if (!title || title.trim() === '') {
      return res.status(400).json({ error: 'title is required' });
    }

    const result = await pool.query(
      `INSERT INTO tasks (
         title, description, priority, task_type, status,
         project_id, area_id, goal_id, location,
         payload, trigger_source
       )
       VALUES ($1, $2, $3, $4, 'queued', $5, $6, $7, $8, $9, $10)
       RETURNING id, title, status, task_type, priority, project_id, area_id, goal_id, created_at`,
      [
        title.trim(),
        description,
        priority,
        task_type,
        project_id,
        area_id,
        goal_id,
        location,
        metadata ? JSON.stringify(metadata) : null,
        trigger_source,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23514') {
      return res.status(400).json({ error: 'Invalid field value', details: err.message });
    }
    res.status(500).json({ error: 'Failed to create task', details: err.message });
  }
});

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
