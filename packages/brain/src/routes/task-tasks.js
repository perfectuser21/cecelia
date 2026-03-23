/**
 * Task Tasks route — 对应 tasks 表（Cecelia 执行任务）
 *
 * POST /   — 创建新任务（供 /architect Phase 5 和外部 agent 注册任务）
 * GET /    — 列出任务（支持 status, area_id, project_id, task_type, limit 过滤）
 * GET /:id — 获取单个 task
 * PATCH /:id — 更新 status/priority/title/okr_initiative_id
 */

import { Router } from 'express';
import pool from '../db.js';
import { detectDomain } from '../domain-detector.js';
import { blockTask } from '../task-updater.js';
import { classifyFailure, FAILURE_CLASS } from '../quarantine.js';

const router = Router();

// TTL 映射（毫秒）
const TTL_MAP = {
  [FAILURE_CLASS.NETWORK]: 5 * 60 * 1000,      // 5 分钟
  [FAILURE_CLASS.RATE_LIMIT]: 10 * 60 * 1000, // 10 分钟
  [FAILURE_CLASS.BILLING_CAP]: 30 * 60 * 1000, // 30 分钟
  [FAILURE_CLASS.AUTH]: 15 * 60 * 1000,       // 15 分钟
  [FAILURE_CLASS.RESOURCE]: 5 * 60 * 1000,     // 5 分钟
};

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
      location = 'us',
      payload = null,
      metadata = null,
      trigger_source = 'auto',
      domain: domainInput = null,
      okr_initiative_id = null,
    } = req.body;

    if (!title || title.trim() === '') {
      return res.status(400).json({ error: 'title is required' });
    }

    // 未提供 domain 时自动检测
    const domain = domainInput ?? detectDomain(`${title} ${description ?? ''}`).domain;

    const result = await pool.query(
      `INSERT INTO tasks (
         title, description, priority, task_type, status,
         project_id, area_id, goal_id, location,
         payload, trigger_source, domain, okr_initiative_id
       )
       VALUES ($1, $2, $3, $4, 'queued', $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, title, status, task_type, priority, project_id, area_id, goal_id, okr_initiative_id, created_at`,
      [
        title.trim(),
        description,
        priority,
        task_type,
        project_id,
        area_id,
        goal_id,
        location,
        (payload ?? metadata) ? JSON.stringify(payload ?? metadata) : null,
        trigger_source,
        domain,
        okr_initiative_id,
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
    const { status, priority, title, okr_initiative_id } = req.body;

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
    if (okr_initiative_id !== undefined) {
      setClauses.push(`okr_initiative_id = $${paramIndex++}`);
      params.push(okr_initiative_id);
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

// POST /tasks/:id/error-report — 错误上报端点
// 根据错误分类自动决定处理方式：blocked（瞬时错误）/ retry（可重试）/ quarantine（永久错误）
router.post('/:id/error-report', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      error_type,
      error_message,
      stack_trace,
      context = {}
    } = req.body;

    if (!error_message) {
      return res.status(400).json({ error: 'error_message is required' });
    }

    console.log(`[error-report] Received error report for task ${id}: ${error_message.substring(0, 100)}`);

    // 1. 获取任务当前状态
    const taskResult = await pool.query(
      'SELECT id, title, status, payload FROM tasks WHERE id = $1',
      [id]
    );

    if (taskResult.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found', id });
    }

    const task = taskResult.rows[0];

    // 2. 分类错误
    const classification = classifyFailure(error_message, task);

    console.log(`[error-report] Task ${id} classified as: ${classification.class}`);

    // 3. 根据分类决定处理方式
    const ttlMs = TTL_MAP[classification.class];
    const isTransient = ttlMs !== undefined;

    if (isTransient) {
      // 瞬时错误 → 标记为 blocked（等待 TTL 自动释放）
      const blockedUntil = new Date(Date.now() + ttlMs).toISOString();
      const detail = {
        error_type: error_type || classification.class,
        error_message,
        stack_trace,
        context,
        failure_classification: classification,
      };

      await blockTask(id, {
        reason: `${classification.class} error - auto-blocked`,
        detail,
        until: blockedUntil,
      });

      console.log(`[error-report] Task ${id} blocked until ${blockedUntil}`);

      return res.json({
        action: 'blocked',
        task_id: id,
        failure_class: classification.class,
        blocked_until: blockedUntil,
        reason: classification.retry_strategy?.reason || 'Transient error',
      });

    } else if (classification.class === FAILURE_CLASS.TASK_ERROR) {
      // 可重试错误 → 正常失败计数，由 execution-callback 的重试逻辑处理
      await pool.query(
        `UPDATE tasks SET status = 'failed', updated_at = NOW(),
         payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb
         WHERE id = $1`,
        [id, JSON.stringify({
          error_details: error_message,
          failure_classification: classification,
          last_error_at: new Date().toISOString(),
        })]
      );

      console.log(`[error-report] Task ${id} marked as failed (retryable)`);

      return res.json({
        action: 'failed',
        task_id: id,
        failure_class: classification.class,
        reason: classification.retry_strategy?.reason || 'Task error - retryable',
      });

    } else {
      // 永久错误（其他未知类型）→ 移入 quarantine
      const { quarantineTask } = await import('../quarantine.js');
      await quarantineTask(id, 'permanent_error', {
        failure_class: classification.class,
        error_message,
        stack_trace,
        context,
      });

      console.log(`[error-report] Task ${id} quarantined`);

      return res.json({
        action: 'quarantined',
        task_id: id,
        failure_class: classification.class,
        reason: 'Permanent error - requires human review',
      });
    }
  } catch (err) {
    console.error(`[error-report] Error processing error report:`, err.message);
    res.status(500).json({ error: 'Failed to process error report', details: err.message });
  }
});

export default router;
