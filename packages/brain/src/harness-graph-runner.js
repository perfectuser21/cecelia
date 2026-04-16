/**
 * Harness Graph Runner
 *
 * 提供 `runHarnessPipeline(task)` 入口：
 *   1. 用 task.id 作为 langgraph thread_id（支持中断恢复，PostgresSaver 自动续跑）
 *   2. stream 节点执行，每跳一步写一条 cecelia_events
 *   3. `HARNESS_LANGGRAPH_ENABLED` 未设置时直接 no-op，保持老路径（routes/execution.js）兜底
 *
 * 本骨架的节点为 placeholder，等 Phase 1 docker-executor 完成后接入。
 */

import { compileHarnessApp } from './harness-graph.js';

/**
 * 是否启用 LangGraph 路径。
 * 默认 false：未设置/空字符串/'false'/'0' 都视为关闭。
 */
export function isLangGraphEnabled() {
  const v = process.env.HARNESS_LANGGRAPH_ENABLED;
  if (!v) return false;
  const normalized = String(v).trim().toLowerCase();
  return !(normalized === '' || normalized === 'false' || normalized === '0');
}

/**
 * 运行 harness pipeline。
 *
 * @param {object} task                  Brain 任务（必须含 id 与 description）
 * @param {object} [opts]
 * @param {object} [opts.checkpointer]   传 PostgresSaver 实例可启用持久化；不传走 MemorySaver
 * @param {object} [opts.overrides]      节点 override（测试 / Phase 1 接入用）
 * @param {(event) => void} [opts.onStep] 每步回调，调用方可写 cecelia_events
 * @returns {Promise<{ skipped?: boolean, finalState?: object, steps?: number }>}
 */
export async function runHarnessPipeline(task, opts = {}) {
  if (!isLangGraphEnabled()) {
    return { skipped: true, reason: 'HARNESS_LANGGRAPH_ENABLED not set' };
  }
  if (!task || !task.id) {
    throw new Error('runHarnessPipeline: task.id is required (used as langgraph thread_id)');
  }

  const app = compileHarnessApp({
    overrides: opts.overrides,
    checkpointer: opts.checkpointer,
  });

  const config = { configurable: { thread_id: String(task.id) } };
  const initialState = {
    task_id: task.id,
    task_description: task.description || task.title || '',
    sprint_dir: task.sprint_dir || (task.payload && task.payload.sprint_dir) || null,
  };

  let steps = 0;
  let finalState = null;

  for await (const event of await app.stream(initialState, config)) {
    steps += 1;
    if (typeof opts.onStep === 'function') {
      try {
        await opts.onStep({ task_id: task.id, step_index: steps, event });
      } catch (err) {
        // onStep 失败不阻塞 pipeline（事件写库失败属于次要问题）
        console.warn(`[harness-graph-runner] onStep error (non-fatal): ${err.message}`);
      }
    }
    finalState = event;
  }

  return { skipped: false, steps, finalState };
}
