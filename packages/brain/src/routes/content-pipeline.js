/**
 * Brain API: Content Pipeline
 *
 * GET  /api/brain/content-types         列出所有已注册内容类型
 * GET  /api/brain/pipelines             列出 content-pipeline 任务
 * POST /api/brain/pipelines             创建新 content-pipeline 任务
 */

import express from 'express';
import pool from '../db.js';
import { listContentTypes } from '../content-types/content-type-registry.js';

const router = express.Router();

/**
 * GET /content-types
 * 返回所有已注册内容类型名称数组
 */
router.get('/content-types', async (_req, res) => {
  try {
    const types = await listContentTypes();
    res.json(types);
  } catch (err) {
    console.error('[routes/content-pipeline] GET /content-types error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /
 * 列出 content-pipeline 任务，按 created_at 倒序，默认最近 50 条
 */
router.get('/', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const offset = parseInt(req.query.offset) || 0;

  try {
    const result = await pool.query(
      `SELECT id, title, status, priority, payload,
              created_at, started_at, completed_at, failed_at
       FROM tasks
       WHERE task_type = 'content-pipeline'
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[routes/content-pipeline] GET / error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /
 * 创建新 content-pipeline 任务
 *
 * Body:
 *   keyword      {string} 必填 — 内容关键词（如"字节跳动"）
 *   content_type {string} 必填 — 内容类型（如"solo-company-case"）
 *   priority     {string} 可选 — P0/P1/P2，默认 P1
 *   project_id   {string} 可选
 *   goal_id      {string} 可选
 */
router.post('/', async (req, res) => {
  const {
    keyword,
    content_type,
    priority = 'P1',
    project_id = null,
    goal_id = null,
  } = req.body || {};

  if (!keyword || typeof keyword !== 'string' || !keyword.trim()) {
    return res.status(400).json({ error: 'keyword 必填' });
  }
  if (!content_type || typeof content_type !== 'string' || !content_type.trim()) {
    return res.status(400).json({ error: 'content_type 必填' });
  }

  const validPriorities = ['P0', 'P1', 'P2'];
  if (!validPriorities.includes(priority)) {
    return res.status(400).json({ error: `priority 必须为 ${validPriorities.join('/')}` });
  }

  try {
    // 验证 content_type 存在
    const types = await listContentTypes();
    if (!types.includes(content_type)) {
      return res.status(400).json({
        error: `content_type "${content_type}" 不存在，已注册类型：${types.join(', ')}`,
      });
    }

    const result = await pool.query(
      `INSERT INTO tasks (title, description, task_type, status, priority,
                          project_id, goal_id, trigger_source, payload, created_at)
       VALUES ($1, $2, 'content-pipeline', 'queued', $3, $4, $5, $6, $7, NOW())
       RETURNING id, title, status, priority, payload, created_at`,
      [
        `[内容工厂] ${keyword} (${content_type})`,
        `内容工厂 Pipeline：关键词「${keyword}」，类型「${content_type}」。将由 tick 自动编排 content-research → content-generate → content-review → content-export 四个阶段。`,
        priority,
        project_id,
        goal_id,
        'content_pipeline_api',
        JSON.stringify({ keyword: keyword.trim(), content_type }),
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[routes/content-pipeline] POST / error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
