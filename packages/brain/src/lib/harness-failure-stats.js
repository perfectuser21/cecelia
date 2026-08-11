/**
 * harness-failure-stats — GET /api/brain/harness/failure-stats 的纯计量逻辑（决策 e8f6134f 交付物2）。
 *
 * 从路由 handler 抽出 days 校验与聚合计量两段纯函数，便于 brain-unit 无 DB 直测（真断言、不 mock DB 读）；
 * 路由层只保留 SQL 查询 IO 与 res 组装。DB 聚合真值由 sprint 合同测试 + real-env-smoke 用真 Postgres 验（禁 mock 边）。
 */

/** days query 参数校验：缺省 7；必须是 1..365 的整数，否则返回 { error }。 */
export function parseFailureStatsDays(raw) {
  const days = Number(raw === undefined ? 7 : raw);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    return { error: 'days must be an integer between 1 and 365' };
  }
  return { days };
}

/**
 * 由窗口内 harness 任务总数（分母）+ 按 failure_class 分组的 terminal 失败行，
 * 组装 failure-stats 响应体。by_class 各类之和恒等 terminal_failed_count（无双重计数）；
 * 分母 0 → failure_rate 0（不除零）；失败率保留两位小数。
 *
 * @param {number} days - 规范化后的窗口天数
 * @param {number|string} totalTasks - 窗口内 harness 任务总数
 * @param {Array<{failure_class: string, cnt: number|string}>} classRows - GROUP BY failure_class 结果
 */
export function buildFailureStats(days, totalTasks, classRows) {
  const by_class = {};
  let terminal_failed_count = 0;
  for (const r of classRows || []) {
    const cnt = parseInt(r.cnt, 10) || 0;
    by_class[r.failure_class] = cnt;
    terminal_failed_count += cnt;
  }
  const total_tasks = parseInt(totalTasks, 10) || 0;
  const failure_rate = total_tasks > 0
    ? Math.round((terminal_failed_count / total_tasks) * 100) / 100
    : 0;
  return {
    window_days: days,
    total_tasks,
    terminal_failed_count,
    failure_rate,
    by_class,
  };
}
