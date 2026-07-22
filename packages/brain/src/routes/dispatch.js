/**
 * routes/dispatch.js — dispatch_events 诊断端点
 *
 * GET /api/brain/dispatch/recent
 *   query: limit (默认 20，最大 100)
 *   返回最近 N 条 dispatch_events（含 task_id / event_type / reason / created_at）
 *
 * 用于诊断 Brain dispatcher silent-skip 问题（B6）。
 */

import { Router } from 'express';
import pool from '../db.js';
import { getLlmCapacitySnapshot } from '../llm-capacity.js';

const router = Router();

/**
 * 构建 recent dispatch events 处理函数（便于单元测试注入 pool）
 * @param {object} poolInstance - pg 连接池
 */
export function buildRecentDispatchEventsHandler(poolInstance) {
  return async function recentDispatchEventsHandler(req, res) {
    const rawLimit = parseInt(req.query.limit ?? '20', 10);
    const limit = isNaN(rawLimit) || rawLimit < 1 ? 20 : Math.min(rawLimit, 100);

    try {
      const result = await poolInstance.query(
        `SELECT id, task_id, event_type, reason, created_at
         FROM dispatch_events
         ORDER BY created_at DESC
         LIMIT $1`,
        [limit]
      );

      return res.json({
        events: result.rows,
        limit,
        total: result.rows.length,
      });
    } catch (err) {
      console.error('[dispatch/recent] query failed:', err.message);
      return res.status(500).json({ error: 'Failed to query dispatch_events', details: err.message });
    }
  };
}

export function buildLlmCapacityHandler(getSnapshot = getLlmCapacitySnapshot) {
  return async function llmCapacityHandler(_req, res) {
    try {
      const snapshot = await getSnapshot();
      return res.json(snapshot);
    } catch (err) {
      console.error('[dispatch/llm-capacity] query failed:', err.message);
      return res.status(500).json({ error: 'Failed to query llm capacity', details: err.message });
    }
  };
}

// GET /dispatch/recent
router.get('/dispatch/recent', buildRecentDispatchEventsHandler(pool));
router.get('/dispatch/llm-capacity', buildLlmCapacityHandler());

export default router;
