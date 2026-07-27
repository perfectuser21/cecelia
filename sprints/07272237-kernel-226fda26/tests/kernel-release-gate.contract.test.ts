import { describe, expect, it } from 'vitest';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';

const CURRENT_SHA = 'c'.repeat(40);

function baseObserved(overrides = {}) {
  return {
    run: { phase: 'evaluate' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: true },
    pr: {
      url: 'https://github.com/perfectuser21/cecelia/pull/4226',
      state: 'OPEN',
      ci: 'pass',
      merged: false,
      head_sha: CURRENT_SHA,
      is_draft: true,
      auto_merge_request: null,
    },
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false },
    proposeBranchRn: 0,
    ganLatestRoundVerdict: null,
    generatorSpawned: true,
    evaluateVerdict: { verdict: 'PASS', pr_head_sha: CURRENT_SHA },
    judgeVerdict: { verdict: 'PASS', pr_head_sha: CURRENT_SHA },
    reviewRequired: true,
    reviewApproved: false,
    counters: {
      hops: 12,
      fixRound: 0,
      pollCount: 0,
      noPushStreak: 0,
      noVerdictStreak: 0,
      ganCostUsd: 0,
    },
    decisionLog: [],
    ...overrides,
  };
}

describe('kernel release gate exact-SHA contract [BEHAVIOR]', () => {
  it('ground truth derive gate decision-log close the loop on current sha', () => {
    const decision = derive(baseObserved({
      reviewApproved: true,
      kernelReleaseGate: {
        allow: false,
        reason: 'missing_required_context',
        current_head_sha: CURRENT_SHA,
        tested_sha: CURRENT_SHA,
        decision_log_transition: 'ground_truth->derive->gate',
      },
    }));

    expect(decision).toMatchObject({
      phase: 'evaluate',
      action: 'wait:kernel_release_gate',
      reason: 'missing_required_context',
    });
  });

  it.each([
    'staging_missing',
    'staging_skip_no_contract',
    'staging_failed',
    'staging_tested_sha_missing',
    'staging_tested_sha_stale',
    'production_missing',
    'production_failed',
    'final_report_missing',
  ])('post-merge gate stays independent: %s', (reason) => {
    const decision = derive(baseObserved({
      pr: {
        url: 'https://github.com/perfectuser21/cecelia/pull/4226',
        state: 'MERGED',
        ci: 'pass',
        merged: true,
        head_sha: CURRENT_SHA,
        is_draft: true,
        auto_merge_request: null,
      },
      reviewApproved: true,
      postMergeGate: {
        allow: false,
        reason,
        current_head_sha: CURRENT_SHA,
      },
    }));

    expect(decision).toMatchObject({
      phase: 'report',
      action: 'wait:post_merge_gate',
      reason,
    });
  });

  it('stale approval invalidated by new commit', () => {
    const decision = derive(baseObserved({
      evaluateVerdict: { verdict: 'PASS', pr_head_sha: CURRENT_SHA },
      judgeVerdict: { verdict: 'PASS', pr_head_sha: CURRENT_SHA },
      reviewRequired: true,
      reviewApproved: false,
      kernelReleaseGate: {
        allow: false,
        reason: 'human_approval_stale',
        current_head_sha: CURRENT_SHA,
        approval_head_sha: 'b'.repeat(40),
      },
    }));

    expect(decision).toMatchObject({
      phase: 'review',
      action: 'wait:human_review',
      reason: 'human_approval_stale',
    });
  });
});
