/**
 * paused-requeuer-plugin.js — Brain v2
 *
 * 把 paused-requeuer.js 的核心逻辑包装为 tick-runner.js 插件接口。
 * 每 5 分钟扫 paused>1h+retry<3 → requeue；retry>=3 → archived。
 *
 * 节流门：PAUSED_REQUEUE_INTERVAL_MS（默认 5min，env 可覆盖）
 *   - elapsed < interval → 返回 { skipped: true, reason: 'throttled' }
 *   - 否则更新 tickState.lastPausedRequeuTime 并执行 runPausedRequeue
 *
 * 失败处理：内部 catch，错误打 console.error 并返回 { error }，不冒泡到 tick-runner。
 */

import { runPausedRequeue } from './paused-requeuer.js';

const PAUSED_REQUEUE_INTERVAL_MS = parseInt(
  process.env.CECELIA_PAUSED_REQUEUE_INTERVAL_MS || String(5 * 60 * 1000),
  10
);

/**
 * @param {{
 *   pool?: import('pg').Pool,
 *   tickState: { lastPausedRequeuTime: number },
 *   tickLog?: (...args: any[]) => void,
 *   intervalMs?: number,
 * }} ctx
 * @returns {Promise<null | { requeued?: number, archived?: number, skipped?: boolean, reason?: string, error?: string }>}
 */
export async function tick({ pool: dbPool, tickState, tickLog, intervalMs } = {}) {
  if (!tickState) throw new Error('paused-requeuer: tickState required');
  const interval = intervalMs ?? PAUSED_REQUEUE_INTERVAL_MS;
  const elapsed = Date.now() - (tickState.lastPausedRequeuTime || 0);
  if (elapsed < interval) {
    return { skipped: true, reason: 'throttled' };
  }
  tickState.lastPausedRequeuTime = Date.now();
  try {
    const r = await runPausedRequeue(dbPool);
    if (r.requeued > 0 || r.archived > 0) {
      tickLog?.(`[tick] Paused requeuer: requeued=${r.requeued} archived=${r.archived}`);
    }
    return r;
  } catch (err) {
    console.error('[tick] Paused requeuer failed (non-fatal):', err.message);
    return { error: err.message };
  }
}

export default { tick };
