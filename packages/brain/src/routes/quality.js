/**
 * Quality API Routes — 测试金字塔快照存取 + 七环对账 KV + 棘轮台账
 *
 * - POST /api/brain/quality/test-pyramid — 接收 test-pyramid-guard --json 输出，
 *   upsert 到 working_memory（key=quality_test_pyramid，含 updated_at）。
 *   数据源：CI test-pyramid-guard job POST（历史脚本数据源已于 2026-08 刀0.5 退役）。
 * - GET  /api/brain/quality/test-pyramid — 返回 {available:true, updated_at, ...快照}；
 *   无数据/DB 异常 → 200 {available:false[, error]}（Dashboard 面板灰态数据，不 500）。
 * - GET  /api/brain/kv/:key — 通用 working_memory KV 读取（供外部巡检读取任意快照键）
 * - GET  /api/brain/quality/seven-ring — 七环对账最新结果（来自 scheduler-jobs 日跑写入）
 * - POST /api/brain/quality/seven-ring/trigger — 立即触发一次七环审计（跳过24h冷却）
 * - GET  /api/brain/quality/ratchet — 棘轮台账（ratchet-registry.json）条目列表
 */

import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pool from '../db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RATCHET_REGISTRY_PATH = join(__dirname, '../../../../scripts/ratchet-registry.json');

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

// ── 七环对账路由 ──────────────────────────────────────────────────────────────

const SEVEN_RING_KEY = 'seven_ring_audit_last';

router.get('/seven-ring', async (_req, res) => {
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
    console.error('[quality/seven-ring] GET failed:', err);
    res.json({ available: false, error: err.message });
  }
});

router.post('/seven-ring/trigger', async (_req, res) => {
  try {
    const { runSevenRingAudit, __resetSevenRingAuditForTest } = await import('../seven-ring-audit.js');
    __resetSevenRingAuditForTest();
    const result = await runSevenRingAudit(pool);
    await pool.query(
      `INSERT INTO working_memory (key, value_json, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value_json = $2::jsonb, updated_at = NOW()`,
      [SEVEN_RING_KEY, JSON.stringify(result)],
    );
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[quality/seven-ring/trigger] POST failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── 棘轮台账路由 ──────────────────────────────────────────────────────────────

router.get('/ratchet', (_req, res) => {
  try {
    const registry = JSON.parse(readFileSync(RATCHET_REGISTRY_PATH, 'utf8'));
    res.json({ available: true, registry });
  } catch (err) {
    res.json({ available: false, error: err.message });
  }
});

export default router;
