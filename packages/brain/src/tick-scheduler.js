// packages/brain/src/tick-scheduler.js
/**
 * tick-scheduler.js — Wave 2 纯调度层
 *
 * 职责：读 DB、读 guidance、检查 circuit breaker、调 dispatchNextTask。
 * 硬性约束：
 *   - 绝对不 await 任何 LLM 调用（thalamus / decision / rumination / planner）
 *   - 目标耗时 < 500ms（DB 查询 + dispatch）
 *   - 无 guidance 时使用 EXECUTOR_ROUTING 默认路由表兜底（记录日志）
 */
import pool from './db.js';
import { dispatchNextTask } from './dispatcher.js';
import { isAllowed } from './circuit-breaker.js';
import { getGuidance } from './guidance.js';
import { canDispatch } from './alertness/index.js';

export const EXECUTOR_ROUTING = {
  dev_task:    'cecelia_bridge',
  code_review: 'cecelia_bridge',
  arch_review: 'cecelia_bridge',
  research:    'cecelia_bridge',
  harness:     'cecelia_bridge',
};

/**
 * 纯调度入口。被 tick-loop.js 每 5 秒调用。
 * @returns {Promise<{dispatched: boolean, reason: string, elapsed_ms: number, guidance_found: boolean}>}
 */
let _routingLoggedOnce = false;

export async function runScheduler() {
  const start = Date.now();

  // 1. Circuit breaker 检查（内存读取，< 1ms）
  if (!isAllowed('dispatch')) {
    return { dispatched: false, reason: 'circuit_open', elapsed_ms: Date.now() - start, guidance_found: false };
  }
  if (!canDispatch()) {
    return { dispatched: false, reason: 'alertness_disabled', elapsed_ms: Date.now() - start, guidance_found: false };
  }

  // 2. 读取全局策略 guidance（DB 查询，< 5ms）
  const strategyGuidance = await getGuidance('strategy:global');
  const guidanceFound = !!strategyGuidance;

  if (strategyGuidance) {
    console.log('[tick-scheduler] 使用 consciousness-loop guidance:', JSON.stringify(strategyGuidance).slice(0, 120));
  } else if (!_routingLoggedOnce) {
    _routingLoggedOnce = true;
    console.log('[tick-scheduler] 无 guidance，使用 EXECUTOR_ROUTING 默认路由:', JSON.stringify(EXECUTOR_ROUTING));
  }

  // 正式代码任务沿用 dispatcher 的停止开关、独立脚本熔断和主机容量，不受 AI/KR 预算限制。
  const codeDispatch = await dispatchNextTask(null, { codeOnly: true });
  if (codeDispatch.dispatched) {
    return { ...codeDispatch, dispatch_lane: 'code', elapsed_ms: Date.now() - start, guidance_found: guidanceFound };
  }

  // 3. 获取活跃 KR IDs（DB 查询）
  const { rows } = await pool.query(
    `SELECT id FROM key_results WHERE status IN ('active', 'in_progress', 'decomposing')`
  );
  const goalIds = rows.map(r => r.id);

  if (goalIds.length === 0) {
    return { dispatched: false, reason: 'no_goals', code_dispatch: codeDispatch, elapsed_ms: Date.now() - start, guidance_found: guidanceFound };
  }

  // 4. 派发（调 dispatcher，不含任何 LLM）
  const result = await dispatchNextTask(goalIds);

  return {
    ...result,
    code_dispatch: codeDispatch,
    elapsed_ms: Date.now() - start,
    guidance_found: guidanceFound,
  };
}
