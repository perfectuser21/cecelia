import { describe, expect, it } from 'vitest';
import { derive } from '../derive.js';

function observed(decisionLog) {
  return {
    run: { phase: 'generate' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: true },
    pr: null,
    candidate: null,
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 1, auth_failed: false, action: 'spawn:generator' },
    proposeBranchRn: 2,
    ganLatestRoundVerdict: 'APPROVED',
    generatorSpawned: true,
    evaluateVerdict: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    counters: {
      hops: 4,
      fixRound: 0,
      pollCount: 0,
      noPushStreak: 0,
      noVerdictStreak: 0,
      ganCostUsd: 0,
    },
    decisionLog,
  };
}

function infrastructureFailure(hop, dispatchedHop) {
  return {
    hop,
    action: 'verdict:attempt_callback',
    detail: {
      role: 'generator',
      hop: dispatchedHop,
      status: 'failed',
      failure_class: 'infrastructure_blocked',
      error_code: 'provider_unavailable',
      failure_signature: ['provider_unavailable'],
    },
  };
}

describe('Generator 基础设施失败重试保持原派发动作', () => {
  it('首次 Generator 尚未产生候选时仍重派 Generator，不进入 Generator-fix', () => {
    expect(derive(observed([
      { hop: 2, action: 'spawn:generator', observed: {} },
      infrastructureFailure(3, 2),
    ]))).toEqual({
      phase: 'generate',
      action: 'spawn:generator',
      reason: 'callback_infrastructure_blocked',
    });
  });

  it('Generator-fix 自身基础设施失败时保持 Generator-fix', () => {
    expect(derive(observed([
      { hop: 2, action: 'spawn:generator-fix', observed: {} },
      infrastructureFailure(3, 2),
    ]))).toEqual({
      phase: 'generate',
      action: 'spawn:generator-fix',
      reason: 'callback_infrastructure_blocked',
    });
  });
});
