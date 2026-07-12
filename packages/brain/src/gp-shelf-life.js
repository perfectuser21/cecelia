/**
 * gp-shelf-life.js — Golden Path 保质期 delta 检查（T1 GP底座）
 *
 * 双重 delta 检查（照 receipt-collector.js 10min 自 gate 模式）：
 *   ① approved 超 review_after 且仍在 approved 态（未开工）→ 置 expired + status_reason
 *   ② auto_release=true 且 veto_deadline 已过且仍在 candidate/proposed 态 → 置 approved 留痕
 *      （b416bfb3 报备制：24h 否决窗过期未否决 → 自动生效 approved）
 *
 * 调用方式：scheduler-jobs.js 60s 轮询；自 gate 保证实际执行间隔 ≥ 10min。
 */
import pool from './db.js';

const INTERVAL_MS = parseInt(
  process.env.CECELIA_GP_SHELF_LIFE_INTERVAL_MS || String(10 * 60 * 1000),
  10,
);

let lastRunAt = 0;

export function __resetGpShelfLifeForTest() {
  lastRunAt = 0;
}

/**
 * 主检查函数（供 scheduler-jobs handler 调用）。
 * @param {import('pg').Pool} dbPool
 * @returns {Promise<{skipped?: true, expired: number, autoApproved: number}>}
 */
export async function runGpShelfLife(dbPool) {
  const now = Date.now();
  if (now - lastRunAt < INTERVAL_MS) return { skipped: true, expired: 0, autoApproved: 0 };
  lastRunAt = now;

  const db = dbPool ?? pool;
  let expired = 0;
  let autoApproved = 0;

  try {
    // ① approved 超保质期未开工 → expired
    const expiredResult = await db.query(
      `UPDATE golden_paths
       SET status = 'expired',
           status_reason = '超保质期未开工，重上批审',
           updated_at = NOW()
       WHERE status = 'approved'
         AND review_after IS NOT NULL
         AND review_after < NOW()
       RETURNING id`,
    );
    expired = expiredResult.rowCount ?? 0;
    if (expired > 0) {
      console.log(`[gp-shelf-life] ${expired} approved GP(s) expired (超 review_after 未开工)`);
    }

    // ② 报备制：veto_deadline 过期且仍处 candidate/proposed 且 auto_release=true → approved
    const autoResult = await db.query(
      `UPDATE golden_paths
       SET status = 'approved',
           approved_at = NOW(),
           review_after = NOW() + INTERVAL '14 days',
           status_reason = '报备制：否决窗已过，自动生效 approved',
           updated_at = NOW()
       WHERE auto_release = true
         AND veto_deadline IS NOT NULL
         AND veto_deadline < NOW()
         AND status IN ('candidate', 'proposed')
       RETURNING id`,
    );
    autoApproved = autoResult.rowCount ?? 0;
    if (autoApproved > 0) {
      console.log(`[gp-shelf-life] ${autoApproved} GP(s) auto-approved (报备否决窗过期)`);
    }
  } catch (err) {
    console.warn(`[gp-shelf-life] delta 检查失败: ${err.message}`);
  }

  return { expired, autoApproved };
}
