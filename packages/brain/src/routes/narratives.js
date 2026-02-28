/**
 * Narratives 路由 — Cecelia 日记 API
 *
 * GET /api/brain/narratives
 *   返回：Cecelia 写的叙事日记（source_type='narrative'）
 *   Query params:
 *     limit - 返回条数（默认 20，最大 100）
 */

/* global console */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

/**
 * GET /
 * 返回 Cecelia 的日记列表
 */
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    const result = await pool.query(`
      SELECT id, content, created_at
      FROM memory_stream
      WHERE source_type = 'narrative'
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);

    const narratives = result.rows.map(row => {
      // content 存储为 JSON 字符串 {"text":"...","model":"...","elapsed_ms":...}
      let parsed = {};
      try {
        parsed = typeof row.content === 'string' ? JSON.parse(row.content) : row.content;
      } catch {
        parsed = { text: row.content };
      }
      return {
        id: row.id,
        text: parsed.text || '',
        model: parsed.model || null,
        created_at: row.created_at,
      };
    });

    res.json(narratives);
  } catch (err) {
    console.error('[API] narratives error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
