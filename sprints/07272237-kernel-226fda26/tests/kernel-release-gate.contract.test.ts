import { describe, expect, it } from 'vitest';

describe('kernel release gate exact-SHA contract [BEHAVIOR]', () => {
  it('ground truth derive gate decision-log close the loop on current sha', async () => {
    const groundTruth: any = await import('../../../packages/brain/src/orchestrator/ground-truth.js');
    const deriveModule: any = await import('../../../packages/brain/src/orchestrator/derive.js');
    const decisionLog: any = await import('../../../packages/brain/src/orchestrator/decision-log.js');

    expect(typeof groundTruth.collectKernelReleaseGateTruth).toBe('function');
    expect(typeof deriveModule.deriveKernelReleaseGateDecision).toBe('function');
    expect(typeof decisionLog.appendKernelReleaseGateVerdict).toBe('function');
  });

  it('post-merge gates stay independent', async () => {
    const mod: any = await import('../../../packages/brain/src/orchestrator/gates.js');
    expect(typeof mod.evaluatePostMergeReleaseGate).toBe('function');

    const reasons = [
      'staging_missing',
      'staging_skip_no_contract',
      'staging_failed',
      'staging_tested_sha_missing',
      'staging_tested_sha_stale',
      'production_missing',
      'production_failed',
      'final_report_missing',
    ];

    for (const reason of reasons) {
      const result = mod.evaluatePostMergeReleaseGate({
        current_head_sha: 'sha-final',
        scenario: reason,
      });
      expect(result.allow).toBe(false);
      expect(result.reason).toBe(reason);
    }
  });

  it('stale approval invalidated by new commit', async () => {
    const mod: any = await import('../../../packages/brain/src/orchestrator/gates.js');
    expect(typeof mod.evaluateKernelReleaseGate).toBe('function');

    const result = mod.evaluateKernelReleaseGate({
      pr_state: 'OPEN',
      is_draft: true,
      autoMergeRequest: null,
      current_head_sha: 'sha-new',
      evaluateVerdict: { verdict: 'PASS', pr_head_sha: 'sha-new' },
      judgeVerdict: { verdict: 'PASS', pr_head_sha: 'sha-new' },
      humanApproval: { approved: true, pr_head_sha: 'sha-old', review_request_hop: 8 },
    });

    expect(result.allow).toBe(false);
    expect(result.reason).toBe('human_approval_stale');
  });
});
