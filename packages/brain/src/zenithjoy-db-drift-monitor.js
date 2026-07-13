/**
 * zenithjoy-db-drift-monitor.js — 刀1c/1d 双写验证期漂移监控
 *
 * 在 ZENITHJOY_DB_NAME 已设（独立 zenithjoy 库启用）期间，每 6h 对比
 * cecelia 库 zenithjoy schema 与独立 zenithjoy 库的关键表行数。
 * 行数漂移超阈值 → Bark 告警 + sentinel 写 error。
 * ZENITHJOY_DB_NAME 未设 → no-op，向后兼容。
 */
import { getZenithjoyPool } from './zenithjoy-db.js';
import { sendBark } from './notifier.js';

const SENTINEL_KEY = 'scheduler_job_last_run:zenithjoy-db-drift-monitor';
const GATE_MS = 6 * 60 * 60 * 1000;
const DRIFT_THRESHOLD = 5;

const MONITOR_TABLES = [
  'wechat_publish_task',
  'works',
  'publish_logs',
  'tenants',
];

async function getCount(pool, table) {
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS cnt FROM zenithjoy.${table}`,
  );
  return parseInt(rows[0].cnt, 10);
}

async function readSentinel(pool) {
  try {
    const { rows } = await pool.query(
      `SELECT value_json FROM working_memory WHERE key = $1`,
      [SENTINEL_KEY],
    );
    if (rows.length === 0) return null;
    return JSON.parse(rows[0].value_json);
  } catch {
    return null;
  }
}

async function writeSentinel(pool, record) {
  try {
    await pool.query(
      `INSERT INTO working_memory (key, value_json, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
      [SENTINEL_KEY, JSON.stringify(record)],
    );
  } catch (e) {
    console.warn('[zj-drift-monitor] sentinel write failed:', e.message);
  }
}

/**
 * 主入口：在 scheduler-jobs 60s 轮询中被调用。
 * @param {import('pg').Pool} pool - Brain 主 pool（cecelia DB）
 * @returns {Promise<null | {ok:boolean, drift:Array, db:string, at:string}>}
 */
export async function runZenithjoyDbDriftMonitor(pool) {
  if (!process.env.ZENITHJOY_DB_NAME) return null;

  const prev = await readSentinel(pool);
  if (prev?.at && Date.now() - new Date(prev.at).getTime() < GATE_MS) {
    return null;
  }

  const db = process.env.ZENITHJOY_DB_NAME;
  const at = new Date().toISOString();

  try {
    const zjPool = getZenithjoyPool();
    const drift = [];

    for (const table of MONITOR_TABLES) {
      const [ceceliaCount, zjCount] = await Promise.all([
        getCount(pool, table),
        getCount(zjPool, table),
      ]);
      const delta = Math.abs(ceceliaCount - zjCount);
      if (delta > DRIFT_THRESHOLD) {
        drift.push({ table, cecelia: ceceliaCount, zenithjoy: zjCount, delta });
      }
    }

    const ok = drift.length === 0;
    const record = { ok, drift, db, at };
    await writeSentinel(pool, record);

    if (!ok) {
      const summary = drift
        .map((d) => `${d.table}: cecelia=${d.cecelia} zj=${d.zenithjoy}`)
        .join(', ');
      await sendBark(
        `zenithjoy DB drift 告警`,
        `刀1d 双写期漂移超阈值 ${DRIFT_THRESHOLD}: ${summary}`,
        { dedupeKey: `zj-drift-${at.slice(0, 10)}` },
      );
      console.error(`[zj-drift-monitor] drift detected: ${summary}`);
    } else {
      console.log(`[zj-drift-monitor] ok — all ${MONITOR_TABLES.length} tables within threshold`);
    }

    return record;
  } catch (e) {
    const record = { ok: false, error: e.message, db, at };
    await writeSentinel(pool, record);
    try {
      await sendBark(
        `zenithjoy DB drift 监控错误`,
        `连接独立 zenithjoy 库失败: ${e.message}`,
        { dedupeKey: `zj-drift-error-${at.slice(0, 13)}` },
      );
    } catch { /* Bark 失败不影响主流程 */ }
    console.error('[zj-drift-monitor] error:', e.message);
    return record;
  }
}
