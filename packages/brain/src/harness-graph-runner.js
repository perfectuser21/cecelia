/**
 * Harness Graph Runner — Docker-backed LangGraph pipeline 入口
 *
 * 提供 `runHarnessPipeline(task)` 入口：
 *   1. 用 task.id 作为 langgraph thread_id（支持中断恢复，PostgresSaver 自动续跑）
 *   2. stream 节点执行，每跳一步写一条 cecelia_events
 *   3. `HARNESS_LANGGRAPH_ENABLED` 未设置时直接 no-op，保持老路径（routes/execution.js）兜底
 *   4. 每个节点通过 executeInDocker() 在隔离容器中运行 Claude Code session
 */

import { compileHarnessApp, createDockerNodes } from './harness-graph.js';
import { executeInDocker } from './docker-executor.js';

/**
 * LangGraph 递归上限。官方默认 25，对 GAN 对抗 + Fix 循环远远不够。
 * 100 = review 10 轮 × 2 节点 + gen/eval 10 轮 × 2 节点 + 6 起止 = 46，预留一倍。
 */
export const DEFAULT_RECURSION_LIMIT = 100;

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
 * @param {object} [opts.overrides]      节点 override（测试用，会覆盖 Docker 节点）
 * @param {(event) => void} [opts.onStep] 每步回调，调用方可写 cecelia_events
 * @param {Record<string,string>} [opts.env]  额外注入容器的环境变量
 * @param {Function} [opts.dockerExecutor]  自定义 Docker 执行器（测试注入用，默认用 executeInDocker）
 * @param {number}   [opts.recursionLimit]   LangGraph 递归上限，默认 100（覆盖官方默认 25）
 * @returns {Promise<{ skipped?: boolean, finalState?: object, steps?: number, reason?: string }>}
 */
export async function runHarnessPipeline(task, opts = {}) {
  if (!isLangGraphEnabled()) {
    return { skipped: true, reason: 'HARNESS_LANGGRAPH_ENABLED not set' };
  }
  if (!task || !task.id) {
    throw new Error('runHarnessPipeline: task.id is required (used as langgraph thread_id)');
  }

  console.log(`[harness-graph-runner] starting pipeline task=${task.id} description="${(task.description || task.title || '').slice(0, 80)}"`);

  // 创建 Docker-backed 节点（除非 overrides 完全覆盖）
  const executor = opts.dockerExecutor || executeInDocker;
  const dockerNodes = createDockerNodes(executor, task, { env: opts.env });

  // overrides 优先级高于 Docker 节点（允许测试注入）
  const mergedOverrides = { ...dockerNodes, ...(opts.overrides || {}) };

  const app = compileHarnessApp({
    overrides: mergedOverrides,
    checkpointer: opts.checkpointer,
  });

  // recursionLimit: LangGraph 默认 25。GAN 对抗（propose/review）理论无上限，
  // Evaluator Fix 循环也可能跑多轮，6 节点 pipeline × 多轮会撞 25 硬墙。
  // 默认值见 DEFAULT_RECURSION_LIMIT（100），GAN/Fix 本身的上限由 graph 逻辑层处理。
  const recursionLimit = opts.recursionLimit || DEFAULT_RECURSION_LIMIT;
  const config = {
    configurable: { thread_id: String(task.id) },
    recursionLimit,
  };
  const initialState = {
    task_id: task.id,
    task_description: task.description || task.title || '',
    sprint_dir: task.sprint_dir || (task.payload && task.payload.sprint_dir) || null,
  };

  let steps = 0;
  let finalState = null;
  const startMs = Date.now();

  for await (const event of await app.stream(initialState, config)) {
    steps += 1;

    // 提取当前节点名和状态
    const nodeNames = Object.keys(event);
    const nodeName = nodeNames[0] || 'unknown';
    const nodeState = event[nodeName] || {};

    console.log(
      `[harness-graph-runner] step=${steps} node=${nodeName} task=${task.id}` +
      (nodeState.review_verdict ? ` review=${nodeState.review_verdict}` : '') +
      (nodeState.evaluator_verdict ? ` eval=${nodeState.evaluator_verdict}` : '') +
      (nodeState.pr_url ? ` pr=${nodeState.pr_url}` : '') +
      (nodeState.error ? ` error=${nodeState.error.slice(0, 100)}` : '')
    );

    if (typeof opts.onStep === 'function') {
      try {
        await opts.onStep({
          task_id: task.id,
          step_index: steps,
          node: nodeName,
          event,
          state_snapshot: {
            review_verdict: nodeState.review_verdict,
            review_round: nodeState.review_round,
            evaluator_verdict: nodeState.evaluator_verdict,
            eval_round: nodeState.eval_round,
            pr_url: nodeState.pr_url,
            error: nodeState.error,
          },
        });
      } catch (err) {
        // onStep 失败不阻塞 pipeline（事件写库失败属于次要问题）
        console.warn(`[harness-graph-runner] onStep error (non-fatal): ${err.message}`);
      }
    }
    finalState = event;
  }

  const durationSec = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(
    `[harness-graph-runner] pipeline complete task=${task.id} steps=${steps} duration=${durationSec}s`
  );

  return { skipped: false, steps, finalState };
}
