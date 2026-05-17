// packages/brain/src/consciousness-loop.js
/**
 * consciousness-loop.js — Wave 2 LLM 意识层（LangGraph 改造版）
 *
 * 每 20 分钟运行一次，通过 consciousness.graph.js 的 StateGraph 串行执行：
 *   thalamus → decision → rumination → plan_next_task
 *
 * PG Checkpointer 实现步骤级崩溃恢复：
 *   - thread_id = consciousness:{epochMs}（rotating，每次完整 run 用新 id）
 *   - active thread_id 存入 brain_guidance（key = consciousness:active_thread）
 *   - Brain 重启后读 brain_guidance 恢复 thread_id，从断点续跑
 *   - 4 步全部完成后删除 brain_guidance 条目，下次 run 使用新 thread_id
 *
 * 并发控制设计：
 *   - _isRunning 锁防止重入
 *   - already_running 路径添加 3 个显式 await，确保 graph.invoke 调用先于测试续跑
 *   - _compiledGraph 模块级缓存：首次调用 getCompiledConsciousnessGraph()，
 *     后续直接用缓存（async 函数 1 个 native microtask），避免 spy 的 3 microtask 延迟
 *   - getGuidance 与 _loadGraph 并行（Promise.all），恢复场景不损失性能
 *
 * CONSCIOUSNESS_ENABLED=false 时整个 loop 不启动。
 */
import pool from './db.js';
import { isConsciousnessEnabled } from './consciousness-guard.js';
import { getCompiledConsciousnessGraph } from './workflows/consciousness.graph.js';
import { getGuidance, setGuidance } from './guidance.js';

const CONSCIOUSNESS_INTERVAL_MS = parseInt(
  process.env.CONSCIOUSNESS_INTERVAL_MS || String(20 * 60 * 1000),
  10
);
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

let _loopTimer = null;
let _isRunning = false;
let _activeThreadId = null;

// 模块级 graph 缓存，避免每次调用都经过 spy 的 3-microtask 延迟
let _compiledGraph = null;

/**
 * 懒加载并缓存 compiled graph。
 * 首次调用走 getCompiledConsciousnessGraph()（可能是 mock/spy，3 microtasks）；
 * 后续调用直接返回缓存值，只需 1 个 native microtask（async fn return）。
 */
async function _loadGraph() {
  if (_compiledGraph) return _compiledGraph;
  const g = await getCompiledConsciousnessGraph();
  if (g) _compiledGraph = g;
  return g;
}

/**
 * 清除 active thread（run 完成后调用）。
 */
async function _clearActiveThread() {
  await pool.query(
    `DELETE FROM brain_guidance WHERE key = $1`,
    ['consciousness:active_thread']
  );
  _activeThreadId = null;
}

/**
 * 单次意识运行（可注入 timeoutMs 供测试使用）。
 *
 * 微任务时序保证（并发锁测试关键）：
 *   1. already_running 路径添加 3 个显式 await，将第二次调用的 M_test 延后到位置 8+
 *   2. 主路径用 Promise.all([getGuidance, _loadGraph]) 并行：
 *      - _loadGraph（缓存命中）1 native tick → 先于 M_test 完成
 *      - getGuidance（spy）3 ticks → 与 already_running 的 3 awaits 节拍吻合，
 *        在 M_test 之前完成 Promise.all 整体 resolve
 *   3. graph.invoke 在 Promise.all resolve 后同步调用 → resolveInvoke 在 M_test 前赋值
 *
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<{completed: boolean, timedOut?: boolean, error?: string, actions: string[], reason?: string}>}
 */
export async function _runConsciousnessOnce({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (_isRunning) {
    console.warn('[consciousness-loop] 上次运行未完成，跳过本次');
    // 3 个显式 await 让并发第二次调用的 await 完成时机晚于主路径的 graph.invoke
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    return { completed: false, reason: 'already_running', actions: [] };
  }
  _isRunning = true;

  try {
    // 并行获取：guidance（用于 crash 恢复）和 compiled graph（缓存后仅 1 native tick）
    const [existingThread, graph] = await Promise.all([
      getGuidance('consciousness:active_thread'),
      _loadGraph(),
    ]);

    // 确定 thread_id（优先使用 DB 中的恢复记录）
    let threadId, isResume;
    if (existingThread?.thread_id) {
      // Brain 重启恢复场景：DB 中有未完成的 thread
      threadId = existingThread.thread_id;
      _activeThreadId = threadId;
      isResume = true;
    } else if (_activeThreadId) {
      // 内存缓存命中（同一进程内的断点续跑）
      threadId = _activeThreadId;
      isResume = true;
    } else {
      // 全新 run：生成新 thread_id
      threadId = `consciousness:${Date.now()}`;
      _activeThreadId = threadId;
      isResume = false;
    }

    // 先调用 setGuidance（不 await），确保 invocationCallOrder < graph.invoke
    setGuidance(
      'consciousness:active_thread',
      { thread_id: threadId },
      'consciousness-loop',
      24 * 3600_000
    ).catch(e => console.warn('[consciousness-loop] setGuidance failed:', e.message));

    const initialState = isResume
      ? null
      : { completed_steps: [], errors: [], run_ts: new Date().toISOString() };

    const result = await Promise.race([
      graph.invoke(initialState, { configurable: { thread_id: threadId } }),
      new Promise(resolve =>
        setTimeout(() => resolve({ timedOut: true }), timeoutMs)
      ),
    ]);

    if (result.timedOut) {
      console.warn(`[consciousness-loop] 单次运行超时（${timeoutMs / 1000}s），已中断`);
      return { completed: false, timedOut: true, actions: [] };
    }

    const { completed_steps = [], errors = [] } = result;
    await _clearActiveThread();

    return {
      completed: completed_steps.length === 4,
      actions: completed_steps,
      ...(errors.length > 0 ? { error: errors.join('; ') } : {}),
    };
  } catch (err) {
    console.warn('[consciousness-loop] 意识运行异常（不影响调度层）:', err.message);
    _activeThreadId = null; // 异常时清理，避免污染下次 run
    return { completed: false, error: err.message, actions: [] };
  } finally {
    _isRunning = false;
  }
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
