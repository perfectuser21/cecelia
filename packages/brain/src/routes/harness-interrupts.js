/**
 * Harness Interrupts 路由 — W5 关键决策点 resume 接口。
 *
 * Spec: docs/superpowers/specs/2026-05-06-harness-langgraph-reliability-design.md §W5
 * Plan: docs/superpowers/plans/2026-05-06-harness-langgraph-reliability.md §W5 Task 5.2
 *
 * 端点：
 *   GET  /api/brain/harness-interrupts            列出待 resume 的 interrupt（24h 内 type=interrupt_pending 且无对应 interrupt_resumed）
 *   POST /api/brain/harness-interrupts/:taskId/resume   主理人决策后用 Command({resume:decision}) 重新 stream graph
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

/**
 * GET /api/brain/harness-interrupts
 *
 * 返回 24h 内仍未 resume 的 interrupt 列表（task_events 表 type='interrupt_pending'，
 * 且没有同 task_id 后续 type='interrupt_resumed' 行）。
 */
router.get('/', async (req, res) => {
  try {
    const dbPool = req.app.get('pool') || pool;
    const { rows } = await dbPool.query(`
      SELECT pending.task_id, pending.payload, pending.created_at
      FROM task_events pending
      WHERE pending.event_type = 'interrupt_pending'
        AND pending.created_at > NOW() - INTERVAL '24 hours'
        AND NOT EXISTS (
          SELECT 1 FROM task_events resumed
          WHERE resumed.task_id = pending.task_id
            AND resumed.event_type = 'interrupt_resumed'
            AND resumed.created_at >= pending.created_at
        )
      ORDER BY pending.created_at DESC
      LIMIT 100
    `);
    res.json({ interrupts: rows });
  } catch (err) {
    console.error(`[harness-interrupts][GET] error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/brain/harness-interrupts/:taskId/resume
 *
 * Body: { decision: { action: 'abort'|'extend_fix_rounds'|'accept_failed', ...meta } }
 *
 * 写一行 task_events.type='interrupt_resumed'，返回 202。
 *
 * 注（刀4阶段3，2026-07-09）：原「异步 Command({resume:decision}) 重新 stream
 * harness-initiative.graph.js 续跑」逻辑已删除——interrupt_pending 事件只由该死图写入，
 * orchestrator 硬校验落地后不再产生该事件，故 resume 分支物理不可达。
 */
router.post('/:taskId/resume', async (req, res) => {
  const { taskId } = req.params;
  const { decision } = req.body || {};
  if (!decision || typeof decision !== 'object' || !decision.action) {
    return res.status(400).json({ error: 'body.decision.action required' });
  }
  const allowed = new Set(['abort', 'extend_fix_rounds', 'accept_failed']);
  if (!allowed.has(decision.action)) {
    return res.status(400).json({ error: `decision.action must be one of ${[...allowed].join('|')}` });
  }

  const dbPool = req.app.get('pool') || pool;

  let task;
  try {
    const taskRow = await dbPool.query(
      'SELECT id, payload, execution_attempts FROM tasks WHERE id = $1::uuid',
      [taskId]
    );
    if (taskRow.rowCount === 0) {
      return res.status(404).json({ error: 'task not found' });
    }
    task = taskRow.rows[0];
  } catch (err) {
    return res.status(500).json({ error: `db: ${err.message}` });
  }

  const initiativeId = task.payload?.initiative_id || task.id;
  const attemptN = task.execution_attempts || 1;
  const threadId = `harness-initiative:${initiativeId}:${attemptN}`;

  // 写 interrupt_resumed event
  try {
    await dbPool.query(
      `INSERT INTO task_events (task_id, event_type, payload, created_at)
       VALUES ($1, 'interrupt_resumed', $2::jsonb, NOW())`,
      [task.id, JSON.stringify({ decision, threadId, initiativeId })]
    );
  } catch (err) {
    console.warn(`[harness-interrupts][POST] write event failed: ${err.message}`);
  }

  res.status(202).json({ ok: true, threadId, decision, taskId: task.id });
});

export default router;
