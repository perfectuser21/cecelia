import { expect, it } from 'vitest';
import { evaluateReadback } from '../step-readback-eval.js';
import { reconcileSteps } from '../step-reconcile.js';

const rb = (op = '==', value = 0) => ({ type: 'metric', ref: 'metrics.count', expect: { op, value } });
const invalid = [null, undefined, '', ' \t\n', false, [], [0], {}].map(observed => ({ observed }));
const ops = ['==', '!=', '>=', '<=', '>', '<'];

it.each(invalid)('空/非标量观测%j在所有比较运算中一律unknown', ({ observed }) => {
  for (const op of ops) {
    expect(evaluateReadback(rb(op), observed).verdict).toBe('unknown');
    expect(evaluateReadback(rb(op), { value: observed }).verdict).toBe('unknown');
  }
});
it.each(invalid)('无效期望%j不能参与隐式零比较', ({ observed: value }) => {
  for (const op of ops) expect(evaluateReadback(rb(op, value), 0).verdict).toBe('unknown');
});
it.each(invalid)('真实对账consumer拒绝将%j收敛为绿', ({ observed }) => {
  const report = reconcileSteps({
    steps: [{ id: 'step-1', key: 'required-zero', readback: rb() }],
    spans: [{ run_id: 'run-1', step_id: 'step-1', outcome: 'pass', evidence: { observed }, started_at: '2026-11-05T00:00:00Z' }],
    runsWanted: 1, requiredGreen: 1,
  });
  expect(report).toMatchObject({ converged: false, consecutive_green: 0, verdict: 'diverged' });
  expect(report.runs[0]).toMatchObject({ green: false, steps: [{ key: 'required-zero', step_id: 'step-1', status: 'unverified' }] });
  expect(report.issues).toContainEqual({ code: 'step_unobserved', step_key: 'required-zero', run_id: 'run-1' });
});
it.each([0, '0', ' 0 ', { value: 0 }, { value: '0' }])('合法零%j仍被真函数/对账验证通过', observed => {
  expect(evaluateReadback(rb(), observed)).toEqual({ verdict: 'pass' });
  const report = reconcileSteps({ steps: [{ id: 's', key: 'zero', readback: rb() }], spans: [{ run_id: 'r', step_id: 's', outcome: 'pass', evidence: { observed }, started_at: '2026-11-05T00:00:00Z' }], requiredGreen: 1 });
  expect(report).toMatchObject({ converged: true, consecutive_green: 1 });
});
it.each([['==', 0], ['!=', 1], ['>=', 0], ['<=', 0], ['>', -1], ['<', 1]])('%s仍兼容数字字符串与零', (op, expected) => {
  expect(evaluateReadback(rb(op, String(expected)), '0')).toEqual({ verdict: 'pass' });
});
it('非数字文本等于/不等于与not_null_all既有合同保留', () => {
  expect(evaluateReadback(rb('==', 'ready'), 'ready')).toEqual({ verdict: 'pass' });
  expect(evaluateReadback(rb('!=', 'ready'), 'pending')).toEqual({ verdict: 'pass' });
  expect(evaluateReadback(rb('==', 'ready'), 'pending').verdict).toBe('fail');
  expect(evaluateReadback(rb('not_null_all'), [0, false, ''])).toEqual({ verdict: 'pass' });
  expect(evaluateReadback(rb('not_null_all'), [0, null]).verdict).toBe('fail');
});
