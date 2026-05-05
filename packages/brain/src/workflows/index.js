/**
 * Brain v2 Phase C2 + C8a + consciousness: workflows 集中注册入口。
 *
 * Brain server 启动时调 initializeWorkflows()，在所有 graph-runtime 调用前把
 * 已知 workflow 注册到 orchestrator/workflow-registry。保证 runWorkflow 能查到。
 *
 * consciousness graph 不走 runWorkflow（无 task 语义），不注册到 registry，
 * 但在此预热单例（compileGraph + pg-checkpointer setup），避免首次 consciousness tick 延迟。
 */
import { registerWorkflow, listWorkflows } from '../orchestrator/workflow-registry.js';
import { compileDevTaskGraph } from './dev-task.graph.js';
import { compileHarnessInitiativeGraph } from './harness-initiative.graph.js';
import { getCompiledConsciousnessGraph } from './consciousness.graph.js';

let _initialized = false;

/**
 * 集中初始化所有内置 workflow。幂等。
 * server.js 启动时在 pg pool ready 后、initTickLoop 前调。
 */
export async function initializeWorkflows() {
  if (_initialized) return;

  const existing = listWorkflows();

  if (!existing.includes('dev-task')) {
    const devTaskGraph = await compileDevTaskGraph();
    registerWorkflow('dev-task', devTaskGraph);
  }

  if (!existing.includes('harness-initiative')) {
    const harnessInitiativeGraph = await compileHarnessInitiativeGraph();
    registerWorkflow('harness-initiative', harnessInitiativeGraph);
  }

  // 预热 consciousness graph（不注册到 registry，由 consciousness-loop.js 直接调用）
  await getCompiledConsciousnessGraph();

  _initialized = true;
}

/**
 * 测试 hook：重置初始化状态。仅 __tests__ 使用。
 */
export function _resetInitializedForTests() {
  _initialized = false;
}
