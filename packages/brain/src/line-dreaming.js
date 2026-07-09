/**
 * line-dreaming.js — L1 line 级夜间蒸馏 job（dreaming L1）
 *
 * 每晚北京 05:00（UTC 21:00，排在 battle-report 之前）把每条 active line（journey）
 * 的 24h 事实（decisions/journey_features/advancement_items/issues/initiative_runs/
 * learnings/军师留痕）蒸馏成一份 markdown 摘要，落 design_docs(type='line_ledger')。
 * diary / arch_review / strategy_session 三个 L3 文档改为消费这份摘要，不再各自
 * 重新拉一遍 24h 原始切片（口径统一 + 减少重复查询）。
 */

/** 每晚触发小时（UTC）= 北京时间 05:00 */
const LINE_DREAMING_HOUR_UTC = 21;

/**
 * 判断当前是否在夜间蒸馏窗口内（UTC 21:00-21:05 = 北京 05:00-05:05）。
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isInLineDreamingWindow(now = new Date()) {
  return now.getUTCHours() === LINE_DREAMING_HOUR_UTC && now.getUTCMinutes() < 5;
}

/**
 * 该 journey 20h 内是否已有 line_ledger 记录（去重）。
 * @param {import('pg').Pool} pool
 * @param {string} journeyId
 * @returns {Promise<boolean>}
 */
export async function alreadyDreamedToday(pool, journeyId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM design_docs
     WHERE type = 'line_ledger'
       AND journey_id = $1
       AND created_at >= NOW() - INTERVAL '20 hours'
     LIMIT 1`,
    [journeyId]
  );
  return rows.length > 0;
}

/**
 * 拉所有 active journey（line）。
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function getActiveJourneys(pool) {
  const { rows } = await pool.query(
    `SELECT id, name FROM journeys WHERE status = 'active' ORDER BY name`
  );
  return rows.map((r) => ({ id: r.id, name: r.name }));
}
