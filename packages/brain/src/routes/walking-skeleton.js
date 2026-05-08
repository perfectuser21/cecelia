/**
 * Walking Skeleton 1-node 路由 — LangGraph 修正 Sprint Stream 5。
 *
 * 端点：
 *   POST /api/brain/walking-skeleton-1node/trigger
 *     启动一个新 graph instance：spawn alpine container 后 interrupt 等 callback。
 *     立即返回 { ok, thread_id, container_id }，不阻塞调用方。
 *
 *   GET /api/brain/walking-skeleton-1node/status/:threadId
 *     查 walking_skeleton_thread_lookup 表，返回 { status, container_id, result, ... }。
 *     status: spawning（spawn 完在 interrupt） / completed（callback 已 resume + finalize 写表） /
 *             failed（spawn 失败）。
 *
 * Spec: docs/superpowers/specs/2026-05-08-langgraph-fix-walking-skeleton.md
 */
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { getPgCheckpointer } from '../orchestrator/pg-checkpointer.js';
import { getCompiledWalkingSkeleton } from '../workflows/walking-skeleton-1node.graph.js';
import pool from '../db.js';

const router = Router();

router.post('/walking-skeleton-1node/trigger', async (_req, res) => {
  const threadId = randomUUID();
  try {
    const checkpointer = await getPgCheckpointer();
    const app = await getCompiledWalkingSkeleton(checkpointer);

    // 不 await — graph 走到 interrupt 后会 yield，invoke 一次 promise 即 resolve，
    // 但若 spawn_node 中 PG 写失败 invoke 会立即 throw。我们用 fire-and-forget
    // pattern 让 trigger 立即返回，错误走 .catch 写 stderr 日志。
    app
      .invoke({ triggerId: threadId }, { configurable: { thread_id: threadId } })
      .catch((err) => {
        console.error(`[walking-skeleton] invoke failed thread=${threadId}: ${err.message}`);
      });

    return res.json({ ok: true, thread_id: threadId });
  } catch (err) {
    console.error(`[walking-skeleton] trigger failed: ${err.message}`);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/walking-skeleton-1node/status/:threadId', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT status, container_id, thread_id, result, created_at, resolved_at
         FROM walking_skeleton_thread_lookup
        WHERE thread_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [req.params.threadId]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ status: 'unknown', thread_id: req.params.threadId });
    }
    return res.json(r.rows[0]);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
