/**
 * routes/handoffs.js — 交接单只读流（relay-baton4 item1）+ 有头续接待续（2026-10-11）
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

function parseLimit(raw) {
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, MAX_LIMIT) : DEFAULT_LIMIT;
}

/**
 * GET /api/brain/handoffs/pending-resume?limit=20
 *   有头续接「待续」列表（主理人 2026-10-11 决策）：handoff.next_steps 里 kind=resume_headed 的条目
 *   不派发，由 relay-baton 在原任务 result.pending_resume 挂 status=pending。这里列出谁的任务、
 *   下一步是什么、交接全文，供新的有头会话开场接上。
 *   销待续（写操作）不在本只读路由，见 routes/handoff-resume-ack.js。
 */
router.get('/pending-resume', async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    const { rows } = await pool.query(
      `SELECT id, title, status, task_type, executor_kind, payload, claimed_by,
              result->'pending_resume' AS pending_resume, result->'handoff' AS handoff
         FROM tasks
        WHERE result->'pending_resume'->>'status' = 'pending'
        ORDER BY (result->'pending_resume'->>'created_at') DESC NULLS LAST
        LIMIT $1`,
      [limit]
    );
    const pending = rows.map((r) => {
      const pr = r.pending_resume || {};
      const h = r.handoff || {};
      const p = r.payload || {};
      return {
        task_id: r.id,
        title: r.title || h.title || '',
        status: r.status,
        task_type: r.task_type,
        executor_kind: r.executor_kind ?? null,
        repo: p.repo || p.base_repo || null,
        session_id: pr.session_id ?? h.session_id ?? null,
        items: Array.isArray(pr.items) ? pr.items : [],
        created_at: pr.created_at ?? null,
        handoff: h,
      };
    });
    res.json({ pending, total: pending.length });
  } catch (err) {
    console.error('[handoffs] GET pending-resume error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
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
