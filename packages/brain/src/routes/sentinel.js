/**
 * routes/sentinel.js — 调度哨兵健康只读口（relay-baton4 item1）
 *
 * GET /api/brain/sentinel/health
 *   读 working_memory 的 scheduler_job_last_run:* 键（scheduler-jobs.js 每 60s 写）
 *   与 scheduler_jobs_expected（{count}）比对。供 warroom「哨兵灯」板块。
 *   healthy 判定与体外死人开关（scripts/sentinel/dead-man-switch.sh）同源不同责：
 *   这里只读展示，不告警。
 */
import { Router } from 'express';
import pool from '../db.js';

const router = Router();

// 与 scheduler-jobs.js 的 SENTINEL_KEY_PREFIX 同一字面量（不 import，避免拖入 handler 依赖链）
const KEY_PREFIX = 'scheduler_job_last_run:';
const EXPECTED_KEY = 'scheduler_jobs_expected';
// 一轮 job 串行 worst case ~25min（见 scheduler-jobs.js 重入守卫注释），30min 为过期线
export const STALE_SECONDS = 1800;

router.get('/health', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT key, value_json, EXTRACT(EPOCH FROM (now() - updated_at))::int AS age_seconds
       FROM working_memory
       WHERE key LIKE $1 OR key = $2`,
      [`${KEY_PREFIX}%`, EXPECTED_KEY]
    );
    let expected = null;
    const jobs = [];
    for (const row of rows) {
      if (row.key === EXPECTED_KEY) {
        const c = parseInt(row.value_json?.count, 10);
        expected = Number.isFinite(c) ? c : null;
        continue;
      }
      const v = row.value_json || {};
      jobs.push({
        name: row.key.slice(KEY_PREFIX.length),
        ok: v.ok === true,
        age_seconds: row.age_seconds,
        at: v.at ?? null,
      });
    }
    const healthy =
      expected !== null &&
      jobs.length >= expected &&
      jobs.every((j) => j.ok && j.age_seconds <= STALE_SECONDS);
    res.json({ jobs, expected, healthy });
  } catch (err) {
    console.error('[sentinel] health error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
