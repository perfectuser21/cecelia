import { describe, expect, it } from 'vitest';
import { classifyJourneyCellAssertion } from '../journey-cell-assertion.js';

describe('classifyJourneyCellAssertion', () => {
  it.each([
    ['tests/brain/customer-message.test.js', null, 'test', true, false],
    ['zenithjoy/services/agent/tests/customer-message.test.ts', null, 'test', true, false],
    ['manual:bash .github/workflows/scripts/smoke/golden-path-4-smoke.sh', null, 'manual', true, false],
    ['eval:reply-quality-v1', null, 'evaluation', false, false],
    ['decision:gp-b-reply-policy-v1', null, 'decision', false, false],
    [null, '本步不涉及凭据', 'not_applicable', false, false],
    [null, null, 'missing', false, true],
  ])('ref=%s → %s', (assertionRef, naReason, state, runnable, needsAssertion) => {
    expect(classifyJourneyCellAssertion({ assertion_ref: assertionRef, na_reason: naReason }))
      .toEqual({
        assertion_state: state,
        runnable,
        needs_assertion: needsAssertion,
      });
  });

  it('probe:<key> 是可执行的探针锚点，执行体是 business_probe_runner（决策 702949b6）', () => {
    expect(classifyJourneyCellAssertion({ assertion_ref: 'probe:delivery.leads_count', na_reason: null }))
      .toEqual({
        assertion_state: 'probe',
        runnable: true,
        needs_assertion: false,
        executor_kind: 'business_probe_runner',
      });
    expect(classifyJourneyCellAssertion({ assertion_ref: 'probe:a,b.c' }).assertion_state).toBe('probe');
  });

  it('probe: 后面不是合法 key → unknown，不能靠前缀混过', () => {
    expect(classifyJourneyCellAssertion({ assertion_ref: 'probe:$(id)' }))
      .toEqual({ assertion_state: 'unknown', runnable: false, needs_assertion: true });
    expect(classifyJourneyCellAssertion({ assertion_ref: 'probe:' }).assertion_state).toBe('unknown');
  });

  it('不把普通说明文字误判为合法锚点', () => {
    expect(classifyJourneyCellAssertion({
      assertion_ref: '已拍板：默认全静默',
      na_reason: null,
    })).toEqual({
      assertion_state: 'unknown',
      runnable: false,
      needs_assertion: true,
    });
  });
});
