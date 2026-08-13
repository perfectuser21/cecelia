import { describe, expect, it } from 'vitest';
import { selectPipeline } from '../../work-router.js';
import { derive } from '../derive.js';

function initialObserved(profile, overrides = {}) {
  return {
    run: { phase: 'planning' },
    task: { status: 'in_progress' },
    routingReceipt: {
      default_execution_profile: profile,
      execution_profile_override: null,
    },
    prdExists: false,
    contract: { approved: false },
    pr: null,
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false },
    proposeBranchRn: 0,
    ganLatestRoundVerdict: null,
    generatorSpawned: false,
    evaluateVerdict: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    decisionLog: [],
    counters: {
      hops: 1, fixRound: 0, pollCount: 0,
      noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0,
    },
    ...overrides,
  };
}

describe('four-form profiles', () => {
  it('keeps evaluator and judge in every coding profile', () => {
    for (const change_kind of ['new_capability','capability_change','bugfix','parameter_only']) {
      const route = selectPipeline({ work_kind: 'coding_mutation', change_kind });
      expect(route.impact_contract_required).toBe(true);
      expect(route.orchestrator).toBe('kernel-harness-v2');
    }
  });

  it('runs the four receipt profiles without inferring from gear', () => {
    expect(derive(initialObserved('new-capability-v1'))).toMatchObject({ action: 'spawn:planner' });
    expect(derive(initialObserved('capability-change-v1'))).toMatchObject({ action: 'spawn:planner' });
    expect(derive(initialObserved('capability-change-v1', {
      prdExists: true,
      proposeBranchRn: 0,
    }))).toMatchObject({ action: 'spawn:proposer' });
    expect(derive(initialObserved('capability-change-v1', {
      prdExists: true,
      proposeBranchRn: 1,
    }))).toMatchObject({ action: 'force_approve_contract' });
    for (const profile of ['hotfix-v1', 'parameter-only-v1']) {
      expect(derive(initialObserved(profile))).toMatchObject({
        phase: 'generate',
        action: 'spawn:generator',
      });
    }
  });

  it('fails closed for missing or unknown receipt profiles', () => {
    expect(derive(initialObserved('unknown-v1'))).toMatchObject({
      phase: 'failed', action: 'mark_failed', reason: 'invalid_execution_profile',
    });
    expect(derive(initialObserved(null, { routingReceipt: null }))).toMatchObject({
      phase: 'failed', action: 'mark_failed', reason: 'routing_receipt_missing',
    });
  });
});
