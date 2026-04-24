/**
 * Brain v2 L2 Orchestrator: workflow 统一入口 runtime。
 *
 * 职责：
 * - thread_id 强制格式 `{taskId}:{attemptN}`（spec §6.3，retry 时 caller 递增 attemptN）
 * - checkpointer has-thread 预检：有 checkpoint 传 null resume；无则传 input fresh start
 * - graph.invoke 封装，caller 不直接接触 LangGraph config
 *
 * Phase C2-C5 把 harness-gan / harness-initiative / content-pipeline / dev-task
 * 迁到 workflows/*.graph.js 后，所有 caller（tick.js / task-router）只调 runWorkflow。
 *
 * 本 PR（C1）只建骨架 + 测试，不接线到 tick.js / executor.js（C2 起灰度接入）。
 */
import { getWorkflow } from './workflow-registry.js';
import { getPgCheckpointer } from './pg-checkpointer.js';

const THREAD_ID_RE = /^[^:]+:\d+$/;

/**
 * 运行 workflow。
 * @param {string} workflowName 已注册的 workflow 名（getWorkflow 查得到）
 * @param {string} taskId       Brain task UUID
 * @param {number} attemptN     重试次数（1-based positive integer）
 * @param {object|null} input   fresh start 的 input state；resume 时传 null 也无妨，实际由内部判
 * @returns {Promise<object>}   graph.invoke 返回值
 */
export async function runWorkflow(workflowName, taskId, attemptN, input = null) {
  if (!workflowName || typeof workflowName !== 'string') {
    throw new TypeError('workflowName required (non-empty string)');
  }
  if (!taskId || typeof taskId !== 'string') {
    throw new TypeError('taskId required (non-empty string)');
  }
  if (!Number.isInteger(attemptN) || attemptN < 1) {
    throw new TypeError('attemptN must be positive integer');
  }

  const graph = getWorkflow(workflowName); // throws 'workflow not found' if not registered
  const threadId = `${taskId}:${attemptN}`;
  if (!THREAD_ID_RE.test(threadId)) {
    throw new Error(`invalid thread_id: ${threadId}`);
  }

  const config = { configurable: { thread_id: threadId } };
  const hasCheckpoint = await checkpointerHasThread(threadId);
  const actualInput = hasCheckpoint ? null : input;

  return await graph.invoke(actualInput, config);
}

/**
 * 查 pg checkpointer 是否已有该 thread 的 checkpoint。
 * @param {string} threadId
 * @returns {Promise<boolean>}
 */
async function checkpointerHasThread(threadId) {
  const checkpointer = await getPgCheckpointer();
  const state = await checkpointer.get({ configurable: { thread_id: threadId } });
  return state != null;
}

// Export for testing only
export { checkpointerHasThread as _checkpointerHasThread };
