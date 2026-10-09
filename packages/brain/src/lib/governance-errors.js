/**
 * 治理守卫错误 → HTTP 响应的统一映射（链 bf5088a3 棒5）。
 * POST /tasks、POST /tasks/:id/block、依赖 API 共用，避免各路由各写一份映射而漂移。
 */
import { GoalGuardError } from './goal-guard.js';
import { OwnerDecisionProtocolError } from './owner-decision.js';
import { TaskDependencyError } from './task-dependencies.js';
import { ProjectRootGateError } from './project-root-gate.js';

/**
 * @param {unknown} err
 * @returns {{status: number, body: object} | null} 非治理守卫错误返回 null，由调用方按原逻辑处理
 */
export function governanceErrorResponse(err) {
  if (err instanceof GoalGuardError) {
    return { status: 400, body: { error: err.code, reason_code: err.code, message: err.message, details: err.details } };
  }
  if (err instanceof OwnerDecisionProtocolError) {
    return { status: 400, body: { error: err.code, reason_code: err.code, message: err.message, violations: err.violations } };
  }
  if (err instanceof ProjectRootGateError) {
    return { status: 400, body: { error: err.code, reason_code: err.code, message: err.message, hint: err.hint, ...err.details } };
  }
  if (err instanceof TaskDependencyError) {
    const status = err.code === 'dependency_cycle' ? 409 : 400;
    return { status, body: { error: err.code, reason_code: err.code, message: err.message, ...err.details } };
  }
  return null;
}
