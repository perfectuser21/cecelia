/**
 * routes/handoffs.js — 交接单只读流（relay-baton4 item1）
 *
 * GET /api/brain/handoffs?limit=20&journey_id=
 *   从 tasks.result.handoff（saveHandoff 写入的 SSOT，见 src/handoff.js）捞摘要，
 *   按交接单 created_at 倒序。供 warroom「接力史流」板块。只读。
 */
import { Router } from 'express';
import pool from '../db.js';

const router = Router();

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

router.get('/', async (req, res) => {
  try {
    const parsed = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, MAX_LIMIT) : DEFAULT_LIMIT;
    const params = [];
    const conditions = [`result ? 'handoff'`];
    if (req.query.journey_id) {
      params.push(req.query.journey_id);
      conditions.push(
        `(result->'handoff'->>'journey_id' = $${params.length} OR payload->>'journey_id' = $${params.length})`
      );
    }
    params.push(limit);
    const { rows } = await pool.query(
      `SELECT id, title, result->'handoff' AS handoff
       FROM tasks
       WHERE ${conditions.join(' AND ')}
       ORDER BY (result->'handoff'->>'created_at') DESC NULLS LAST
       LIMIT $${params.length}`,
      params
    );
    const handoffs = rows.map((r) => {
      const h = r.handoff || {};
      return {
        task_id: h.task_id || r.id,
        title: h.title || r.title || '',
        verdict: h.verdict ?? null,
        journey_id: h.journey_id ?? null,
        created_at: h.created_at ?? null,
        next_steps: Array.isArray(h.next_steps) ? h.next_steps : [],
        pr_urls: Array.isArray(h.artifacts?.pr_urls) ? h.artifacts.pr_urls : [],
      };
    });
    res.json({ handoffs, total: handoffs.length });
  } catch (err) {
    console.error('[handoffs] GET error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
