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
import { classifyFailure as _classifyFailure } from '../quarantine.js';

const router = Router();

// classifyFailure 和 FAILURE_CLASS 懒加载（防测试 mock 不全导致初始化爆炸）
function classifyFailure(...args) {
  if (typeof _classifyFailure === 'function') return _classifyFailure(...args);
  return { class: 'task_error', retry_strategy: null };
}

// TTL 映射（毫秒）— 字符串字面量 key，不依赖 FAILURE_CLASS 枚举值
const TTL_MAP = {
  network: 5 * 60 * 1000,
  rate_limit: 10 * 60 * 1000,
  billing_cap: 30 * 60 * 1000,
  auth: 15 * 60 * 1000,
  resource: 5 * 60 * 1000,
};

// FAILURE_CLASS 内联常量（不从 quarantine.js 顶层 import 以避免 vitest mock 严格检查）
const FAILURE_CLASS = {
  NETWORK: 'network', RATE_LIMIT: 'rate_limit', BILLING_CAP: 'billing_cap',
  AUTH: 'auth', RESOURCE: 'resource', TASK_ERROR: 'task_error',
  SYSTEMIC: 'systemic', TASK_SPECIFIC: 'task_specific', UNKNOWN: 'unknown',
};

// POST /tasks — 创建新任务（供外部 agent 如 /architect 注册任务到 Brain 队列）
router.post('/', async (req, res) => {
  try {
    let {
      title,
      description = null,
      prd = null,
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
      ability_id = null,
      journey_id = null,
    } = req.body;

    if (!title || title.trim() === '') {
      return res.status(400).json({ error: 'title is required' });
    }

    // ─── C2: Schema normalize at entry point ────────────────────────
    // 1. PRD fallback: description > payload.prd_summary > prd
    //    上游创建者（Brain scheduler / talk / 人工 / 外部 API）把 PRD 写在不同字段。
    //    入口层统一收敛到 description，使 pre-flight 和下游消费者只看一个字段。
    //    优先级：显式 description > payload.prd_summary > 顶层 prd。
    if (!description && payload?.prd_summary) {
      description = payload.prd_summary;
    }
    if (!description && prd) {
      description = prd;
    }

    // 2. Priority normalize: semantic labels → P0/P1/P2
    //    拒绝完全未知的值（400），但接受常见语义标签。
    const PRIORITY_NORMALIZE_MAP = {
      urgent: 'P0', critical: 'P0',
      high: 'P1',
      normal: 'P2', medium: 'P2', low: 'P2',
    };
    const validPriorities = ['P0', 'P1', 'P2'];
    if (priority && !validPriorities.includes(priority)) {
      const mapped = PRIORITY_NORMALIZE_MAP[priority.toLowerCase?.()];
      if (mapped) {
        priority = mapped;
      } else {
        return res.status(400).json({
          error: `Invalid priority: ${priority}`,
          allowed: validPriorities,
          hint: 'Also accepts: urgent, critical, high, normal, medium, low',
        });
      }
    }
    // ─── end C2 ─────────────────────────────────────────────────────

    // ─── B1: executor 白名单 + 组合校验 ─────────────────────────────
    const executor = payload?.executor;
    const orchestrator = payload?.orchestrator;
    const mode = payload?.mode;
    if (executor !== undefined && executor !== null && executor !== 'claude' && executor !== 'codex') {
      return res.status(400).json({ error: 'executor must be claude or codex' });
    }
    if (executor === 'codex' && orchestrator !== 'skill-relay') {
      return res.status(400).json({ error: 'executor=codex requires orchestrator=skill-relay' });
    }
    // mode 白名单校验：缺省/headless/headed 合法；claude+headed 不支持
    if (mode !== undefined && mode !== null && !['headless', 'headed'].includes(mode)) {
      return res.status(400).json({ error: `mode must be headless or headed, got: ${mode}` });
    }
    if (executor === 'claude' && mode === 'headed') {
      return res.status(400).json({ error: 'executor=claude 不支持 mode=headed，headed 模式仅支持 executor=codex' });
    }
    // ─── end B1 ─────────────────────────────────────────────────────

    // 未提供 domain 时自动检测
    const domain = domainInput ?? detectDomain(`${title} ${description ?? ''}`).domain;

    // 顶层 journey_id 合并进 payload（支持调用方直接传 journey_id 而非嵌套在 payload 里）
    if (journey_id) {
      payload = { ...(payload ?? {}), journey_id };
    }

    // B51: harness_initiative 任务缺 journey_id 会导致 initiative_runs + Notion 游离，提前 warn
    const warnings = [];
    if (task_type === 'harness_initiative' && !(payload?.journey_id)) {
      warnings.push('journey_id missing in payload — initiative_run.journey_id will be null, Notion Project will be orphaned');
    }

    // C3: 服务端去重护栏（issue 655691d2）——title 精确匹配 + goal_id/project_id 一致
    // + 仍是活跃状态，命中则直接返回已有任务，不重新 INSERT。
    // 防止外部 agent/人工反复对同一意图重新注册 task（2026-07-09 实测 5 个重复 PR 的根因）。
    const dedupResult = await pool.query(
      `SELECT id, title, status, task_type, priority, project_id, area_id, goal_id, okr_initiative_id, ability_id, payload, created_at
       FROM tasks
       WHERE title = $1
         AND (goal_id IS NOT DISTINCT FROM $2)
         AND (project_id IS NOT DISTINCT FROM $3)
         AND status IN ('queued', 'in_progress')
       LIMIT 1`,
      [title.trim(), goal_id, project_id]
    );
    if (dedupResult.rows.length > 0) {
      return res.status(200).json({ ...dedupResult.rows[0], deduplicated: true });
    }

    const result = await pool.query(
      `INSERT INTO tasks (
         title, description, priority, task_type, status,
         project_id, area_id, goal_id, location,
         payload, trigger_source, domain, okr_initiative_id, ability_id
       )
       VALUES ($1, $2, $3, $4, 'queued', $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, title, status, task_type, priority, project_id, area_id, goal_id, okr_initiative_id, ability_id, payload, created_at`,
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
        ability_id,
      ]
    );

    const responseBody = result.rows[0];
    if (warnings.length > 0) responseBody.warnings = warnings;
    res.status(201).json(responseBody);
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
    const { status, area_id, project_id, task_type, journey_id, limit = '200', offset = '0' } = req.query;

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
    // journey_id 存于 payload JSONB（tasks 表无顶层 journey_id 列），不能当普通列名处理
    if (journey_id) {
      conditions.push(`payload->>'journey_id' = $${paramIndex++}`);
      params.push(journey_id);
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
    const { status, priority, title, okr_initiative_id, pr_url, result: taskResult } = req.body;

    // 状态机保护：已终止的任务不能回退到非终止状态
    const TERMINAL_STATUSES = ['completed', 'cancelled'];
    const _VALID_STATUSES = ['queued', 'in_progress', 'completed', 'cancelled', 'failed', 'blocked'];
    if (status !== undefined) {
      const current = await pool.query('SELECT status FROM tasks WHERE id = $1', [req.params.id]);
      if (!current.rows.length) {
        return res.status(404).json({ error: 'Task not found', id: req.params.id });
      }
      const currentStatus = current.rows[0].status;
      if (TERMINAL_STATUSES.includes(currentStatus) && !TERMINAL_STATUSES.includes(status)) {
        return res.status(409).json({
          error: 'State machine violation',
          details: `Cannot transition from terminal status '${currentStatus}' to '${status}'`,
        });
      }
    }

    const setClauses = [];
    const params = [];
    let paramIndex = 1;

    if (status !== undefined) {
      setClauses.push(`status = $${paramIndex++}`);
      params.push(status);
      // 自动设置时间戳
      if (status === 'in_progress') {
        setClauses.push(`started_at = COALESCE(started_at, NOW())`);
      }
      if (status === 'completed') {
        setClauses.push(`completed_at = COALESCE(completed_at, NOW())`);
      }
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
    if (pr_url !== undefined) {
      setClauses.push(`pr_url = $${paramIndex++}`);
      params.push(pr_url);
    }
    if (taskResult !== undefined) {
      setClauses.push(`success_metrics = $${paramIndex++}`);
      params.push(JSON.stringify(taskResult));
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

// POST /tasks/:id/claim — C1 atomic claim，防止并行 dispatch 重复派发
// 使用场景：外部 agent（如 autonomous pipeline）在开始处理前主动 claim。
// 返回 200 表示 claim 成功；返回 409 表示已被其他 runner claim。
router.post('/:id/claim', async (req, res) => {
  try {
    const { id } = req.params;
    const { claimer } = req.body || {};
    if (!claimer) {
      return res.status(400).json({ error: 'claimer is required' });
    }

    const result = await pool.query(
      `UPDATE tasks SET claimed_by = $1, claimed_at = NOW()
       WHERE id = $2 AND claimed_by IS NULL
       RETURNING id, claimed_by, claimed_at`,
      [claimer, id]
    );

    if (result.rows.length === 0) {
      // 已被其他 runner claim（或任务不存在）
      const existing = await pool.query(
        'SELECT claimed_by, claimed_at FROM tasks WHERE id = $1',
        [id]
      );
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Task not found', id });
      }
      return res.status(409).json({
        error: 'Task already claimed',
        claimed_by: existing.rows[0].claimed_by,
        claimed_at: existing.rows[0].claimed_at,
      });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to claim task', details: err.message });
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
