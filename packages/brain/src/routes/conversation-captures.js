/**
 * Conversation Captures 路由
 *
 * 捕获 Claude Code 会话摘要，实现跨对话持久记忆。
 * Stop Hook 会话结束时自动 POST，也可手动写入。
 *
 * GET  /api/brain/conversation-captures         — 列表（?limit=30&area=xxx&date=YYYY-MM-DD）
 * GET  /api/brain/conversation-captures/:id     — 详情
 * POST /api/brain/conversation-captures         — 新建（会话结束自动调用）
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

/**
 * GET /
 * 查询会话捕获列表
 */
router.get('/', async (req, res) => {
  try {
    const { limit = '30', area, date } = req.query;
    const params = [];
    const conditions = [];

    if (area) {
      params.push(area);
      conditions.push(`area = $${params.length}`);
    }
    if (date) {
      params.push(date);
      conditions.push(`session_date = $${params.length}`);
    }

    params.push(parseInt(limit, 10) || 30);
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT id, session_id, session_date, area, summary,
              key_decisions, key_insights, action_items,
              author, made_by, created_at
       FROM conversation_captures
       ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params
    );

    res.json({ success: true, data: result.rows, total: result.rows.length });
  } catch (err) {
    console.error('[conversation-captures] GET error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /:id
 * 查询单条会话捕获
 */
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM conversation_captures WHERE id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '记录不存在' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[conversation-captures] GET/:id error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /
 * 新建会话捕获（Stop Hook 或手动调用）
 * Body: { session_id, summary, area?, key_decisions?, key_insights?, action_items?, author?, made_by? }
 */
router.post('/', async (req, res) => {
  try {
    const {
      session_id,
      summary,
      area = null,
      key_decisions = [],
      key_insights = [],
      action_items = [],
      author = 'cecelia',
      made_by = 'cecelia',
    } = req.body;

    if (!session_id || !summary) {
      return res.status(400).json({ success: false, error: 'session_id 和 summary 为必填项' });
    }

    const result = await pool.query(
      `INSERT INTO conversation_captures
         (session_id, area, summary, key_decisions, key_insights, action_items, author, made_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, session_id, session_date, area, summary, author, made_by, created_at`,
      [session_id, area, summary, key_decisions, key_insights, action_items, author, made_by]
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[conversation-captures] POST error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
