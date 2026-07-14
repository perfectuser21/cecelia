/**
 * Quality API Routes — 测试金字塔快照存取
 *
 * - POST /api/brain/quality/test-pyramid — 接收 test-pyramid-guard --json 输出，
 *   upsert 到 working_memory（key=quality_test_pyramid，含 updated_at）。
 *   数据源：scripts/write-current-state.sh 日更 best-effort POST。
 * - GET  /api/brain/quality/test-pyramid — 返回 {available:true, updated_at, ...快照}；
 *   无数据/DB 异常 → 200 {available:false[, error]}（Dashboard 面板灰态数据，不 500）。
 */

import { Router } from 'express';
import pool from '../db.js';

const MEMORY_KEY = 'quality_test_pyramid';

const router = Router();

router.post('/test-pyramid', async (req, res) => {
  const snapshot = req.body;
  if (!snapshot || typeof snapshot !== 'object' || typeof snapshot.pass !== 'boolean') {
    return res.status(400).json({ error: 'body 必须是 guard JSON（含布尔 pass 字段）' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO working_memory(key, value_json, updated_at)
       VALUES($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value_json = $2::jsonb, updated_at = NOW()
       RETURNING updated_at`,
      [MEMORY_KEY, JSON.stringify(snapshot)]
    );
    res.json({ ok: true, updated_at: result.rows[0]?.updated_at ?? new Date().toISOString() });
  } catch (err) {
    console.error('[quality/test-pyramid] POST failed:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/test-pyramid', async (_req, res) => {
  try {
    const [snapshotResult, bareFrResult] = await Promise.all([
      pool.query('SELECT value_json, updated_at FROM working_memory WHERE key = $1', [MEMORY_KEY]),
      pool.query(`SELECT COUNT(*)::int AS count FROM journey_features WHERE guard_ref IS NULL AND status = 'live'`).catch(() => null),
    ]);
    const row = snapshotResult.rows[0];
    if (!row || !row.value_json) {
      return res.json({ available: false });
    }
    const liveFrCount = bareFrResult?.rows?.[0]?.count ?? null;
    const snapshotBareFr = row.value_json?.bare_fr ?? null;
    // 用实时库查值覆盖快照计数，基线保留快照里的值
    const bare_fr = liveFrCount !== null && snapshotBareFr !== null
      ? { ...snapshotBareFr, count: liveFrCount }
      : snapshotBareFr;
    res.json({ available: true, updated_at: row.updated_at, ...row.value_json, bare_fr });
  } catch (err) {
    console.error('[quality/test-pyramid] GET failed:', err);
    res.json({ available: false, error: err.message });
  }
});

export default router;
