/**
 * Alex Pages Routes
 *
 * 用户知识页面 CRUD API，对应 alex_pages 表。
 *
 * GET  /api/brain/alex-pages          — 列表（支持 area, project, page_type, tags 过滤）
 * POST /api/brain/alex-pages          — 创建页面
 * GET  /api/brain/alex-pages/:id      — 获取单个页面
 * PATCH /api/brain/alex-pages/:id     — 更新页面
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

// GET / — 列出页面（支持多条件过滤）
router.get('/', async (req, res) => {
  try {
    const { area, project, page_type, tags, limit = '100', offset = '0' } = req.query;

    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (area) {
      conditions.push(`area = $${paramIndex++}`);
      params.push(area);
    }
    if (project) {
      conditions.push(`project = $${paramIndex++}`);
      params.push(project);
    }
    if (page_type) {
      conditions.push(`page_type = $${paramIndex++}`);
      params.push(page_type);
    }
    if (tags) {
      // 支持逗号分隔的多个 tag，匹配包含任一 tag 的页面
      const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
      if (tagList.length > 0) {
        conditions.push(`tags && $${paramIndex++}::text[]`);
        params.push(tagList);
      }
    }

    let query = `
      SELECT id, title, content_json, area, project, tags, page_type, created_at, updated_at
      FROM alex_pages
    `;
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[alex-pages] GET / error:', err.message);
    res.status(500).json({ error: 'Failed to list alex_pages', details: err.message });
  }
});

// POST / — 创建页面
router.post('/', async (req, res) => {
  try {
    const { title, content_json = {}, area, project, tags = [], page_type = 'note' } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }

    const result = await pool.query(
      `INSERT INTO alex_pages (title, content_json, area, project, tags, page_type)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [title, JSON.stringify(content_json), area || null, project || null, tags, page_type]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[alex-pages] POST / error:', err.message);
    res.status(500).json({ error: 'Failed to create alex_page', details: err.message });
  }
});

// GET /:id — 获取单个页面
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM alex_pages WHERE id = $1',
      [req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Page not found', id: req.params.id });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[alex-pages] GET /:id error:', err.message);
    res.status(500).json({ error: 'Failed to get alex_page', details: err.message });
  }
});

// PATCH /:id — 更新页面
router.patch('/:id', async (req, res) => {
  try {
    const { title, content_json, area, project, tags, page_type } = req.body;

    const setClauses = [];
    const params = [];
    let paramIndex = 1;

    if (title !== undefined) {
      setClauses.push(`title = $${paramIndex++}`);
      params.push(title);
    }
    if (content_json !== undefined) {
      setClauses.push(`content_json = $${paramIndex++}`);
      params.push(JSON.stringify(content_json));
    }
    if (area !== undefined) {
      setClauses.push(`area = $${paramIndex++}`);
      params.push(area);
    }
    if (project !== undefined) {
      setClauses.push(`project = $${paramIndex++}`);
      params.push(project);
    }
    if (tags !== undefined) {
      setClauses.push(`tags = $${paramIndex++}`);
      params.push(tags);
    }
    if (page_type !== undefined) {
      setClauses.push(`page_type = $${paramIndex++}`);
      params.push(page_type);
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    setClauses.push(`updated_at = NOW()`);
    params.push(req.params.id);

    const result = await pool.query(
      `UPDATE alex_pages SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      params
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Page not found', id: req.params.id });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[alex-pages] PATCH /:id error:', err.message);
    res.status(500).json({ error: 'Failed to update alex_page', details: err.message });
  }
});

export default router;
