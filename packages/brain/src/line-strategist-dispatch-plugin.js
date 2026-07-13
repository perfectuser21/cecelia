/**
 * line-strategist-dispatch-plugin.js
 *
 * tick-runner.js 感知层插件：每 10 分钟扫描落终态任务，按 line 派发 strategist_decision。
 * 节流门同 pipeline-patrol-plugin.js 同款约定：elapsed < interval → { skipped, reason }。
 */

import { dispatchStrategistDecisions } from './line-strategist-dispatch.js';

const LINE_STRATEGIST_DISPATCH_INTERVAL_MS = parseInt(
  process.env.CECELIA_LINE_STRATEGIST_DISPATCH_INTERVAL_MS || String(10 * 60 * 1000),
  10
);

export async function tick({ pool, tickState, tickLog, intervalMs } = {}) {
  if (!tickState) throw new Error('line-strategist-dispatch-plugin: tickState required');
  const interval = intervalMs ?? LINE_STRATEGIST_DISPATCH_INTERVAL_MS;
  const elapsed = Date.now() - (tickState.lastLineStrategistDispatchTime || 0);
  if (elapsed < interval) {
    return { skipped: true, reason: 'throttled' };
  }
  tickState.lastLineStrategistDispatchTime = Date.now();
  try {
    const r = await dispatchStrategistDecisions(pool);
    if (r.dispatched > 0) {
      tickLog?.(`[tick] Line-strategist dispatch: scanned=${r.scanned} dispatched=${r.dispatched} skipped_dup=${r.skipped_duplicate}`);
    }
    return r;
  } catch (err) {
    console.error('[tick] Line-strategist dispatch failed (non-fatal):', err.message);
    return { error: err.message };
  }
}

export default { tick };
