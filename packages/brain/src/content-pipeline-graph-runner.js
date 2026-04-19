/**
 * Content Pipeline Graph Runner — Docker-backed LangGraph pipeline 入口
 *
 * 提供 `runContentPipeline(task)` 入口：
 *   1. 用 task.id（= pipeline_id）作为 langgraph thread_id（支持断点续跑）
 *   2. stream 节点执行，每跳一步写事件（onStep 回调）
 *   3. `CONTENT_PIPELINE_LANGGRAPH_ENABLED` 未启用 → no-op，兜底老 pipeline-worker.py 路径
 *   4. 每节点通过 executeInDocker() 在隔离容器中运行 Claude Code session + skill
 *
 * 仿 harness-graph-runner.js，跟 harness 共用 docker-executor 基建。
 * content pipeline 回路比 harness 少（2 回路 vs 2+GAN），递归上限 60 够用。
 */

import { compileContentPipelineApp, createContentDockerNodes } from './content-pipeline-graph.js';
import { executeInDocker } from './docker-executor.js';

/**
 * LangGraph 递归上限。
 * 60 = copy_review 回路 5 轮 × 2 节点 + image_review 回路 5 轮 × 2 节点 + 6 起止 + buffer
 */
export const DEFAULT_RECURSION_LIMIT = 60;

/**
 * 是否启用 LangGraph 路径。
 * 默认 false：未设置/空字符串/'false'/'0' 都视为关闭。
 */
export function isContentPipelineLangGraphEnabled() {
  const v = process.env.CONTENT_PIPELINE_LANGGRAPH_ENABLED;
  if (!v) return false;
  const normalized = String(v).trim().toLowerCase();
  return !(normalized === '' || normalized === 'false' || normalized === '0');
}

/**
 * 运行 content pipeline。
 *
 * @param {object} task                   必填，至少含 { id, keyword, output_dir? }
 * @param {object} [opts]
 * @param {object} [opts.checkpointer]    PostgresSaver 实例启用持久化；不传走 MemorySaver
 * @param {object} [opts.overrides]       节点 override（测试用，覆盖 Docker 节点）
 * @param {(event) => void} [opts.onStep] 每步回调（写事件用）
 * @param {Record<string,string>} [opts.env]  额外注入容器的环境变量
 * @param {Function} [opts.dockerExecutor]  自定义执行器（测试注入，默认 executeInDocker）
 * @param {number}   [opts.recursionLimit]   LangGraph 递归上限，默认 60
 * @returns {Promise<{ skipped?: boolean, finalState?: object, steps?: number, reason?: string }>}
 */
export async function runContentPipeline(task, opts = {}) {
  if (!isContentPipelineLangGraphEnabled()) {
    return { skipped: true, reason: 'CONTENT_PIPELINE_LANGGRAPH_ENABLED not set' };
  }
  if (!task || !task.id) {
    throw new Error('runContentPipeline: task.id is required (used as langgraph thread_id)');
  }

  const keyword = task.keyword || (task.payload && task.payload.keyword) || '';
  const outputDir = task.output_dir || (task.payload && task.payload.output_dir) || '';

  console.log(
    `[content-pipeline-runner] starting pipeline=${task.id} keyword="${String(keyword).slice(0, 60)}"`
  );

  // 创建 Docker-backed 节点（除非 overrides 完全覆盖）
  const executor = opts.dockerExecutor || executeInDocker;
  const dockerNodes = createContentDockerNodes(executor, task, { env: opts.env });

  // overrides 优先级高于 Docker 节点
  const mergedOverrides = { ...dockerNodes, ...(opts.overrides || {}) };

  const app = compileContentPipelineApp({
    overrides: mergedOverrides,
    checkpointer: opts.checkpointer,
  });

  const recursionLimit = opts.recursionLimit || DEFAULT_RECURSION_LIMIT;
  const config = {
    configurable: { thread_id: String(task.id) },
    recursionLimit,
  };

  const initialState = {
    pipeline_id: task.id,
    keyword,
    output_dir: outputDir,
  };

  let steps = 0;
  let finalState = null;
  const startMs = Date.now();

  for await (const event of await app.stream(initialState, config)) {
    steps += 1;

    const nodeNames = Object.keys(event);
    const nodeName = nodeNames[0] || 'unknown';
    const nodeState = event[nodeName] || {};

    console.log(
      `[content-pipeline-runner] step=${steps} node=${nodeName} pipeline=${task.id}` +
        (nodeState.copy_review_verdict ? ` copy=${nodeState.copy_review_verdict}` : '') +
        (nodeState.image_review_verdict ? ` img=${nodeState.image_review_verdict}` : '') +
        (nodeState.nas_url ? ` nas=${nodeState.nas_url}` : '') +
        (nodeState.error ? ` error=${String(nodeState.error).slice(0, 100)}` : '')
    );

    if (typeof opts.onStep === 'function') {
      try {
        await opts.onStep({
          pipeline_id: task.id,
          step_index: steps,
          node: nodeName,
          event,
          state_snapshot: {
            copy_review_verdict: nodeState.copy_review_verdict,
            copy_review_round: nodeState.copy_review_round,
            image_review_verdict: nodeState.image_review_verdict,
            image_review_round: nodeState.image_review_round,
            findings_path: nodeState.findings_path,
            copy_path: nodeState.copy_path,
            cards_dir: nodeState.cards_dir,
            manifest_path: nodeState.manifest_path,
            nas_url: nodeState.nas_url,
            error: nodeState.error,
          },
        });
      } catch (err) {
        console.warn(`[content-pipeline-runner] onStep error (non-fatal): ${err.message}`);
      }
    }
    finalState = event;
  }

  const durationSec = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(
    `[content-pipeline-runner] pipeline complete pipeline=${task.id} steps=${steps} duration=${durationSec}s`
  );

  return { skipped: false, steps, finalState };
}
