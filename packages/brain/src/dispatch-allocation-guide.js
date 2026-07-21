import { shouldDowngrade } from './token-budget-planner.js';

export const DISPATCH_ALLOCATION_GUIDE_VERSION = 'dispatch-allocation-guide/v1';

const GUIDED_TASK_TYPES = new Set(['dev']);

/**
 * dispatcher 前置引导员：
 * - 不改 executor.js，复用既有 payload.executor/payload.machine 显式路由
 * - 当前只覆盖可降级的 dev 类任务
 * - 统一把调度决策写进 payload.allocation，供审计/复盘
 */
export function applyDispatchAllocationGuide(task, opts = {}) {
  const budgetState = opts.budgetState || 'abundant';
  const now = opts.now || (() => new Date());
  const taskType = String(task?.task_type || '');
  const payload = task?.payload || {};

  if (!GUIDED_TASK_TYPES.has(taskType)) {
    return { task, changed: false, payloadPatch: null, reason: 'task_type_not_guided' };
  }

  if (payload.executor || payload.machine) {
    return { task, changed: false, payloadPatch: null, reason: 'explicit_override_preserved' };
  }

  const selectedExecutor = shouldDowngrade(taskType, budgetState) ? 'codex' : 'claude';
  const allocation = {
    selector: DISPATCH_ALLOCATION_GUIDE_VERSION,
    path: 'dispatcher.pre_trigger',
    task_type: taskType,
    budget_state: budgetState,
    selected_executor: selectedExecutor,
    reason: selectedExecutor === 'codex' ? `budget_state=${budgetState}` : 'default_claude',
    decided_at: now().toISOString(),
  };

  const payloadPatch = selectedExecutor === 'codex'
    ? { executor: 'codex', allocation }
    : { allocation };

  return {
    task: {
      ...task,
      payload: {
        ...payload,
        ...payloadPatch,
      },
    },
    changed: true,
    payloadPatch,
    allocation,
    reason: allocation.reason,
  };
}
