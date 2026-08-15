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
        action: 'materialize:direct_profile_contract',
        reason: 'direct_profile_contract_required',
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

describe('routing receipt profile precedence', () => {
  it('uses a new-capability override instead of the receipt default or legacy bugfix', () => {
    expect(derive(initialObserved('hotfix-v1', {
      change_kind: 'bugfix',
      routingReceipt: {
        default_execution_profile: 'hotfix-v1',
        execution_profile_override: 'new-capability-v1',
      },
    }))).toMatchObject({
      phase: 'planning',
      action: 'spawn:planner',
    });
  });

  it('fails closed when a new-capability receipt is downgraded to hotfix', () => {
    expect(derive(initialObserved('new-capability-v1', {
      change_kind: 'new_capability',
      routingReceipt: {
        default_execution_profile: 'new-capability-v1',
        execution_profile_override: 'hotfix-v1',
      },
    }))).toMatchObject({
      phase: 'failed',
      action: 'mark_failed',
      reason: 'invalid_execution_profile_override',
    });
  });

  it.each([
    ['hotfix-v1', 'parameter-only-v1'],
    ['parameter-only-v1', 'hotfix-v1'],
  ])('fails closed for equal-rank cross-profile override %s -> %s', (
    defaultProfile,
    overrideProfile,
  ) => {
    expect(derive(initialObserved(defaultProfile, {
      routingReceipt: {
        default_execution_profile: defaultProfile,
        execution_profile_override: overrideProfile,
      },
    }))).toMatchObject({
      phase: 'failed',
      action: 'mark_failed',
      reason: 'invalid_execution_profile_override',
    });
  });

  it.each([
    ['hotfix-v1', 'hotfix-v1', 'generate', 'materialize:direct_profile_contract'],
    ['hotfix-v1', 'capability-change-v1', 'planning', 'spawn:planner'],
    ['capability-change-v1', 'new-capability-v1', 'planning', 'spawn:planner'],
  ])('keeps legal same-profile or stronger override %s -> %s', (
    defaultProfile,
    overrideProfile,
    phase,
    action,
  ) => {
    expect(derive(initialObserved(defaultProfile, {
      routingReceipt: {
        default_execution_profile: defaultProfile,
        execution_profile_override: overrideProfile,
      },
    }))).toMatchObject({ phase, action });
  });

  it('uses a capability-change override instead of the receipt default or legacy bugfix', () => {
    expect(derive(initialObserved('hotfix-v1', {
      change_kind: 'bugfix',
      routingReceipt: {
        default_execution_profile: 'hotfix-v1',
        execution_profile_override: 'capability-change-v1',
      },
    }))).toMatchObject({
      phase: 'planning',
      action: 'spawn:planner',
      reason: 'profile_light_planner_required',
    });
  });

  it('keeps legacy bugfix routing when no receipt observation exists', () => {
    const observed = initialObserved('new-capability-v1', { change_kind: 'bugfix' });
    delete observed.routingReceipt;

    expect(derive(observed)).toMatchObject({
      phase: 'generate',
      action: 'spawn:generator',
    });
  });

  it.each(['hotfix-v1', 'parameter-only-v1'])(
    'dispatches %s to generator only after the direct contract is approved',
    (profile) => {
      expect(derive(initialObserved(profile, {
        contract: { approved: true, id: 'contract-direct' },
      }))).toMatchObject({
        phase: 'generate',
        action: 'spawn:generator',
        reason: 'contract_approved',
      });
    },
  );
});
