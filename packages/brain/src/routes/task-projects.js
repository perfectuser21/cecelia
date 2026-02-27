/**
 * Task Projects route (migrated from apps/api/src/task-system/projects.js)
 *
 * GET /        — 列出所有项目（支持多种过滤参数）
 * GET /:id     — 获取单个 project（供 /decomp Phase 2 读取 Initiative/Project 信息）
 * PATCH /:id   — 更新 project 字段（status/description/name，供 /decomp 标记 Initiative 完成）
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

// GET /projects — 列出项目（支持 workspace_id, area_id, status, parent_id, kr_id, type, top_level 过滤）
router.get('/', async (req, res) => {
  try {
    const { workspace_id, area_id, status, parent_id, top_level, kr_id, type } = req.query;

    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (workspace_id) {
      conditions.push(`workspace_id = $${paramIndex++}`);
      params.push(workspace_id);
    }
    if (area_id) {
      conditions.push(`area_id = $${paramIndex++}`);
      params.push(area_id);
    }
    if (status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(status);
    }
    if (parent_id) {
      conditions.push(`parent_id = $${paramIndex++}`);
      params.push(parent_id);
    } else if (top_level === 'true') {
      conditions.push('parent_id IS NULL');
    }
    if (type) {
      conditions.push(`type = $${paramIndex++}`);
      params.push(type);
    }
    // kr_id 过滤：通过 project_kr_links 关联查询
    if (kr_id) {
      conditions.push(`id IN (SELECT project_id FROM project_kr_links WHERE kr_id = $${paramIndex++})`);
      params.push(kr_id);
    }

    let query = 'SELECT * FROM projects';
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list projects', details: err.message });
  }
});

// GET /projects/:id — 获取单个 project
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Project not found', id: req.params.id });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get project', details: err.message });
  }
});

// PATCH /projects/:id — 更新 project 字段（status / description / name）
router.patch('/:id', async (req, res) => {
  try {
    const { status, description, name } = req.body;

    const setClauses = [];
    const params = [];
    let paramIndex = 1;

    if (status !== undefined) {
      setClauses.push(`status = $${paramIndex++}`);
      params.push(status);
    }
    if (description !== undefined) {
      setClauses.push(`description = $${paramIndex++}`);
      params.push(description);
    }
    if (name !== undefined) {
      setClauses.push(`name = $${paramIndex++}`);
      params.push(name);
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    setClauses.push(`updated_at = NOW()`);
    params.push(req.params.id);

    const result = await pool.query(
      `UPDATE projects SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      params
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Project not found', id: req.params.id });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update project', details: err.message });
  }
});

export default router;
