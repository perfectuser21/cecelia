/**
 * Knowledge 路由 — 知识库查询 API
 *
 * GET /api/brain/knowledge
 *   查询参数：type（过滤类型，如 learning_rule）
 *   返回：knowledge 条目列表
 */

/* global console */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

/**
 * GET /
 * 查询 knowledge 表条目
 * 支持 ?type=learning_rule 过滤
 */
router.get('/', async (req, res) => {
  try {
    const { type, limit = '200' } = req.query;
    const params = [];
    let where = '';

    if (type) {
      params.push(type);
      where = `WHERE type = $${params.length}`;
    }

    params.push(parseInt(limit, 10) || 200);
    const limitClause = `LIMIT $${params.length}`;

    const result = await pool.query(
      `SELECT id, name, type, status, sub_area, content, created_at
       FROM knowledge
       ${where}
       ORDER BY created_at DESC
       ${limitClause}`,
      params
    );

    res.json(result.rows);
  } catch (err) {
    console.error('[API] knowledge GET error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
