/**
 * Task Tasks route — 对应 tasks 表（Cecelia 执行任务）
 *
 * POST /   — 创建新任务（供 /architect Phase 5 和外部 agent 注册任务）
 * GET /    — 列出任务（支持 status, area_id, project_id, task_type, limit 过滤）
 * GET /:id — 获取单个 task
 * PATCH /:id — 更新 status/priority/title/okr_initiative_id
 * DELETE /:id — 软删除（status='cancelled'），复用 TERMINAL_STATUSES 保护
 */

import { Router } from 'express';
import pool from '../db.js';
import { detectDomain } from '../domain-detector.js';
import taskErrorReportRoutes from './task-error-report.js';

const router = Router();

// 状态机保护：已终止的任务不能回退到非终止状态（PATCH /:id 与 DELETE /:id 共用同一常量，
// 避免两套终态定义产生语义分裂）
const TERMINAL_STATUSES = ['completed', 'cancelled'];
const ACTIVE_DEDUP_STATUSES = ['queued', 'in_progress', 'blocked', 'paused'];

// POST /tasks — 创建新任务（供外部 agent 如 /architect 注册任务到 Brain 队列）
router.post('/', async (req, res) => {
  try {
    let {
      title,
      description = null,
      prd = null,
      priority = 'P2',
      task_type = 'dev',
      status: statusInput = null,
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
      blocked_at: blockedAtInput = null,
    } = req.body;

    if (!title || title.trim() === '') {
      return res.status(400).json({ error: 'title is required' });
    }

    // Tenant scope is assigned at the server ingress. Body payload cannot
    // impersonate a different tenant; legacy callers join the explicit
    // `default` tenant so old tasks remain queryable without a data rewrite.
    const tenantId = String(req.get('x-tenant-id') ?? 'default').trim() || 'default';
    const suppliedPayload = payload && typeof payload === 'object'
      ? payload
      : metadata && typeof metadata === 'object'
        ? metadata
        : {};
    payload = { ...suppliedPayload, tenant_id: tenantId };

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
    // mode 白名单：缺省/headless/headed 合法（claude+headed 已解锁，T6 88e0b448）
    if (mode !== undefined && mode !== null && !['headless', 'headed'].includes(mode)) {
      return res.status(400).json({ error: `mode must be headless or headed, got: ${mode}` });
    }
    // ─── end B1 ─────────────────────────────────────────────────────

    // 未提供 domain 时自动检测
    const domain = domainInput ?? detectDomain(`${title} ${description ?? ''}`).domain;

    // 顶层 journey_id 合并进 payload（支持调用方直接传 journey_id 而非嵌套在 payload 里）
    if (journey_id) {
      payload = { ...(payload ?? {}), journey_id };
    }

    // 允许创建时指定 pending_postdeploy / blocked 状态，其余状态创建时一律 queued
    // blocked: F1 接单失守修复（task 8419142d）——串行 depends_on_prev 场景需在注册时即写入 blocked
    const ALLOWED_CREATE_STATUSES = ['queued', 'pending_postdeploy', 'blocked'];
    const initialStatus = statusInput && ALLOWED_CREATE_STATUSES.includes(statusInput) ? statusInput : 'queued';
    // blocked_at: 调用方可显式传入；缺省时若 status=blocked 自动补 NOW()
    const initialBlockedAt = initialStatus === 'blocked'
      ? (blockedAtInput ?? new Date().toISOString())
      : null;

    // B51: harness_initiative 任务缺 journey_id 会导致 initiative_runs + Notion 游离，提前 warn
    const warnings = [];
    if (task_type === 'harness_initiative' && !(payload?.journey_id)) {
      warnings.push('journey_id missing in payload — initiative_run.journey_id will be null, Notion Project will be orphaned');
    }

    // C3: 服务端去重护栏（issue 655691d2）——title 精确匹配 + goal_id/project_id 一致
    // + 仍是活跃状态，命中则直接返回已有任务，不重新 INSERT。
    // 防止外部 agent/人工反复对同一意图重新注册 task（2026-07-09 实测 5 个重复 PR 的根因）。
    const dedupResult = await pool.query(
      `WITH candidate AS (
         SELECT * FROM tasks
         WHERE title = $1
           AND (goal_id IS NOT DISTINCT FROM $2)
           AND (project_id IS NOT DISTINCT FROM $3)
         ORDER BY CASE WHEN status IN ('queued','in_progress','blocked','paused') THEN 0 ELSE 1 END, created_at DESC
         LIMIT 1
       ), touched AS (
         UPDATE tasks t
         SET payload = COALESCE(t.payload, '{}'::jsonb) || jsonb_build_object(
               'recurrence_requests', COALESCE((t.payload->>'recurrence_requests')::int, 0) + 1,
               'last_duplicate_request_at', NOW()
             ),
             updated_at = NOW()
         FROM candidate c
         WHERE t.id=c.id AND c.status IN ('queued','in_progress','blocked','paused')
         RETURNING t.*
       )
       SELECT * FROM touched
       UNION ALL
       SELECT * FROM candidate WHERE status NOT IN ('queued','in_progress','blocked','paused')`,
      [title.trim(), goal_id, project_id]
    );
    const identityMatch = dedupResult.rows[0] ?? null;
    if (identityMatch && ACTIVE_DEDUP_STATUSES.includes(identityMatch.status)) {
      return res.status(200).json({ ...dedupResult.rows[0], deduplicated: true });
    }

    const recurrenceOfTaskId = identityMatch?.id ?? null;
    if (recurrenceOfTaskId) {
      payload = { ...payload, recurrence_of_task_id: recurrenceOfTaskId };
    }

    let result;
    try {
      result = await pool.query(
        `INSERT INTO tasks (
         title, description, priority, task_type, status,
         project_id, area_id, goal_id, location,
         payload, trigger_source, domain, okr_initiative_id, ability_id,
         blocked_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         RETURNING id, title, status, task_type, priority, project_id, area_id, goal_id, okr_initiative_id, ability_id, payload, blocked_at, created_at`,
        [
          title.trim(),
          description,
          priority,
          task_type,
          initialStatus,
          project_id,
          area_id,
          goal_id,
          location,
          JSON.stringify(payload),
          trigger_source,
          domain,
          okr_initiative_id,
          ability_id,
          initialBlockedAt,
        ]
      );
    } catch (insertError) {
      if (insertError.code !== '23505' || insertError.constraint !== 'idx_tasks_dedup_active') throw insertError;
      const winner = await pool.query(
        `SELECT * FROM tasks
         WHERE title=$1
           AND goal_id IS NOT DISTINCT FROM $2
           AND project_id IS NOT DISTINCT FROM $3
           AND status IN ('queued','in_progress')
         ORDER BY created_at DESC LIMIT 1`,
        [title.trim(), goal_id, project_id]
      );
      if (!winner.rows[0]) throw insertError;
      return res.status(200).json({ ...winner.rows[0], deduplicated: true });
    }

    const responseBody = result.rows[0];
    if (recurrenceOfTaskId) responseBody.recurrence_of_task_id = recurrenceOfTaskId;
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

    let query = 'SELECT id, title, status, priority, task_type, project_id, area_id, claimed_by, executor_kind, created_at, completed_at, updated_at FROM tasks';
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
    const { status, priority, title, okr_initiative_id, pr_url, result: taskResult, description } = req.body;

    const _VALID_STATUSES = ['queued', 'in_progress', 'completed', 'cancelled', 'failed', 'blocked'];
    let harnessDemoted = false;
    let harnessDemoteReason = null;
    if (status !== undefined) {
      const current = await pool.query(
        "SELECT status, task_type, payload->>'orchestrator' AS orchestrator FROM tasks WHERE id = $1",
        [req.params.id]
      );
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
      // 收账权收归（决策 dc18d43d）：harness_initiative(skill-relay) completed 一律申请，
      // 外部真相核验不过 → 不写 status/时间戳，200 accepted:false，交给 watchdog 收口。
      if (status === 'completed'
          && current.rows[0].task_type === 'harness_initiative'
          && current.rows[0].orchestrator === 'skill-relay') {
        const { finalizeHarnessTask } = await import('../lib/harness-finalize.js');
        const fin = await finalizeHarnessTask(req.params.id, { pool });
        if (fin.applies && !fin.allow) { harnessDemoted = true; harnessDemoteReason = fin.reason; }
      }
    }

    const setClauses = [];
    const params = [];
    let paramIndex = 1;

    if (status !== undefined && !harnessDemoted) {
      setClauses.push(`status = $${paramIndex++}`);
      params.push(status);
      // 自动设置时间戳
      if (status === 'in_progress') {
        setClauses.push(`started_at = COALESCE(started_at, NOW())`);
        // 认领协议统一（T4）: in_progress 时补写 claimed_by + executor_kind
        // 防止 dispatcher 重复抢跑（07-10 事故：注册后未 claim，Brain 几分钟内重复派发）
        setClauses.push(`claimed_by = COALESCE(claimed_by, $${paramIndex++})`);
        params.push(`session:${req.headers?.['x-session-id'] || 'engine-patch'}`);
        setClauses.push(`claimed_at = COALESCE(claimed_at, NOW())`);
        setClauses.push(`executor_kind = COALESCE(executor_kind, $${paramIndex++})`);
        params.push('headed-session');
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
    if (description !== undefined) {
      setClauses.push(`description = $${paramIndex++}`);
      params.push(description);
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

    if (setClauses.length === 0 && !harnessDemoted) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // 复活路径：description 被补齐时，若任务因 pre-flight 三振被 blocked，自动回 queued 并清零计数
    if (description !== undefined && description) {
      const currentTask = await pool.query(
        'SELECT status, blocked_reason, metadata FROM tasks WHERE id = $1',
        [req.params.id]
      );
      if (currentTask.rows.length > 0) {
        const t = currentTask.rows[0];
        if (t.status === 'blocked' && t.blocked_reason === 'pre_flight_rejected') {
          setClauses.push(`status = 'queued'`);
          setClauses.push(`blocked_reason = NULL`);
          setClauses.push(`blocked_at = NULL`);
          setClauses.push(`blocked_detail = NULL`);
          const cleanedMeta = Object.assign({}, t.metadata || {});
          delete cleanedMeta.pre_flight_fail_count;
          delete cleanedMeta.pre_flight_failed;
          delete cleanedMeta.pre_flight_issues;
          delete cleanedMeta.pre_flight_suggestions;
          setClauses.push(`metadata = $${paramIndex++}::jsonb`);
          params.push(JSON.stringify(cleanedMeta));
        }
      }
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
    res.json(harnessDemoted
      ? { ...result.rows[0], accepted: false, reason: harnessDemoteReason }
      : result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update task', details: err.message });
  }
});

// DELETE /tasks/:id — 软删除（status='cancelled'）。复用 PATCH 同一套 TERMINAL_STATUSES
// 状态机保护：不存在 → 404；已终态（completed/cancelled）→ 409（防误删历史记录，幂等）；
// 其余 → UPDATE status='cancelled'，200 返回更新后整行。
router.delete('/:id', async (req, res) => {
  try {
    const current = await pool.query('SELECT status FROM tasks WHERE id = $1', [req.params.id]);
    if (!current.rows.length) {
      return res.status(404).json({ error: 'Task not found', id: req.params.id });
    }
    const currentStatus = current.rows[0].status;
    if (TERMINAL_STATUSES.includes(currentStatus)) {
      return res.status(409).json({
        error: 'State machine violation',
        details: `Cannot delete task in terminal status '${currentStatus}'`,
      });
    }

    const result = await pool.query(
      `UPDATE tasks SET status = 'cancelled', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Task not found', id: req.params.id });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete task', details: err.message });
  }
});

// POST /tasks/:id/claim — C1 atomic claim，防止并行 dispatch 重复派发
// 使用场景：外部 agent（如 autonomous pipeline）在开始处理前主动 claim。
// 返回 200 表示 claim 成功；返回 409 表示已被其他 runner claim。
router.post('/:id/claim', async (req, res) => {
  try {
    const { id } = req.params;
    const { claimer, executor_kind: rawExecutorKind } = req.body || {};
    if (!claimer) {
      return res.status(400).json({ error: 'claimer is required' });
    }
    const executorKind = rawExecutorKind || 'headed-session';

    const result = await pool.query(
      `UPDATE tasks SET claimed_by = $1, claimed_at = NOW(), executor_kind = COALESCE(executor_kind, $3)
       WHERE id = $2 AND claimed_by IS NULL
       RETURNING id, claimed_by, claimed_at, executor_kind`,
      [claimer, id, executorKind]
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

router.use('/', taskErrorReportRoutes);

export default router;
