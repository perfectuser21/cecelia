/**
 * Harness Interrupts — 旧 W5 事件只读回看；已退休 graph 不再接受 resume。
 *
 * Spec: docs/superpowers/specs/2026-05-06-harness-langgraph-reliability-design.md §W5
 * Plan: docs/superpowers/plans/2026-05-06-harness-langgraph-reliability.md §W5 Task 5.2
 *
 * 端点：
 *   GET  /api/brain/harness-interrupts            列出待 resume 的 interrupt（24h 内 type=interrupt_pending 且无对应 interrupt_resumed）
 *   POST /api/brain/harness-interrupts/:taskId/resume   明确返回 410，不写恢复事件、不重新 stream graph
 */

import { Router } from 'express';
import pool from '../db.js';
import { kernelRuntimeRetiredError } from '../lib/kernel-retirement.js';

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

/** 旧 graph 已退休。保留 URL 明确拒绝，不能把记事件冒称为恢复执行。 */
router.post('/:taskId/resume', (_req, res) => {
  const err = kernelRuntimeRetiredError();
  return res.status(err.status).json({ error: err.code, message: err.message });
});

export default router;
