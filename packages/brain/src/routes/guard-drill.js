/**
 * guard-drill routes — 月度守卫演习台账 API
 *
 * GET /api/brain/guard-drill/status
 *   → { guards: [{id, name, auto, last_verified_at, last_drill_at, stale}], last_run }
 *
 * POST /api/brain/guard-drill/trigger
 *   → 立即触发一次演习（重置 lastRunAt gate，用于手动验火）
 */

import { Router } from 'express';
import pool from '../db.js';
import { GUARD_REGISTRY, runGuardDrill, __resetGuardDrillForTest } from '../guard-drill.js';

const router = Router();

const STALE_DAYS = 90;

function daysSince(isoStr) {
  if (!isoStr) return Infinity;
  return (Date.now() - new Date(isoStr).getTime()) / (24 * 60 * 60 * 1000);
}

router.get('/status', async (_req, res) => {
  try {
    const kvResult = await pool.query(
      "SELECT value_json FROM working_memory WHERE key='guard-drill-status'",
    );
    const statusKv = kvResult.rows[0]?.value_json ?? {};

    const lastRunResult = await pool.query(
      "SELECT value_json, updated_at FROM working_memory WHERE key='guard-drill-last-run'",
    );
    const lastRun = lastRunResult.rows[0]?.value_json ?? null;
    const lastRunAt = lastRunResult.rows[0]?.updated_at ?? null;

    const guards = GUARD_REGISTRY.map((g) => {
      const kv = statusKv[g.id] ?? {};
      const days = daysSince(kv.last_verified_at);
      return {
        id: g.id,
        name: g.name,
        file: g.file,
        auto: g.auto,
        boundary: g.boundary,
        last_verified_at: kv.last_verified_at ?? null,
        last_drill_at: kv.last_drill_at ?? null,
        last_drill_fired: kv.last_drill_fired ?? null,
        stale: days > STALE_DAYS,
        days_since_verified: days === Infinity ? null : Math.floor(days),
      };
    });

    res.json({ guards, last_run: lastRun, last_run_at: lastRunAt, stale_threshold_days: STALE_DAYS });
  } catch (err) {
    console.error('[guard-drill] status 查询失败：', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/trigger', async (_req, res) => {
  try {
    __resetGuardDrillForTest();
    const result = await runGuardDrill();
    res.json({ ok: true, result });
  } catch (err) {
    console.error('[guard-drill] trigger 失败：', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
