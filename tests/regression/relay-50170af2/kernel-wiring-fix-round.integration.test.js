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
      detail: { verification_status: 'verified', pr_head_sha: callbackSha },
    },
  ];
}

describe('kernel wiring: fixRound counts only effective product fixes', () => {
  test('many SHA-advancing product fixes remain routable; fixRound is observation only', () => {
    const logRows = [];
    for (let round = 0; round < 12; round += 1) {
      logRows.push(...fixPair(
        round * 2 + 1,
        `sha-${round}`,
        `sha-${round + 1}`,
      ));
    }

    const counters = deriveCounters(logRows, { proposeBranchMaxRn: 0 });
    expect(counters.fixRound).toBe(12);

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
        head_sha: 'sha-12',
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
      phase: 'generate',
      action: 'spawn:generator-fix',
      reason: 'ci_fail',
    });
  });
});
