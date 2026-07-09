/**
 * Harness 人工验收路由
 *
 * GET  /api/brain/harness/pending-reviews
 *   返回所有等待人工验收的 PR 列表（evaluator PASS 但尚未批准 merge）。
 *
 * POST /api/brain/harness/pending-reviews/:taskId/approve
 *   Body: { approved: true }
 *   写 human_review_approved 事件，返回 202。
 *
 * POST /api/brain/harness/pending-reviews/:taskId/reject
 *   Body: { reason?: string }
 *   写 human_review_rejected 事件，返回 202。
 *
 * 注（刀4阶段3，2026-07-09）：原 approve/reject 的 resume LangGraph task graph 逻辑
 * （harness-task.graph.js）已删除——human_review_pending 事件只由该死图写入，
 * orchestrator 硬校验（payload.orchestrator==='skill-relay'）落地后不再产生该事件，
 * 故 resume 分支物理不可达。
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

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

router.post('/:taskId/approve', async (req, res) => {
  const { taskId } = req.params;
  const dbPool = req.app.get('pool') || pool;

  try {
    const r = await dbPool.query('SELECT id FROM tasks WHERE id = $1::uuid', [taskId]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'task not found' });
  } catch (err) {
    return res.status(500).json({ error: `db: ${err.message}` });
  }

  // 写审批事件
  try {
    await dbPool.query(
      `INSERT INTO task_events (task_id, event_type, payload, created_at)
       VALUES ($1, 'human_review_approved', $2::jsonb, NOW())`,
      [taskId, JSON.stringify({ approved: true, approved_by: 'alex' })]
    );
  } catch (err) {
    console.warn(`[pending-reviews] write approved event failed: ${err.message}`);
  }

  res.status(202).json({ ok: true, taskId, approved: true });
});

router.post('/:taskId/reject', async (req, res) => {
  const { taskId } = req.params;
  const { reason = 'rejected by user' } = req.body || {};
  const dbPool = req.app.get('pool') || pool;

  try {
    await dbPool.query(
      `INSERT INTO task_events (task_id, event_type, payload, created_at)
       VALUES ($1, 'human_review_rejected', $2::jsonb, NOW())`,
      [taskId, JSON.stringify({ approved: false, reason })]
    );
  } catch (err) {
    console.warn(`[pending-reviews] write rejected event failed: ${err.message}`);
  }

  res.status(202).json({ ok: true, taskId, approved: false, reason });
});

export default router;
