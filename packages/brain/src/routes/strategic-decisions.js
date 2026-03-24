/**
 * Strategic Decisions 路由
 *
 * 服务 decisions 表中的战略决策（category/topic/decision/reason/status）
 * 区别于丘脑决策日志（/api/brain/decisions → brainRoutes）
 *
 * GET  /api/brain/strategic-decisions        — 列表（?status=active&limit=100）
 * POST /api/brain/strategic-decisions        — 新建决策
 * PUT  /api/brain/strategic-decisions/:id    — 更新状态/内容
 */

/* global console */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

/**
 * GET /
 * 查询战略决策列表
 * 支持 ?status=active|executed|expired&limit=100&category=xxx
 */
router.get('/', async (req, res) => {
  try {
    const { status, category, limit = '100' } = req.query;
    const params = [];
    const conditions = ['category IS NOT NULL'];

    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    if (category) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }

    params.push(parseInt(limit, 10) || 100);
    const where = `WHERE ${conditions.join(' AND ')}`;

    const result = await pool.query(
      `SELECT id, category, topic, decision, reason, status, confidence, executed_at, created_at, updated_at
       FROM decisions
       ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params
    );

    res.json({ success: true, data: result.rows, total: result.rows.length });
  } catch (err) {
    console.error('[strategic-decisions] GET error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /
 * 新建战略决策
 * Body: { category, topic, decision, reason, status? }
 */
router.post('/', async (req, res) => {
  try {
    const { category, topic, decision, reason, status = 'active' } = req.body;

    if (!topic || !decision) {
      return res.status(400).json({ success: false, error: 'topic 和 decision 为必填项' });
    }

    const result = await pool.query(
      `INSERT INTO decisions (category, topic, decision, reason, status, trigger)
       VALUES ($1, $2, $3, $4, $5, 'user')
       RETURNING id, category, topic, decision, reason, status, created_at`,
      [category || 'general', topic, decision, reason || null, status]
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[strategic-decisions] POST error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PUT /:id
 * 更新决策状态或内容
 * Body: { status?, reason?, decision? }
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reason, decision, executed_at } = req.body;

    const sets = [];
    const params = [];

    if (status !== undefined) {
      params.push(status);
      sets.push(`status = $${params.length}`);
    }
    if (reason !== undefined) {
      params.push(reason);
      sets.push(`reason = $${params.length}`);
    }
    if (decision !== undefined) {
      params.push(decision);
      sets.push(`decision = $${params.length}`);
    }
    if (executed_at !== undefined) {
      params.push(executed_at);
      sets.push(`executed_at = $${params.length}`);
    }

    if (sets.length === 0) {
      return res.status(400).json({ success: false, error: '没有可更新的字段' });
    }

    sets.push('updated_at = NOW()');
    params.push(id);

    const result = await pool.query(
      `UPDATE decisions SET ${sets.join(', ')} WHERE id = $${params.length}
       RETURNING id, category, topic, decision, reason, status, updated_at`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Decision not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[strategic-decisions] PUT error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
