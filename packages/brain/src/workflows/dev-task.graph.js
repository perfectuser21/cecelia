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
  try {
    const result = await spawn({
      task: state.task,
      skill: '/dev',
      prompt,
      worktree: state.task?.worktree,
    });
    return { result };
  } catch (err) {
    return { error: { message: err.message, stack: err.stack } };
  }
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
