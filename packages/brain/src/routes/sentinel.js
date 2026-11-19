/**
 * routes/sentinel.js — 调度哨兵健康只读口（relay-baton4 item1）
 *
 * GET /api/brain/sentinel/health
 *   读 working_memory 的 scheduler_job_last_run:* 键（scheduler-jobs.js 每 60s 写）
 *   与 scheduler_jobs_expected（{count, names}）比对。供 warroom「哨兵灯」板块。
 *   healthy 判定与体外死人开关（scripts/sentinel/dead-man-switch.sh）同源不同责：
 *   这里只读展示，不告警。
 */
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import pool from '../db.js';

const router = Router();

// 与 scheduler-jobs.js 的 SENTINEL_KEY_PREFIX 同一字面量（不 import，避免拖入 handler 依赖链）
const KEY_PREFIX = 'scheduler_job_last_run:';
const EXPECTED_KEY = 'scheduler_jobs_expected';
// 一轮 job 串行 worst case ~25min（见 scheduler-jobs.js 重入守卫注释），30min 为过期线
export const STALE_SECONDS = 1800;

router.get('/health', rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }), async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT key, value_json, EXTRACT(EPOCH FROM (now() - updated_at))::int AS age_seconds
       FROM working_memory
       WHERE key LIKE $1 OR key = $2`,
      [`${KEY_PREFIX}%`, EXPECTED_KEY]
    );
    const declaration = rows.find(row => row.key === EXPECTED_KEY)?.value_json;
    const expected = Number.isInteger(declaration?.count) && declaration.count > 0
      ? declaration.count : null;
    const names = declaration?.names;
    const confirmed = expected !== null && Array.isArray(names)
      && names.length === expected
      && names.every(name => typeof name === 'string' && name.trim().length > 0)
      && new Set(names).size === expected;
    const activeNames = new Set(confirmed ? names : []);
    const jobs = rows
      .filter(row => row.key.startsWith(KEY_PREFIX) && activeNames.has(row.key.slice(KEY_PREFIX.length)))
      .map(row => ({
        name: row.key.slice(KEY_PREFIX.length),
        ok: row.value_json?.ok === true,
        age_seconds: row.age_seconds,
        at: row.value_json?.at ?? null,
      }));
    const healthy = confirmed && jobs.length === expected
      && jobs.every(job => job.ok && job.age_seconds <= STALE_SECONDS);
    res.json({ jobs, expected, healthy });
  } catch (err) {
    console.error('[sentinel] health error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
