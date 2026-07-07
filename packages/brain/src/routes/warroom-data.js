/**
 * routes/warroom-data.js — 战情室只读数据端点（relay-baton4 item1）
 *
 * GET /api/brain/handoffs?limit=20&journey_id=
 *   从 tasks.result.handoff JSONB 捞摘要，按 updated_at 倒序。
 *
 * GET /api/brain/sentinel/health
 *   比对 working_memory scheduler_job_last_run:* 与 scheduler_jobs_expected，
 *   输出 jobs / expected / healthy。
 *
 * GET /api/brain/decisions/recent?made_by=user&limit=20
 *   decisions 表最近决策（支持 made_by 过滤）；若现有 /decisions 路由已满足需求
 *   则此端点作为语义别名，统一返回 { data, total } 格式。
 */
import { Router } from 'express';
import pool from '../db.js';
import { SENTINEL_KEY_PREFIX, JOBS } from '../scheduler-jobs.js';

const router = Router();

// ─────────────────────────────────────────────────────────────
// GET /handoffs
// ─────────────────────────────────────────────────────────────
router.get('/handoffs', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const journeyId = req.query.journey_id || null;

    const params = [];
    const conditions = ["result->'handoff' IS NOT NULL"];

    if (journeyId) {
      params.push(journeyId);
      // journey_id 可能在 payload 列或 result.handoff.journey_id 里
      conditions.push(
        `(payload->>'journey_id' = $${params.length} OR result->'handoff'->>'journey_id' = $${params.length})`
      );
    }

    params.push(limit);

    const { rows } = await pool.query(
      `SELECT id, title, status, task_type,
              result->'handoff' AS handoff,
              created_at, updated_at
       FROM tasks
       WHERE ${conditions.join(' AND ')}
       ORDER BY updated_at DESC
       LIMIT $${params.length}`,
      params
    );

    const data = rows.map((r) => ({
      task_id: r.id,
      title: r.title,
      status: r.status,
      task_type: r.task_type,
      updated_at: r.updated_at,
      created_at: r.created_at,
      handoff: r.handoff,
    }));

    res.json({ success: true, data, total: data.length });
  } catch (err) {
    console.error('[GET /handoffs]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /sentinel/health
// ─────────────────────────────────────────────────────────────
router.get('/sentinel/health', async (req, res) => {
  try {
    // 期望 job 数
    const { rows: expRows } = await pool.query(
      `SELECT value_json FROM working_memory WHERE key = 'scheduler_jobs_expected' LIMIT 1`
    );
    const expected = expRows.length > 0
      ? (expRows[0].value_json?.count ?? JOBS.length)
      : JOBS.length;

    // 所有哨兵记录
    const { rows: sentinelRows } = await pool.query(
      `SELECT key, value_json, updated_at
       FROM working_memory
       WHERE key LIKE $1
       ORDER BY key ASC`,
      [`${SENTINEL_KEY_PREFIX}%`]
    );

    const jobs = sentinelRows.map((r) => {
      const name = r.key.slice(SENTINEL_KEY_PREFIX.length);
      const rec = r.value_json || {};
      return {
        name,
        last_run: rec.at || null,
        ok: rec.ok ?? null,
        timed_out: rec.timedOut ?? false,
        error: rec.error || null,
        updated_at: r.updated_at,
      };
    });

    const healthy = jobs.length >= expected && jobs.every((j) => j.ok !== false);

    res.json({
      success: true,
      data: {
        jobs,
        expected,
        actual: jobs.length,
        healthy,
      },
    });
  } catch (err) {
    console.error('[GET /sentinel/health]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /decisions/recent  （made_by + limit 过滤；语义别名）
// ─────────────────────────────────────────────────────────────
router.get('/decisions/recent', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 200);
    const madeBy = req.query.made_by || null;

    const params = [];
    const conditions = ['category IS NOT NULL'];

    if (madeBy) {
      params.push(madeBy);
      conditions.push(`made_by = $${params.length}`);
    }

    params.push(limit);

    const { rows } = await pool.query(
      `SELECT id, category, topic, decision, reason, status, confidence,
              author, made_by, priority, area, decided_at, created_at, updated_at
       FROM decisions
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params
    );

    res.json({ success: true, data: rows, total: rows.length });
  } catch (err) {
    console.error('[GET /decisions/recent]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
