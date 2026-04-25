/**
 * pipeline-watchdog-plugin.js — Brain v2 Phase D1.7c
 *
 * 把 tick-runner.js 中 inline 的 [感知] Pipeline-level Watchdog 段落抽出。
 * 每 30 分钟检测 pipeline 整体是否 6h 无进展。
 *
 * 节流门：PIPELINE_WATCHDOG_INTERVAL_MS（默认 30min，env 可覆盖）
 * MINIMAL_MODE → 跳过（保留原 inline 行为）
 */

import { checkStuckPipelines } from './pipeline-watchdog.js';

const PIPELINE_WATCHDOG_INTERVAL_MS = parseInt(
  process.env.CECELIA_PIPELINE_WATCHDOG_INTERVAL_MS || String(30 * 60 * 1000),
  10
);

/**
 * @param {{
 *   pool: import('pg').Pool,
 *   tickState: { lastPipelineWatchdogTime: number },
 *   tickLog?: (...args: any[]) => void,
 *   MINIMAL_MODE?: boolean,
 *   intervalMs?: number,
 * }} ctx
 */
export async function tick({ pool, tickState, tickLog, MINIMAL_MODE = false, intervalMs } = {}) {
  if (!tickState) throw new Error('pipeline-watchdog-plugin: tickState required');
  if (MINIMAL_MODE) return { skipped: true, reason: 'minimal_mode' };

  const interval = intervalMs ?? PIPELINE_WATCHDOG_INTERVAL_MS;
  const elapsed = Date.now() - (tickState.lastPipelineWatchdogTime || 0);
  if (elapsed < interval) {
    return { skipped: true, reason: 'throttled' };
  }
  tickState.lastPipelineWatchdogTime = Date.now();
  try {
    const r = await checkStuckPipelines(pool);
    if ((r?.stuck || 0) > 0) {
      tickLog?.(`[tick] Pipeline watchdog: scanned=${r.scanned} stuck=${r.stuck}`);
    }
    return r;
  } catch (err) {
    console.warn('[tick] pipeline-watchdog failed (non-fatal):', err.message);
    return { error: err.message };
  }
}

export default { tick };
