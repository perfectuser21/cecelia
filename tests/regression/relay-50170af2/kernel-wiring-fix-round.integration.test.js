import { describe, expect, test } from 'vitest';
import { deriveCounters } from '../../../packages/brain/src/orchestrator/counters.js';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';

function fixPair(hop, triggerSha, callbackSha, failureClass = 'product_failure') {
  return [
    {
      hop,
      action: 'spawn:generator-fix',
      observed: { trigger_sha: triggerSha, failure_class: failureClass },
    },
    {
      hop: hop + 1,
      action: 'verdict:generator-fix-callback',
      observed: { trigger_hop: hop, pr_head_sha: callbackSha },
    },
  ];
}

describe('kernel wiring: fixRound counts only effective product fixes', () => {
  test('three SHA-advancing product fixes reach cap; recovery, no-callback and same-SHA do not consume it', () => {
    const logRows = [
      ...fixPair(1, 'sha-0', 'sha-1'),
      // Evidence repair never enters the product fix counter.
      { hop: 3, action: 'spawn:evaluator-evidence-repair', observed: { trigger_sha: 'sha-1' } },
      ...fixPair(4, 'sha-1', 'sha-env', 'environment_recovery'),
      // Intent without a completed callback is not an effective fix.
      {
        hop: 6,
        action: 'spawn:generator-fix',
        observed: { trigger_sha: 'sha-env', failure_class: 'product_failure' },
      },
      ...fixPair(7, 'sha-env', 'sha-2'),
      // Same SHA belongs to the no-progress terminal, not fixRound.
      ...fixPair(9, 'sha-2', 'sha-2'),
      ...fixPair(11, 'sha-2', 'sha-3'),
    ];

    const counters = deriveCounters(logRows, { proposeBranchMaxRn: 0 });
    expect(counters.fixRound).toBe(3);

    const decision = derive({
      run: { phase: 'generate', cost_usd: '0' },
      task: { status: 'in_progress', payload: {} },
      prdExists: true,
      contract: { approved: true, id: 'contract-1', row: {} },
      pr: {
        url: 'https://github.com/example/repo/pull/1',
        state: 'OPEN',
        merged: false,
        ci: 'fail',
        head_sha: 'sha-3',
      },
      inflight: { containers: [], host_pids: [] },
      lastAgentExit: { code: null, auth_failed: false },
      proposeBranchRn: 0,
      ganLatestRoundVerdict: null,
      generatorSpawned: true,
      evaluateVerdict: null,
      judgeVerdict: null,
      reviewRequired: false,
      reviewApproved: false,
      decisionLog: logRows,
      authCircuit: [],
      callbackResult: null,
      noProgress: false,
      counters: { ...counters, ganCostUsd: 0 },
    });
    expect(decision).toMatchObject({
      phase: 'failed',
      action: 'mark_failed',
      reason: 'fix_cap',
    });
  });
});
