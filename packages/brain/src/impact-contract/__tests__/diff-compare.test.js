import { describe, expect, it } from 'vitest';
import { compareImpactContract } from '../diff-compare.js';

describe('compareImpactContract', () => {
  it('受影响 Capability 没有 runnable assertion 时 fail-closed 为 drift', () => {
    expect(compareImpactContract(
      [{ capability_id: 'F1' }],
      [{ capability_id: 'F1' }],
      [],
      [],
    )).toMatchObject({
      verdict: 'drift',
      drift_nodes: ['F1'],
      reason_code: 'CONTRACT_IMPACT_DRIFT',
    });
  });

  it('同一 Capability 的 assertion identity 换版时要求 extend', () => {
    const contractAssertion = {
      assertion_id: 'f1-smoke',
      command: 'npx vitest run f1.test.js',
      covers_capability_ids: ['F1'],
      journey_step_link_id: 'link-1',
      assertion_revision: 1,
      assertion_digest: 'a'.repeat(64),
    };
    const currentAssertion = {
      ...contractAssertion,
      assertion_revision: 2,
      assertion_digest: 'b'.repeat(64),
    };

    expect(compareImpactContract(
      [{ capability_id: 'F1' }],
      [{ capability_id: 'F1' }],
      [contractAssertion],
      [currentAssertion],
    )).toMatchObject({
      verdict: 'extend',
      changed_assertions: ['f1-smoke'],
    });
  });
});
