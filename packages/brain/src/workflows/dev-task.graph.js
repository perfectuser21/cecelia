/**
 * Brain v2 Phase C2: dev-task workflow — 首个 .graph.js（reference 模板）。
 *
 * LangGraph 1-node 图：单步调 L3 spawn() 跑 /dev skill。为 Phase C3/C4/C5 搬
 * harness-gan / harness-initiative / content-pipeline 提供结构参考。
 *
 * 本 PR（C2）只建 graph + 集中注册，不接线 tick.js（C6 tick 瘦身时做灰度）。
 */
import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import { spawn } from '../spawn/index.js';
import { getPgCheckpointer } from '../orchestrator/pg-checkpointer.js';
// preparePrompt 注入 /dev skill 前缀 + system context + PRD 框架 + retry/learning 上下文。
// 之前 dev-task graph 直接传 task.description 当 prompt，容器内 claude 拿到 11 行裸 PRD 看完
// 没 /dev 指令直接 exit 0，task 被判 fail → quarantine（5/3 prod 实证）。
import { preparePrompt } from '../executor.js';
// writeDockerCallback 把 spawn 结果写 callback_queue，callback-worker → callback-processor
// 走标准链路把 tasks.status 标 completed/failed（含 pr_url 提取 / failure_class 分类）。
// 不调它 → graph 跑完没人回写 tasks.status → task 永卡 in_progress 直到 zombie-reaper
// 30min 后标 failed（实测 24h 0% 成功率 12 条 [reaper] zombie 错误）。
import { writeDockerCallback } from '../docker-executor.js';

/**
 * dev-task workflow state：minimal — 进来一个 task，跑 spawn，存 result/error。
 *
 * 字段不多但都 required by spec §6：reducer 全 replace（无 merge 语义），default 初始化防 undefined。
 */
export const DevTaskState = Annotation.Root({
  task: Annotation({ reducer: (_old, neu) => neu, default: () => null }),
  result: Annotation({ reducer: (_old, neu) => neu, default: () => null }),
  error: Annotation({ reducer: (_old, neu) => neu, default: () => null }),
});

/**
 * run-agent node：调 L3 spawn() 让 docker agent 跑 /dev skill。
 * 遵守 spec §6 node 内不得同步 >50ms — spawn 本身 async fire-and-forget。
 *
 * Prompt 必须经 preparePrompt 包装（注入 /dev 前缀 + sysCtx + PRD 框架 + retry/learning 上下文），
 * 否则容器内 claude 拿到裸 description 会无指令地 exit 0。
 * preparePrompt 失败时 fallback 到加 /dev 前缀的 description（保留可执行性）。
 */
export async function runAgentNode(state) {
  let prompt;
  try {
    prompt = await preparePrompt(state.task);
  } catch (err) {
    // preparePrompt 内部异常（如 DB 查 learning 失败）不阻断派发，最小可执行 prompt 兜底
    console.warn(`[dev-task.graph] preparePrompt failed (${err.message}), fallback to skill+description`);
    const desc = state.task?.description || state.task?.title || '';
    prompt = `/dev\n\n${desc}`;
  }

  let spawnResult = null;
  let spawnError = null;
  try {
    spawnResult = await spawn({
      task: state.task,
      skill: '/dev',
      prompt,
      worktree: state.task?.worktree,
    });
  } catch (err) {
    spawnError = err;
  }

  // 回写 callback_queue → callback-worker → callback-processor 标 tasks.status。
  // 不在 try/catch spawn 内部做这步，是为了 spawn throw 时也能合成 result 入队，
  // 让任务从 in_progress 走出来（否则要等 zombie-reaper 30min 兜底）。
  const taskId = state.task?.id;
  if (taskId) {
    const resultForCallback = spawnResult || {
      exit_code: 1,
      stdout: '',
      stderr: spawnError?.message || 'spawn threw without error message',
      duration_ms: 0,
      timed_out: false,
      container: null,
      container_id: null,
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
    };
    const runId = `dev-task-${taskId}-${Date.now()}`;
    try {
      await writeDockerCallback(state.task, runId, null, resultForCallback);
    } catch (cbErr) {
      // callback_queue INSERT 失败不阻断 graph — DLQ 已由 writeDockerCallback 内置兜底。
      // 这里仅记日志，让 zombie-reaper 作为最后防线（与历史行为一致，不放大故障半径）。
      console.warn(`[dev-task.graph] writeDockerCallback failed task=${taskId}: ${cbErr.message}`);
    }
  }

  if (spawnError) {
    return { error: { message: spawnError.message, stack: spawnError.stack } };
  }
  return { result: spawnResult };
}

/**
 * 组装 graph（未 compile）。
 * @returns {StateGraph}
 */
export function buildDevTaskGraph() {
  return new StateGraph(DevTaskState)
    .addNode('run-agent', runAgentNode)
    .addEdge(START, 'run-agent')
    .addEdge('run-agent', END);
}

/**
 * 编译 graph 附带 pg checkpointer（spec §6 禁 MemorySaver）。
 * 供 workflows/index.js 的 initializeWorkflows 在启动时调。
 */
export async function compileDevTaskGraph() {
  const checkpointer = await getPgCheckpointer();
  return buildDevTaskGraph().compile({ checkpointer, durability: 'sync' });
}
