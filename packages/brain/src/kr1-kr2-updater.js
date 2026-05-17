/**
 * kr1-kr2-updater.js
 *
 * 每 tick 计算近7日发布成功率，回写 KR1（多平台）和 KR2（微信）的 current_value。
 *
 * KR1: d86f67df-04c8-47dc-922f-c0e4fd0645bb — 非微信平台7日均值成功率
 * KR2: f19118cd-c4fe-478d-abf5-00bde5566a05 — 微信平台7日均值成功率
 *      (兼容备用 UUID: f19118cd-3af4-4c50-b73d-a67a9218b2de)
 *
 * current_value = 实测成功率百分比（0-100）
 * progress = min(100, current_value / 90 * 100)
 *
 * 设计：fire-and-forget 友好，内部捕获所有异常不抛出
 */

const KR1_ID = 'd86f67df-04c8-47dc-922f-c0e4fd0645bb';

// KR2 两个 UUID：migration 223 和 PRD 中的版本，兼容两者
const KR2_IDS = [
  'f19118cd-c4fe-478d-abf5-00bde5566a05',
  'f19118cd-3af4-4c50-b73d-a67a9218b2de',
];

/** 成功率达标阈值（≥90% = 100% progress） */
const SUCCESS_RATE_THRESHOLD = 90;

/**
 * 查询近7日指定平台的平均发布成功率。
 *
 * @param {import('pg').Pool} pool
 * @param {'wechat'|'non-wechat'} target
 * @returns {Promise<number|null>} 成功率 0-100，无数据时返回 null
 */
async function fetchAvgSuccessRate(pool, target) {
  const platformClause = target === 'wechat'
    ? "platform = 'wechat'"
    : "platform != 'wechat'";

  const { rows } = await pool.query(
    `SELECT COALESCE(ROUND(AVG(success_rate)::numeric, 2), NULL) AS rate
     FROM publish_success_daily
     WHERE date >= CURRENT_DATE - INTERVAL '6 days'
       AND ${platformClause}
       AND success_rate IS NOT NULL`,
  );

  const rate = rows[0]?.rate;
  return rate !== null && rate !== undefined ? parseFloat(rate) : null;
}

/**
 * 更新单个 KR 的 current_value 和 progress。
 *
 * @param {import('pg').Pool} pool
 * @param {string} krId
 * @param {number} successRate
 * @returns {Promise<boolean>}
 */
async function updateKR(pool, krId, successRate) {
  const progress = Math.min(100, Math.round((successRate / SUCCESS_RATE_THRESHOLD) * 100));
  const { rowCount } = await pool.query(
    `UPDATE key_results
     SET current_value = $1,
         progress      = $2,
         progress_pct  = $2,
         updated_at    = NOW()
     WHERE id = $3`,
    [successRate, progress, krId],
  );
  return rowCount > 0;
}

/**
 * 更新 KR2（尝试两个已知 UUID，取先命中的那个）。
 *
 * @param {import('pg').Pool} pool
 * @param {number} successRate
 * @returns {Promise<boolean>}
 */
async function updateKR2(pool, successRate) {
  for (const krId of KR2_IDS) {
    const updated = await updateKR(pool, krId, successRate);
    if (updated) return true;
  }
  return false;
}

/**
 * 每 tick 计算并回写 KR1/KR2 发布成功率。
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<{ kr1: number|null, kr2: number|null }>}
 */
export async function updatePublishSuccessKRs(pool) {
  let kr1Rate = null;
  let kr2Rate = null;

  try {
    kr1Rate = await fetchAvgSuccessRate(pool, 'non-wechat');
    if (kr1Rate !== null) {
      const updated = await updateKR(pool, KR1_ID, kr1Rate);
      if (updated) {
        console.log(`[kr1-kr2-updater] KR1 current_value=${kr1Rate}%`);
      }
    }
  } catch (err) {
    console.error(`[kr1-kr2-updater] KR1 更新失败: ${err.message}`);
  }

  try {
    kr2Rate = await fetchAvgSuccessRate(pool, 'wechat');
    if (kr2Rate !== null) {
      const updated = await updateKR2(pool, kr2Rate);
      if (updated) {
        console.log(`[kr1-kr2-updater] KR2 current_value=${kr2Rate}%`);
      }
    }
  } catch (err) {
    console.error(`[kr1-kr2-updater] KR2 更新失败: ${err.message}`);
  }

  return { kr1: kr1Rate, kr2: kr2Rate };
}
