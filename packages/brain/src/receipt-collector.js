/**
 * receipt-collector.js — 对外动作回执台账（九要素 T4）
 *
 * 三入口（notifier sendFeishu/sendBark、feishu-alert sendToFeishu、ops.js deploy webhook）
 * 真正发起对外调用时写 action_receipts(pending)，按真实结果核销 confirmed/failed；
 * 无人核销的 pending 由 runReceiptCollector（scheduler-jobs 60s 轮询 + 本模块 10min 自 gate）
 * 超 30min 标 timeout。未确认段由 getUnconfirmedReceipts 喂 battle-report 第⑥段。
 * 表结构见 migrations/315_action_receipts_and_decision_review.sql。
 *
 * ⚠️ 只 import ./db.js，严禁 import notifier.js / alerting.js（alerting→notifier 潜在环）。
 * record/resolve 全路径 fail-open：DB 错误只 console.warn，never breaks main flow。
 */
import pool from './db.js';

const VALID_RESOLVE_STATUS = new Set(['confirmed', 'failed']);
/** pending 超过该分钟数未核销 → timeout（feishu/bark 秒级、deploy 最长 ~15min，30min 全覆盖） */
const TIMEOUT_MINUTES = 30;
const INTERVAL_MS = parseInt(
  process.env.CECELIA_RECEIPT_COLLECTOR_INTERVAL_MS || String(10 * 60 * 1000),
  10
);

let lastRunAt = 0;
export function __resetReceiptCollectorForTest() {
  lastRunAt = 0;
}

/**
 * 写一条 pending 回执（对外动作发起时调用）。
 * @param {{kind: string, target?: string|null, actionId?: string|null, evidence?: object}} args
 * @returns {Promise<string|null>} receipt id；kind 缺失或 DB 错误返回 null
 */
export async function recordActionReceipt({ kind, target = null, actionId = null, evidence = {} } = {}) {
  if (!kind) return null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO action_receipts (action_id, kind, target, receipt_status, evidence)
       VALUES ($1, $2, $3, 'pending', $4)
       RETURNING id`,
      [actionId, kind, target, JSON.stringify(evidence || {})]
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    console.warn(`[receipt-collector] record 失败（fail-open）: ${err.message}`);
    return null;
  }
}

/**
 * 按真实结果核销回执（仅 pending 行可核销，幂等）。
 * @param {string|null} id - recordActionReceipt 返回值（null 直接跳过）
 * @param {'confirmed'|'failed'} status
 * @param {object} [evidence] - 合并进 evidence JSONB
 * @returns {Promise<boolean>}
 */
export async function resolveActionReceipt(id, status, evidence = {}) {
  if (!id || !VALID_RESOLVE_STATUS.has(status)) return false;
  try {
    const { rowCount } = await pool.query(
      `UPDATE action_receipts
       SET receipt_status = $2, evidence = evidence || $3::jsonb, updated_at = NOW()
       WHERE id = $1 AND receipt_status = 'pending'`,
      [id, status, JSON.stringify(evidence || {})]
    );
    return rowCount > 0;
  } catch (err) {
    console.warn(`[receipt-collector] resolve 失败（fail-open）: ${err.message}`);
    return false;
  }
}

/**
 * 核销 tick（scheduler-jobs handler）：pending 超 30min → timeout。
 * 自 gate：10min 间隔（照 capture-triage 先例，env CECELIA_RECEIPT_COLLECTOR_INTERVAL_MS 可覆盖）。
 * @param {import('pg').Pool} dbPool
 * @returns {Promise<{skipped?: true, timedOut: number}>}
 */
export async function runReceiptCollector(dbPool) {
  const now = Date.now();
  if (now - lastRunAt < INTERVAL_MS) return { skipped: true, timedOut: 0 };
  lastRunAt = now;

  const { rows } = await dbPool.query(
    `UPDATE action_receipts
     SET receipt_status = 'timeout', updated_at = NOW()
     WHERE receipt_status = 'pending'
       AND sent_at < NOW() - make_interval(mins => $1)
     RETURNING id, kind`,
    [TIMEOUT_MINUTES]
  );
  if (rows.length > 0) {
    console.warn(
      `[receipt-collector] ${rows.length} 条回执超时未核销 → timeout: ${rows.map((r) => r.kind).join(',')}`
    );
  }
  return { timedOut: rows.length };
}

/**
 * 24h 内未确认动作（pending/timeout/failed），供 battle-report 第⑥段。
 * @param {import('pg').Pool} dbPool
 * @returns {Promise<Array<{kind: string, target: string|null, receipt_status: string, sent_at: Date}>>}
 */
export async function getUnconfirmedReceipts(dbPool) {
  const { rows } = await dbPool.query(
    `SELECT kind, target, receipt_status, sent_at
     FROM action_receipts
     WHERE receipt_status IN ('pending', 'timeout', 'failed')
       AND sent_at >= NOW() - interval '24 hours'
     ORDER BY sent_at DESC
     LIMIT 50`
  );
  return rows;
}
