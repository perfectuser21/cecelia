/**
 * 治理守卫错误 → HTTP 响应映射（链 bf5088a3 棒5）：各路由共用，映射漂移会让同一违规在不同入口回不同状态码。
 */
import { describe, it, expect } from 'vitest';
import { governanceErrorResponse } from '../governance-errors.js';
import { GoalGuardError } from '../goal-guard.js';
import { OwnerDecisionProtocolError } from '../owner-decision.js';
import { TaskDependencyError } from '../task-dependencies.js';

describe('governanceErrorResponse', () => {
  it('GoalGuardError → 400，body.details 带 is_objective 与 KR 清单', () => {
    const r = governanceErrorResponse(new GoalGuardError('m', { goal_id: 'g', is_objective: true, key_results: [{ id: 'k' }] }));
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: 'goal_id_not_key_result', details: { is_objective: true } });
  });

  it('OwnerDecisionProtocolError → 400，body.violations 列全缺项', () => {
    const r = governanceErrorResponse(new OwnerDecisionProtocolError([{ field: 'question', reason: 'x' }]));
    expect(r.status).toBe(400);
    expect(r.body.violations).toEqual([{ field: 'question', reason: 'x' }]);
  });

  it('TaskDependencyError：成环 → 409，其余 → 400，details 摊平进 body（missing 等）', () => {
    expect(governanceErrorResponse(new TaskDependencyError('dependency_cycle', 'c')).status).toBe(409);
    const nf = governanceErrorResponse(new TaskDependencyError('depends_on_not_found', 'n', { missing: ['a'] }));
    expect(nf.status).toBe(400);
    expect(nf.body.missing).toEqual(['a']);
  });

  it('非治理守卫错误 → null（调用方按原逻辑处理，不吞别的异常）', () => {
    expect(governanceErrorResponse(new Error('boom'))).toBeNull();
    expect(governanceErrorResponse(null)).toBeNull();
  });
});
