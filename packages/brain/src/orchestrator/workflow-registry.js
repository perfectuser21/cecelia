/**
 * Brain v2 L2 Orchestrator: workflow 注册表。
 *
 * Phase C2-C5 每新建一个 .graph.js workflow 调 registerWorkflow(name, compiledGraph) 注册。
 * graph-runtime.runWorkflow 通过 getWorkflow(name) 取 compiled graph。
 *
 * 注册表是进程内 Map，单例语义。禁止并发注册同名。
 */

const _registry = new Map();

/**
 * 注册 workflow。
 * @param {string} name  workflow 名（同时作为 runWorkflow 的 workflowName 参数）
 * @param {object} graph LangGraph compiled graph 实例（graph.invoke 可调）
 * @throws 同名已注册
 */
export function registerWorkflow(name, graph) {
  if (!name || typeof name !== 'string') throw new TypeError('workflow name required');
  if (!graph || typeof graph.invoke !== 'function') throw new TypeError('graph.invoke required');
  if (_registry.has(name)) throw new Error(`workflow already registered: ${name}`);
  _registry.set(name, graph);
}

/**
 * 获取已注册 workflow。
 * @param {string} name
 * @returns {object}
 * @throws 未注册
 */
export function getWorkflow(name) {
  const g = _registry.get(name);
  if (!g) throw new Error(`workflow not found: ${name}`);
  return g;
}

/**
 * 列已注册 workflow 名。
 * @returns {string[]}
 */
export function listWorkflows() {
  return Array.from(_registry.keys());
}

/**
 * 测试 hook：清空注册表。仅 __tests__ 使用。
 */
export function _clearRegistryForTests() {
  _registry.clear();
}
