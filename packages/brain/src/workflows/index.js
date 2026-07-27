/**
 * workflows 启动预热入口。
 *
 * 历史：本文件曾是 Brain v2 Phase C 的「workflow 集中注册」入口，把 graph 注册进
 * orchestrator/workflow-registry 供 graph-runtime.runWorkflow 查表。
 * 现状：dev-task 已迁离 LangGraph（T6，走 triggerCeceliaRun 本地 spawn），
 * registry 与 graph-runtime 已作为死码删除（刀4a）。**这里不再有任何注册动作。**
 *
 * 现在 initializeWorkflows() 只做一件事：预热 consciousness graph 单例
 * （compileGraph + pg-checkpointer setup），避免首次 consciousness tick 延迟。
 * consciousness-loop.js 直接持有该 graph 调用，不经任何 runtime 中转。
 */
import { getCompiledConsciousnessGraph } from './consciousness.graph.js';

let _initialized = false;

/**
 * 集中初始化所有内置 workflow。幂等。
 * server.js 启动时在 pg pool ready 后、initTickLoop 前调。
 */
export async function initializeWorkflows() {
  if (_initialized) return;

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
