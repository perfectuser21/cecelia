/**
 * daily-report-router.js
 *
 * tick 日报的 flag 门控路由：
 *   DBOS_DURABLE_ENABLED!=='true'（默认） → 走原 generateDailyReport(pool)（行为零变化）
 *   DBOS_DURABLE_ENABLED==='true'         → 走 durableDailyReport(pool)（崩溃可恢复）
 *
 * 两条路径动态 import（durable 路径仅在开 flag 时加载，关 flag 时零额外加载/影响）。
 */

import { isDurableEnabled } from './dbos-runtime.js';

/**
 * @param {import('pg').Pool} pool
 * @param {object} [deps] - 测试注入两条路径；生产留空走真实模块
 * @param {(pool: any) => Promise<any>} [deps.original]
 * @param {(pool: any) => Promise<any>} [deps.durable]
 * @returns {Promise<any>}
 */
export async function routeDailyReport(pool, deps = {}) {
  if (isDurableEnabled()) {
    const durable =
      deps.durable ||
      (await import('./daily-report-durable.js')).durableDailyReport;
    return durable(pool);
  }
  const original =
    deps.original ||
    (await import('../daily-report-generator.js')).generateDailyReport;
  return original(pool);
}
