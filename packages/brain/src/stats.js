/**
 * stats.js
 * PR 统计查询模块 - 追踪自主完成的 PR 数量
 *
 * 职责：
 * - 查询当月完成的 dev 任务（即自主 PR）数量
 * - 按 KR 过滤 PR 数量
 * - 计算 PR 成功率
 * - 获取最近 N 天 PR 趋势
 */

/**
 * 获取指定月份完成的 dev 任务（PR）数量
 *
 * @param {import('pg').Pool} pool - 数据库连接池
 * @param {number} month - 月份 (1-12)
 * @param {number} year - 年份 (e.g. 2026)
 * @returns {Promise<number>} 完成的 PR 数量
 */
export async function getMonthlyPRCount(pool, month, year) {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 1);

  const result = await pool.query(
    `SELECT COUNT(*) AS count
     FROM tasks
     WHERE status = 'completed'
       AND task_type = 'dev'
       AND completed_at >= $1
       AND completed_at < $2`,
    [startDate.toISOString(), endDate.toISOString()]
  );

  return parseInt(result.rows[0]?.count ?? '0', 10);
}

/**
 * 获取某个 KR 下当月完成的 PR 数量
 * KR 通过 goals 表存储，tasks.goal_id 关联 goals.id
 *
 * @param {import('pg').Pool} pool - 数据库连接池
 * @param {string} kr_id - KR 的 UUID（goals.id）
 * @param {number} month - 月份 (1-12)
 * @param {number} year - 年份 (e.g. 2026)
 * @returns {Promise<number>} 该 KR 下完成的 PR 数量
 */
export async function getMonthlyPRsByKR(pool, kr_id, month, year) {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 1);

  const result = await pool.query(
    `SELECT COUNT(*) AS count
     FROM tasks
     WHERE status = 'completed'
       AND task_type = 'dev'
       AND goal_id = $1
       AND completed_at >= $2
       AND completed_at < $3`,
    [kr_id, startDate.toISOString(), endDate.toISOString()]
  );

  return parseInt(result.rows[0]?.count ?? '0', 10);
}

/**
 * 计算当月 PR 成功率
 * 成功率 = completed / (completed + failed)
 *
 * @param {import('pg').Pool} pool - 数据库连接池
 * @param {number} month - 月份 (1-12)
 * @param {number} year - 年份 (e.g. 2026)
 * @returns {Promise<number|null>} 成功率 (0-1)，无数据时返回 null
 */
export async function getPRSuccessRate(pool, month, year) {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 1);

  const result = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'completed') AS completed_count,
       COUNT(*) FILTER (WHERE status = 'failed') AS failed_count
     FROM tasks
     WHERE task_type = 'dev'
       AND (
         (status = 'completed' AND completed_at >= $1 AND completed_at < $2)
         OR
         (status = 'failed' AND updated_at >= $1 AND updated_at < $2)
       )`,
    [startDate.toISOString(), endDate.toISOString()]
  );

  const completed = parseInt(result.rows[0]?.completed_count ?? '0', 10);
  const failed = parseInt(result.rows[0]?.failed_count ?? '0', 10);
  const total = completed + failed;

  if (total === 0) return null;

  return completed / total;
}

/**
 * 获取最近 N 天每日 PR 完成趋势
 *
 * @param {import('pg').Pool} pool - 数据库连接池
 * @param {number} days - 天数 (1-365)，默认 30
 * @returns {Promise<Array<{date: string, count: number}>>} 每日数据数组
 */
export async function getPRTrend(pool, days = 30) {
  const safeDays = Math.max(1, Math.min(365, days));
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - safeDays);
  startDate.setHours(0, 0, 0, 0);

  const result = await pool.query(
    `SELECT
       DATE(completed_at) AS date,
       COUNT(*) AS count
     FROM tasks
     WHERE status = 'completed'
       AND task_type = 'dev'
       AND completed_at >= $1
     GROUP BY DATE(completed_at)
     ORDER BY date ASC`,
    [startDate.toISOString()]
  );

  return result.rows.map(row => ({
    date: row.date instanceof Date
      ? row.date.toISOString().slice(0, 10)
      : String(row.date),
    count: parseInt(row.count, 10)
  }));
}
