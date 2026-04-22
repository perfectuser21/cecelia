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
 * 默认 true：今日 16 条 benchmark 验证 LangGraph 是 content pipeline 的
 * 生产路径（PostgresSaver 持久化 + 条件边 + 6-stage docker-in-docker）。
 * 老 /:id/run 路径已废弃。
 * 显式设 'false' / '0' 才回退老路径。
 */
export function isContentPipelineLangGraphEnabled() {
  const v = process.env.CONTENT_PIPELINE_LANGGRAPH_ENABLED;
  if (!v) return true;
  const normalized = String(v).trim().toLowerCase();
  return !(normalized === 'false' || normalized === '0');
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

  // 动态选账号：account-usage.selectBestAccount() 按 5h/7d 剩余额度挑最空的账号
  // 硬编码 'account1' 会让 account1 7d 撞 100% 后整条 pipeline 429 挂（实测今日 robot final）
  // 优先级：opts.env.CECELIA_CREDENTIALS（显式）> CONTENT_PIPELINE_CREDENTIALS env > selectBestAccount > 'account1' fallback
  let dynamicCredential = process.env.CONTENT_PIPELINE_CREDENTIALS;
  if (!dynamicCredential && !(opts.env && opts.env.CECELIA_CREDENTIALS)) {
    try {
      const { selectBestAccount } = await import('./account-usage.js');
      const selected = await selectBestAccount({ model: 'sonnet' });
      if (selected?.accountId) {
        dynamicCredential = selected.accountId;
        console.log(
          `[content-pipeline-runner] selectBestAccount → ${dynamicCredential} (model=${selected.model})`
        );
      }
    } catch (e) {
      console.warn(`[content-pipeline-runner] selectBestAccount 失败，fallback account1: ${e.message}`);
    }
  }
  const mergedEnv = {
    CECELIA_CREDENTIALS: dynamicCredential || 'account1',
    ...(opts.env || {}),
  };

  // 创建 Docker-backed 节点（除非 overrides 完全覆盖）
  const executor = opts.dockerExecutor || executeInDocker;
  const dockerNodes = createContentDockerNodes(executor, task, { env: mergedEnv });

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
            copy_review_rule_details: nodeState.copy_review_rule_details,
            // P0-4：LLM 5 维总分、vision 4 维平均分提到 payload 顶级，
            // 前端详情页直接读，无需翻 rule_details 数组。
            copy_review_total: nodeState.copy_review_total,
            image_review_verdict: nodeState.image_review_verdict,
            image_review_round: nodeState.image_review_round,
            image_review_rule_details: nodeState.image_review_rule_details,
            image_review_vision_avg: nodeState.image_review_vision_avg,
            findings_path: nodeState.findings_path,
            copy_path: nodeState.copy_path,
            cards_dir: nodeState.cards_dir,
            manifest_path: nodeState.manifest_path,
            nas_url: nodeState.nas_url,
            error: nodeState.error,
            // ─── WF-3 观察性：每步 Docker 执行元数据 ──────────────
            // 前端详情页事件展开后通过这些字段展示：
            //   prompt_sent   Brain 发给 Claude 的 prompt（前 8KB）
            //   raw_stdout    Claude 吐的 stdout（前 10KB）
            //   raw_stderr    Claude 吐的 stderr（前 2KB）
            //   exit_code     容器退出码
            //   duration_ms   节点耗时毫秒
            //   container_id  容器 ID 前 12 位（--cidfile）
            prompt_sent: nodeState.prompt_sent,
            raw_stdout: nodeState.raw_stdout,
            raw_stderr: nodeState.raw_stderr,
            exit_code: nodeState.exit_code,
            duration_ms: nodeState.duration_ms,
            container_id: nodeState.container_id,
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
