/**
 * Harness 人工验收路由
 *
 * GET  /api/brain/harness/pending-reviews
 *   返回所有等待人工验收的 PR 列表（evaluator PASS 但尚未批准 merge）。
 *
 * POST /api/brain/harness/pending-reviews/:taskId/approve
 *   Header: x-approver-token（必须等于 Brain env HARNESS_REVIEW_APPROVER_TOKEN）
 *   Body: { approved_by: "<主理人身份，必填>" }
 *   写 human_review_approved 事件（payload 记 approved_by + source），返回 202。
 *
 * POST /api/brain/harness/pending-reviews/:taskId/reject
 *   同套认证。Body: { approved_by, reason? }
 *   写 human_review_rejected 事件，返回 202。
 *
 * 认证（issue afc50c30，2026-07-23）：approve/reject 是审批权动作，必须持
 * approver token 才能调用——token 只存在于 Brain 容器 env 与主理人 credentials，
 * relay/harness 执行体容器不挂载 → 执行体物理上无法伪造人工批准（1b997ed6 曾
 * 无认证调本路由伪造 approved_by=alex 绕过 review 门 self-merge，已 revert）。
 * env 未配置 → 503 fail-closed：未配置不等于敞开。
 *
 * 注（刀4阶段3，2026-07-09）：原 approve/reject 的 resume LangGraph task graph 逻辑
 * （harness-task.graph.js）已删除——human_review_pending 事件只由该死图写入，
 * orchestrator 硬校验（payload.orchestrator==='skill-relay'）落地后不再产生该事件，
 * 故 resume 分支物理不可达。
 */

import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { timingSafeEqual } from 'node:crypto';
import pool from '../db.js';

const router = Router();

// 审批动作限流：人工触发的低频动作，60s/10 次足够；连错误请求也计数，
// 顺带钝化对 approver token 的暴力猜测（js/missing-rate-limiting，CodeQL）。
const approvalRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  identifier: 'pending-reviews-approval',
  message: { error: 'approval rate limit exceeded' },
});

/**
 * 审批权认证。通过返回 { ok: true, approvedBy }；失败已写响应，返回 { ok: false }。
 */
function authenticateApprover(req, res) {
  const expected = process.env.HARNESS_REVIEW_APPROVER_TOKEN;
  if (!expected) {
    res.status(503).json({
      error: 'approver token not configured',
      detail: 'Brain env HARNESS_REVIEW_APPROVER_TOKEN 未配置——审批通道 fail-closed，请先在部署环境注入 token',
    });
    return { ok: false };
  }

  const given = req.get?.('x-approver-token') ?? req.headers?.['x-approver-token'];
  const expectedBuf = Buffer.from(String(expected));
  const givenBuf = Buffer.from(String(given ?? ''));
  const match = expectedBuf.length === givenBuf.length && timingSafeEqual(expectedBuf, givenBuf);
  if (!match) {
    res.status(401).json({ error: 'invalid approver token' });
    return { ok: false };
  }

  const approvedBy = typeof req.body?.approved_by === 'string' ? req.body.approved_by.trim() : '';
  if (!approvedBy) {
    res.status(400).json({ error: 'approved_by is required' });
    return { ok: false };
  }

  return { ok: true, approvedBy };
}

router.get('/', async (req, res) => {
  try {
    const dbPool = req.app.get('pool') || pool;
    const { rows } = await dbPool.query(`
      SELECT
        e.task_id,
        e.payload->>'pr_url'   AS pr_url,
        e.payload->>'title'    AS title,
        e.created_at,
        t.title                AS task_title,
        t.payload->>'base_repo' AS base_repo
      FROM task_events e
      LEFT JOIN tasks t ON t.id = e.task_id
      WHERE e.event_type = 'human_review_pending'
        AND e.created_at > NOW() - INTERVAL '48 hours'
        AND NOT EXISTS (
          SELECT 1 FROM task_events r
          WHERE r.task_id = e.task_id
            AND r.event_type IN ('human_review_approved', 'human_review_rejected')
            AND r.created_at >= e.created_at
        )
      ORDER BY e.created_at DESC
      LIMIT 50
    `);
    res.json({ reviews: rows });
  } catch (err) {
    console.error(`[pending-reviews][GET] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:taskId/approve', approvalRateLimit, async (req, res) => {
  const { taskId } = req.params;
  const dbPool = req.app.get('pool') || pool;

  const auth = authenticateApprover(req, res);
  if (!auth.ok) return;

  try {
    const r = await dbPool.query('SELECT id FROM tasks WHERE id = $1::uuid', [taskId]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'task not found' });
  } catch (err) {
    return res.status(500).json({ error: `db: ${err.message}` });
  }

  // 写审批事件（身份来自认证请求方，绝不默认/硬编码）
  try {
    await dbPool.query(
      `INSERT INTO task_events (task_id, event_type, payload, created_at)
       VALUES ($1, 'human_review_approved', $2::jsonb, NOW())`,
      [taskId, JSON.stringify({
        approved: true,
        approved_by: auth.approvedBy,
        source: 'authenticated_route',
        approved_at: new Date().toISOString(),
      })]
    );
  } catch (err) {
    console.warn(`[pending-reviews] write approved event failed: ${err.message}`);
    return res.status(500).json({ error: `db: ${err.message}` });
  }

  res.status(202).json({ ok: true, taskId, approved: true, approved_by: auth.approvedBy });
});

router.post('/:taskId/reject', approvalRateLimit, async (req, res) => {
  const { taskId } = req.params;
  const { reason = 'rejected by user' } = req.body || {};
  const dbPool = req.app.get('pool') || pool;

  const auth = authenticateApprover(req, res);
  if (!auth.ok) return;

  try {
    await dbPool.query(
      `INSERT INTO task_events (task_id, event_type, payload, created_at)
       VALUES ($1, 'human_review_rejected', $2::jsonb, NOW())`,
      [taskId, JSON.stringify({
        approved: false,
        reason,
        approved_by: auth.approvedBy,
        source: 'authenticated_route',
        approved_at: new Date().toISOString(),
      })]
    );
  } catch (err) {
    console.warn(`[pending-reviews] write rejected event failed: ${err.message}`);
    return res.status(500).json({ error: `db: ${err.message}` });
  }

  res.status(202).json({ ok: true, taskId, approved: false, reason, approved_by: auth.approvedBy });
});

export default router;
