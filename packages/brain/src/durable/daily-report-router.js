/**
 * daily-report-router.js
 *
 * tick 日报的 flag 门控路由：
 *   DBOS_DURABLE_ENABLED!=='true'（默认） → 走原 generateDailyReport(pool, now)（行为零变化）
 *   DBOS_DURABLE_ENABLED==='true'         → 走 durableDailyReport(pool, now)（崩溃可恢复）
 *
 * C1 注意：durable 模块的 registerStep/registerWorkflow 已由 dbos-runtime.js 在 boot 时
 * 静态 import 完成（早于 DBOS.launch()）。这里的 import() 只命中已加载缓存，绝不会触发
 * launch 后注册。
 */

import { isDurableEnabled } from './dbos-runtime.js';

/**
 * @param {import('pg').Pool} pool
 * @param {object} [deps] - 测试注入两条路径；生产留空走真实模块
 * @param {(pool: any, now?: Date) => Promise<any>} [deps.original]
 * @param {(pool: any, now?: Date) => Promise<any>} [deps.durable]
 * @param {Date} [now] - 当前时间（默认 new Date()，透传给两条路径的触发窗口/去重判断）
 * @returns {Promise<any>}
 */
export async function routeDailyReport(pool, deps = {}, now = new Date()) {
  if (isDurableEnabled()) {
    const durable =
      deps.durable ||
      (await import('./daily-report-durable.js')).durableDailyReport;
    return durable(pool, now);
  }
  const original =
    deps.original ||
    (await import('../daily-report-generator.js')).generateDailyReport;
  return original(pool, now);
}
