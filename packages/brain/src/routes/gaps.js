/**
 * routes/gaps.js — Gap Ledger API 路由（FR-5）
 *
 * GET  /api/brain/harness/gaps?task_id=<uuid>
 *   查询任务的所有 gap（source 或 repair 角色）
 *   成功：200 + { gaps: [...] }
 *   缺少 task_id：400
 *
 * GET  /api/brain/harness/gaps/:id/events
 *   查询单个 gap 的完整事件链
 *   存在：200 + { events: [...] }
 *   不存在：404
 *
 * POST /api/brain/harness/gaps
 *   为 drift 事件开一个新的 gap（幂等）
 *   成功创建：201 + { gap }
 *   幂等返回：200 + { gap }
 *
 * PATCH /api/brain/harness/gaps/:id/status
 *   执行状态机跳转
 *   成功：200 + { gap, event }
 *   非法跳转：422
 *   不存在：404
 *
 * sprint: 08110022-relay-d96c9fa0 ws5
 */

import { Router } from 'express';
import pool from '../db.js';
import { internalAuthOrLoopback } from '../middleware/internal-auth.js';
import {
  openGapForDrift,
  transitionGapStatus,
  getGapsByTask,
  getGapById,
  getGapEvents,
  listGapsByStatus,
  assignRepairTaskWithDependency,
} from '../impact-contract/gap-store.js';

const router = Router();

// ---------- GET /gaps?task_id=<uuid> ----------

/**
 * GET /api/brain/harness/gaps
 * 查询任务的所有 gap
 */
router.get('/', async (req, res) => {
  try {
    const { task_id, status } = req.query;

    // task_id 优先：返回任务关联的所有 gap（对象形式，向后兼容）
    if (task_id) {
      const gaps = await getGapsByTask(pool, task_id);
      return res.status(200).json({ gaps });
    }

    // status 过滤：全局列表（数组形式，供评估器/巡检使用）
    if (status) {
      const gaps = await listGapsByStatus(pool, status);
      return res.status(200).json(gaps);
    }

    return res.status(400).json({
      error: 'invalid_request',
      message: 'task_id 或 status 至少提供一个',
    });
  } catch (err) {
    console.error('[gaps] GET /gaps error:', err);
    return res.status(500).json({ error: 'internal_server_error', message: err.message });
  }
});

// ---------- GET /gaps/:id ----------

/**
 * GET /api/brain/harness/gaps/:id
 * 获取单个 gap 详情
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // 排除 :id = "events" 的路由冲突（虽然 Express 不会匹配，保险起见）
    const gap = await getGapById(pool, id);

    if (!gap) {
      return res.status(404).json({
        error: 'not_found',
        message: `Gap ${id} 不存在`,
      });
    }

    return res.status(200).json(gap);
  } catch (err) {
    console.error('[gaps] GET /gaps/:id error:', err);
    return res.status(500).json({ error: 'internal_server_error', message: err.message });
  }
});

// ---------- GET /gaps/:id/events ----------

/**
 * GET /api/brain/harness/gaps/:id/events
 * 查询 gap 的完整事件链
 */
router.get('/:id/events', async (req, res) => {
  try {
    const { id } = req.params;

    // 先验证 gap 存在
    const gap = await getGapById(pool, id);
    if (!gap) {
      return res.status(404).json({
        error: 'not_found',
        message: `Gap ${id} 不存在`,
      });
    }

    const events = await getGapEvents(pool, id);
    return res.status(200).json({ events });
  } catch (err) {
    console.error('[gaps] GET /gaps/:id/events error:', err);
    return res.status(500).json({ error: 'internal_server_error', message: err.message });
  }
});

// ---------- POST /gaps — 开新 gap ----------

/**
 * POST /api/brain/harness/gaps
 * 为 drift 事件开一个新的 gap（幂等）
 *
 * body: {
 *   source_task_id: string,
 *   impact_node_id: string,
 *   owner?: string,
 *   severity?: 'critical'|'high'|'medium'|'low',
 *   revision?: string,
 *   idempotency_key?: string,
 * }
 */
router.post('/', internalAuthOrLoopback, async (req, res) => {
  try {
    const {
      source_task_id,
      impact_node_id,
      owner,
      severity,
      revision,
      idempotency_key,
    } = req.body ?? {};

    if (!source_task_id || !impact_node_id) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'source_task_id 和 impact_node_id 是必填字段',
      });
    }

    const { gap, created } = await openGapForDrift(pool, {
      sourceTaskId: source_task_id,
      impactNodeId: impact_node_id,
      owner: owner ?? null,
      severity: severity ?? 'medium',
      revision: revision ?? null,
      idempotencyKey: idempotency_key ?? null,
    });

    return res.status(created ? 201 : 200).json({ gap });
  } catch (err) {
    console.error('[gaps] POST /gaps error:', err);
    return res.status(500).json({ error: 'internal_server_error', message: err.message });
  }
});

// ---------- POST /gaps/:id/repair-task — 绑定修复任务与硬依赖 ----------

router.post('/:id/repair-task', internalAuthOrLoopback, async (req, res) => {
  try {
    const { id } = req.params;
    const { repair_task_id: repairTaskId } = req.body ?? {};
    if (!repairTaskId) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'repair_task_id 是必填字段',
      });
    }

    const result = await assignRepairTaskWithDependency(pool, id, repairTaskId);
    return res.status(200).json(result);
  } catch (err) {
    if (err.code === 'gap_not_found') {
      return res.status(404).json({ error: 'not_found', message: err.message });
    }
    console.error('[gaps] POST /gaps/:id/repair-task error:', err);
    return res.status(500).json({ error: 'internal_server_error', message: err.message });
  }
});

// ---------- PATCH /gaps/:id/status — 状态机跳转 ----------

/**
 * PATCH /api/brain/harness/gaps/:id/status
 * 执行状态机跳转
 *
 * body: {
 *   status: string,            // 目标状态
 *   actor?: string,
 *   detail?: object,
 *   idempotency_key?: string,
 *   resolution_evidence?: {    // resolved 必填
 *     assertion_id: string,
 *     receipt_id: string,
 *     revision: string,
 *   },
 * }
 */
router.patch('/:id/status', internalAuthOrLoopback, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      status: newStatus,
      actor,
      detail,
      idempotency_key,
      resolution_evidence,
    } = req.body ?? {};

    if (!newStatus) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'status 是必填字段',
      });
    }

    const { gap, event } = await transitionGapStatus(pool, id, newStatus, {
      actor: actor ?? null,
      detail: detail ?? null,
      idempotencyKey: idempotency_key ?? null,
      resolutionEvidence: resolution_evidence ?? null,
    });

    return res.status(200).json({ gap, event });
  } catch (err) {
    if (err.code === 'invalid_transition') {
      return res.status(422).json({
        error: 'invalid_transition',
        message: err.message,
        from: err.from,
        to: err.to,
        allowed: err.allowed,
      });
    }
    if (err.code === 'gap_not_found') {
      return res.status(404).json({
        error: 'not_found',
        message: err.message,
      });
    }
    if (err.code === 'missing_resolution_evidence') {
      return res.status(422).json({
        error: 'missing_resolution_evidence',
        message: err.message,
      });
    }
    if (err.code === 'invalid_resolution_evidence' || err.code === 'revision_mismatch') {
      return res.status(err.httpStatus ?? 422).json({
        error: err.code,
        message: err.message,
      });
    }
    console.error('[gaps] PATCH /gaps/:id/status error:', err);
    return res.status(500).json({ error: 'internal_server_error', message: err.message });
  }
});

export default router;
