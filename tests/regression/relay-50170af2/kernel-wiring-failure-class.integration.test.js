import { describe, expect, test } from 'vitest';
import { createKernelHandlers } from '../../../packages/brain/src/orchestrator/kernel-handlers.js';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';

const RUN_ID = '50000000-0000-4000-8000-000000000005';
const TASK_ID = '60000000-0000-4000-8000-000000000006';
const SHA = 'failure-class-head';

describe('kernel wiring: evaluator and judge failure classes remain distinct', () => {
  test('judge classification is appended without cleansing evaluator classification and drives derive', async () => {
    const rows = [{
      hop: 10,
      action: 'verdict:evaluate',
      observed: { pr: { head_sha: SHA } },
      detail: {
        verdict: 'PASS',
        pr_head_sha: SHA,
        failure_class: 'evidence_invalid',
      },
    }];
    const pool = {
      async query(sql, params) {
        if (sql.includes("'verdict:judge'")) {
          rows.push({
            hop: 11,
            action: 'verdict:judge',
            observed: JSON.parse(params[1]),
            gate_verdict: params[2],
            detail: JSON.parse(params[3]),
          });
        }
        return { rows: [] };
      },
    };
    const handlers = createKernelHandlers({
      pool,
      judgeGate: async () => ({
        judged: true,
        verdict: 'FAIL',
        feedback: 'human context is required',
        failure_class: 'needs_context',
      }),
      attemptStore: { complete: async () => ({ deduped: false }) },
    });

    await handlers['spawn:judge']({
      runId: RUN_ID,
      taskId: TASK_ID,
      attempt: { id: '70000000-0000-4000-8000-000000000007' },
      bundle: { inputs: { worktree_path: '/tmp/kernel', sprint_dir: 'sprints/kernel' } },
      observed: {
        pr: { head_sha: SHA },
        evaluateVerdict: rows[0].detail,
        evaluateResult: null,
        callbackResult: { verdict: 'PASS', behavior_tests: [] },
      },
    });

    const evaluatorRow = rows.find((row) => row.action === 'verdict:evaluate');
    const judgeRow = rows.find((row) => row.action === 'verdict:judge');
    expect(evaluatorRow.detail.failure_class).toBe('evidence_invalid');
    expect(judgeRow.detail).toMatchObject({
      verdict: 'FAIL',
      failure_class: 'needs_context',
      evaluator_failure_class: 'evidence_invalid',
    });

    const decision = derive({
      run: { phase: 'evaluate', cost_usd: '0' },
      task: { status: 'in_progress', payload: {} },
      prdExists: true,
      contract: { approved: true, id: 'contract-1', row: {} },
      pr: {
        url: 'https://github.com/example/repo/pull/1',
        state: 'OPEN',
        merged: false,
        ci: 'pass',
        head_sha: SHA,
      },
      inflight: { containers: [], host_pids: [] },
      lastAgentExit: { code: null, auth_failed: false },
      proposeBranchRn: 0,
      ganLatestRoundVerdict: null,
      generatorSpawned: true,
      evaluateVerdict: evaluatorRow.detail,
      judgeVerdict: judgeRow.detail,
      reviewRequired: false,
      reviewApproved: false,
      decisionLog: rows,
      authCircuit: [],
      callbackResult: null,
      counters: {
        hops: rows.length,
        fixRound: 0,
        pollCount: 0,
        noPushStreak: 0,
        noVerdictStreak: 0,
        ganCostUsd: 0,
      },
    });

    expect(decision).toMatchObject({
      action: 'wait:human_review',
      reason: 'needs_context:awaiting_human_review',
    });
  });
});
