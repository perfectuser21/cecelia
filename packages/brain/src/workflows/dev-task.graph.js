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
 */
export async function runAgentNode(state) {
  try {
    const result = await spawn({
      task: state.task,
      skill: '/dev',
      prompt: state.task?.description || state.task?.title || '',
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
  return buildDevTaskGraph().compile({ checkpointer });
}
