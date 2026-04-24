/**
 * Brain v2 Phase C2: workflows 集中注册入口。
 *
 * Brain server 启动时调 initializeWorkflows()，在所有 graph-runtime 调用前把
 * 已知 workflow 注册到 orchestrator/workflow-registry。保证 runWorkflow 能查到。
 *
 * Phase C2 只注册 dev-task。C3/C4/C5 搬 harness-gan / harness-initiative /
 * content-pipeline 后，此处继续增 register 调用，不散落到各处。
 */
import { registerWorkflow, getWorkflow } from '../orchestrator/workflow-registry.js';
import { compileDevTaskGraph } from './dev-task.graph.js';

let _initialized = false;

/**
 * 集中初始化所有内置 workflow。幂等。
 * server.js 启动时在 pg pool ready 后、initTickLoop 前调。
 */
export async function initializeWorkflows() {
  if (_initialized) return;

  // 幂等：若已注册（热重载场景）跳过
  try {
    getWorkflow('dev-task');
    _initialized = true;
    return;
  } catch {
    // 未注册，继续初始化
  }

  const devTaskGraph = await compileDevTaskGraph();
  registerWorkflow('dev-task', devTaskGraph);

  _initialized = true;
}

/**
 * 测试 hook：重置初始化状态。仅 __tests__ 使用。
 */
export function _resetInitializedForTests() {
  _initialized = false;
}
