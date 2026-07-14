/**
 * Quality API Routes — 测试金字塔快照存取 + 七环对账查询
 *
 * - POST /api/brain/quality/test-pyramid — 接收 test-pyramid-guard --json 输出，
 *   upsert 到 working_memory（key=quality_test_pyramid，含 updated_at）。
 *   数据源：scripts/write-current-state.sh 日更 best-effort POST。
 * - GET  /api/brain/quality/test-pyramid — 返回 {available:true, updated_at, ...快照}；
 *   无数据/DB 异常 → 200 {available:false[, error]}（Dashboard 面板灰态数据，不 500）。
 * - GET  /api/brain/quality/seven-ring-audit — 返回最后一次七环对账结果。
 * - POST /api/brain/quality/seven-ring-audit/run — 立即触发一次七环对账（开发/手测用）。
 */

import { Router } from 'express';
import pool from '../db.js';

const MEMORY_KEY = 'quality_test_pyramid';
const SEVEN_RING_KEY = 'seven_ring_audit_last';

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
    const result = await pool.query(
      'SELECT value_json, updated_at FROM working_memory WHERE key = $1',
      [MEMORY_KEY]
    );
    const row = result.rows[0];
    if (!row || !row.value_json) {
      return res.json({ available: false });
    }
    res.json({ available: true, updated_at: row.updated_at, ...row.value_json });
  } catch (err) {
    console.error('[quality/test-pyramid] GET failed:', err);
    res.json({ available: false, error: err.message });
  }
});

// ── 七环对账 ──────────────────────────────────────────────────────────────────

router.get('/seven-ring-audit', async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT value_json, updated_at FROM working_memory WHERE key = $1',
      [SEVEN_RING_KEY],
    );
    const row = result.rows[0];
    if (!row || !row.value_json) {
      return res.json({ available: false });
    }
    res.json({ available: true, updated_at: row.updated_at, ...row.value_json });
  } catch (err) {
    console.error('[quality/seven-ring-audit] GET failed:', err);
    res.json({ available: false, error: err.message });
  }
});

router.post('/seven-ring-audit/run', async (_req, res) => {
  try {
    const { runSevenRingAudit } = await import('../seven-ring-audit.js');
    const result = await runSevenRingAudit(pool);
    res.json({ ok: true, result });
  } catch (err) {
    console.error('[quality/seven-ring-audit/run] failed:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
