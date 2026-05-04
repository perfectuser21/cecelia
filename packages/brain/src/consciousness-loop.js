// packages/brain/src/consciousness-loop.js
/**
 * consciousness-loop.js — Wave 2 LLM 意识层
 *
 * 每 20 分钟运行一次，集中所有 LLM 调用：
 *   thalamusProcessEvent → 路由建议写 guidance
 *   generateDecision    → 策略建议写 guidance
 *   runRumination       → 知识消化（fire-and-forget）
 *   planNextTask        → 直接落 DB tasks 表
 *
 * CONSCIOUSNESS_ENABLED=false 时整个 loop 不启动。
 * 每次运行有超时保护，超时不崩溃只记 warn。
 * 挂了不影响 tick-scheduler.js 继续派发。
 */
import pool from './db.js';
import { processEvent as thalamusProcessEvent, EVENT_TYPES } from './thalamus.js';
import { generateDecision } from './decision.js';
import { runRumination } from './rumination.js';
import { planNextTask } from './planner.js';
import { setGuidance } from './guidance.js';
import { isConsciousnessEnabled } from './consciousness-guard.js';

const CONSCIOUSNESS_INTERVAL_MS = parseInt(
  process.env.CONSCIOUSNESS_INTERVAL_MS || String(20 * 60 * 1000),
  10
);
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟超时保护

let _loopTimer = null;
let _isRunning = false;

/**
 * 单次意识运行（可注入 timeoutMs 供测试使用）。
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<{completed: boolean, timedOut?: boolean, error?: string, actions: string[]}>}
 */
export async function _runConsciousnessOnce({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (_isRunning) {
    console.warn('[consciousness-loop] 上次运行未完成，跳过本次');
    return { completed: false, reason: 'already_running', actions: [] };
  }
  _isRunning = true;
  const actions = [];

  try {
    const result = await Promise.race([
      _doConsciousnessWork(actions),
      new Promise(resolve =>
        setTimeout(() => resolve({ timedOut: true, actions }), timeoutMs)
      ),
    ]);

    if (result.timedOut) {
      console.warn('[consciousness-loop] 单次运行超时（' + timeoutMs / 1000 + 's），已中断');
      return { completed: false, timedOut: true, actions };
    }

    const { errors = [] } = result;
    if (errors.length > 0) {
      return { completed: false, error: errors.join('; '), actions };
    }

    return { completed: true, actions };
  } catch (err) {
    console.warn('[consciousness-loop] 意识运行异常（不影响调度层）:', err.message);
    return { completed: false, error: err.message, actions };
  } finally {
    _isRunning = false;
  }
}

async function _doConsciousnessWork(actions) {
  const errors = [];

  // 1. Thalamus：分析 tick 事件，路由建议写 guidance
  try {
    const tickEvent = { type: EVENT_TYPES.TICK, timestamp: new Date().toISOString(), has_anomaly: false };
    const thalamusResult = await thalamusProcessEvent(tickEvent);
    const dispatchAction = thalamusResult.actions?.find(a => a.type === 'dispatch_task');
    if (dispatchAction?.task_id) {
      await setGuidance(
        `routing:${dispatchAction.task_id}`,
        { executor_type: 'cecelia_bridge', source: 'thalamus', level: thalamusResult.level },
        'thalamus',
        3600_000
      );
      actions.push('thalamus_routing');
    }
  } catch (err) {
    console.warn('[consciousness-loop] thalamus 失败（非致命）:', err.message);
    errors.push(err.message);
  }

  // 2. generateDecision：全局策略写 guidance（24h TTL）
  try {
    const decision = await generateDecision({ trigger: 'consciousness_loop' });
    if (decision.actions?.length > 0) {
      await setGuidance('strategy:global', { decision_id: decision.decision_id, actions: decision.actions }, 'cortex', 24 * 3600_000);
      actions.push('strategy_guidance');
    }
  } catch (err) {
    console.warn('[consciousness-loop] generateDecision 失败（非致命）:', err.message);
    errors.push(err.message);
  }

  // 3. runRumination：知识消化（fire-and-forget，不写 guidance）
  // 加 10 分钟超时保护，防止 rumination 无限期阻塞后台
  const RUMINATION_TIMEOUT_MS = 10 * 60 * 1000;
  Promise.resolve().then(() =>
    Promise.race([
      runRumination(pool),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('rumination timeout')), RUMINATION_TIMEOUT_MS)
      ),
    ])
  ).catch(e => console.warn('[consciousness-loop] rumination 失败:', e.message));
  actions.push('rumination_started');

  // 4. planNextTask：直接落 DB tasks 表（不写 guidance）
  // 与 tick-runner.js L1191 保持一致：consciousness-loop 负责取 krIds，planner 负责选任务
  try {
    const { rows } = await pool.query(
      `SELECT id FROM key_results WHERE status IN ('active', 'in_progress') LIMIT 5`
    );
    const krIds = rows.map(r => r.id);
    if (krIds.length > 0) {
      await planNextTask(krIds);
      actions.push('plan_next_task');
    }
  } catch (err) {
    console.warn('[consciousness-loop] planNextTask 失败（非致命）:', err.message);
    errors.push(err.message);
  }

  return { actions, errors };
}

/**
 * 启动意识循环（每 20 分钟一次）。
 * @returns {boolean} false 表示 CONSCIOUSNESS_ENABLED=false，未启动
 */
export function startConsciousnessLoop() {
  if (!isConsciousnessEnabled()) {
    console.log('[consciousness-loop] CONSCIOUSNESS_ENABLED=false，意识循环不启动');
    return false;
  }

  if (_loopTimer) {
    console.log('[consciousness-loop] 已在运行，跳过重复启动');
    return true;
  }

  _loopTimer = setInterval(async () => {
    if (!isConsciousnessEnabled()) return;
    await _runConsciousnessOnce();
  }, CONSCIOUSNESS_INTERVAL_MS);

  if (_loopTimer.unref) _loopTimer.unref();

  console.log(`[consciousness-loop] 已启动（间隔 ${CONSCIOUSNESS_INTERVAL_MS / 60000} 分钟）`);
  return true;
}

/**
 * 停止意识循环（测试用 / 关闭用）。
 */
export function stopConsciousnessLoop() {
  if (_loopTimer) {
    clearInterval(_loopTimer);
    _loopTimer = null;
  }
}
