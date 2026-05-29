/**
 * pipeline-patrol-plugin.js — Brain v2 Phase D1.7c
 *
 * 把 tick-runner.js 中 inline 的 [感知] Pipeline Patrol 巡航段落抽出。
 * 每 5 分钟检测卡住/孤儿 pipeline。
 *
 * 节流门：PIPELINE_PATROL_INTERVAL_MS（默认 5min，env 可覆盖）
 *   - elapsed < interval → 返回 { skipped: true, reason: 'throttled' }
 *   - 否则更新 tickState.lastPipelinePatrolTime 并执行 runPipelinePatrol
 *
 * 失败处理：内部 catch，错误打 console.error 并返回 { error }，不冒泡到 tick-runner。
 *
 * WS4：同节流门内追加 runHarnessInitiativePatrol（扫卡住的 harness initiative：
 *   Planner 15min / GAN 每轮 20min），结果挂在返回值的 harness 字段。
 */

import { runPipelinePatrol } from './pipeline-patrol.js';
import { runHarnessInitiativePatrol } from './harness-initiative-patrol.js';

const PIPELINE_PATROL_INTERVAL_MS = parseInt(
  process.env.CECELIA_PIPELINE_PATROL_INTERVAL_MS || String(5 * 60 * 1000),
  10
);

/**
 * @param {{
 *   pool: import('pg').Pool,
 *   tickState: { lastPipelinePatrolTime: number },
 *   tickLog?: (...args: any[]) => void,
 *   intervalMs?: number,  // 测试可覆盖
 * }} ctx
 * @returns {Promise<null | { scanned?: number, stuck?: number, rescued?: number, skipped?: boolean, reason?: string, error?: string }>}
 */
export async function tick({ pool, tickState, tickLog, intervalMs } = {}) {
  if (!tickState) throw new Error('pipeline-patrol-plugin: tickState required');
  const interval = intervalMs ?? PIPELINE_PATROL_INTERVAL_MS;
  const elapsed = Date.now() - (tickState.lastPipelinePatrolTime || 0);
  if (elapsed < interval) {
    return { skipped: true, reason: 'throttled' };
  }
  tickState.lastPipelinePatrolTime = Date.now();
  try {
    const r = await runPipelinePatrol(pool);
    if ((r?.stuck || 0) > 0 || (r?.rescued || 0) > 0) {
      tickLog?.(`[tick] Pipeline patrol: scanned=${r.scanned} stuck=${r.stuck} rescued=${r.rescued}`);
    }

    // WS4: 追加 harness initiative 巡航（卡住检测 + intervention 触发）。
    // 独立 try：harness patrol 失败不影响 pipeline patrol 结果。
    let harness = null;
    try {
      harness = await runHarnessInitiativePatrol(pool);
      if ((harness?.stuck || 0) > 0 || (harness?.intervened || 0) > 0) {
        tickLog?.(`[tick] Harness initiative patrol: scanned=${harness.scanned} stuck=${harness.stuck} intervened=${harness.intervened}`);
      }
    } catch (hErr) {
      console.error('[tick] Harness initiative patrol failed (non-fatal):', hErr.message);
      harness = { error: hErr.message };
    }

    return { ...r, harness };
  } catch (err) {
    console.error('[tick] Pipeline patrol failed (non-fatal):', err.message);
    return { error: err.message };
  }
}

export default { tick };
