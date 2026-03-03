/**
 * Task Areas route — 对应 areas 表（生活/工作领域分类）
 *
 * GET /    — 列出所有 areas（默认过滤 archived=false）
 * GET /:id — 获取单个 area
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

// GET /areas — 列出 areas（默认排除已归档）
router.get('/', async (req, res) => {
  try {
    const { domain, archived } = req.query;

    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (domain) {
      conditions.push(`domain = $${paramIndex++}`);
      params.push(domain);
    }
    // 默认只返回未归档，除非明确传 archived=true 或 all
    if (archived === 'true') {
      conditions.push(`archived = true`);
    } else if (archived !== 'all') {
      conditions.push(`archived = false`);
    }

    let query = 'SELECT * FROM areas';
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY created_at ASC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list areas', details: err.message });
  }
});

// GET /areas/:id — 获取单个 area
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM areas WHERE id = $1', [req.params.id]);
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Area not found', id: req.params.id });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get area', details: err.message });
  }
});

export default router;
