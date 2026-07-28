import { describe, expect, test } from 'vitest';
import { createKernelHandlers } from '../../../packages/brain/src/orchestrator/kernel-handlers.js';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';
import { sha256Canonical } from '../../../packages/brain/src/lib/kernel-equivalence-receipts.js';

const RUN_ID = '50000000-0000-4000-8000-000000000005';
const TASK_ID = '60000000-0000-4000-8000-000000000006';
const JUDGE_ATTEMPT_ID = '70000000-0000-4000-8000-000000000007';
const EVALUATOR_ATTEMPT_ID = '80000000-0000-4000-8000-000000000008';
const EVALUATOR_RECEIPT_ID = '90000000-0000-4000-8000-000000000009';
const EVALUATOR_RESULT_SHA256 = 'c'.repeat(64);
const SHA = 'd'.repeat(40);

function independentEvaluatorAuthority() {
  const evaluatorResult = {
    contract_version: '1.0',
    attempt_id: EVALUATOR_ATTEMPT_ID,
    status: 'completed',
    summary: 'evaluator result is fenced',
    checks: [],
    decision: {
      outcome: 'PASS',
      reason: 'mechanical evidence verified',
      pr_head_sha: SHA,
      failure_class: 'evidence_invalid',
    },
  };
  const evaluateVerdict = {
    attempt_id: EVALUATOR_ATTEMPT_ID,
    verdict: 'PASS',
    pr_head_sha: SHA,
    feedback: evaluatorResult.decision.reason,
    failure_class: evaluatorResult.decision.failure_class,
    executor_kind: 'fleet-worker',
    result_digest: sha256Canonical(evaluatorResult),
    result_receipt_id: EVALUATOR_RECEIPT_ID,
    result_sha256: EVALUATOR_RESULT_SHA256,
  };
  const attemptStore = {
    complete: async () => ({ deduped: false }),
    getById: async (id) => {
      if (id === JUDGE_ATTEMPT_ID) {
        return { id, run_id: RUN_ID, role: 'judge', status: 'running' };
      }
      if (id === EVALUATOR_ATTEMPT_ID) {
        return {
          id,
          run_id: RUN_ID,
          role: 'evaluator',
          status: 'completed',
          execution_transport: 'fleet-worker',
          lease_owner: 'worker-1',
          lease_generation: 4,
          completed_at: new Date('2026-07-29T00:00:00.000Z'),
          task_bundle: {
            inputs: {
              pull_request: { head_sha: SHA },
            },
          },
          result_receipt_id: EVALUATOR_RECEIPT_ID,
          result_sha256: EVALUATOR_RESULT_SHA256,
          result: evaluatorResult,
        };
      }
      return null;
    },
  };
  return { evaluatorResult, evaluateVerdict, attemptStore };
}

describe('kernel wiring: evaluator and judge failure classes remain distinct', () => {
  test('judge classification is appended without cleansing evaluator classification and drives derive', async () => {
    const authority = independentEvaluatorAuthority();
    const rows = [{
      hop: 10,
      action: 'verdict:evaluate',
      observed: { pr: { head_sha: SHA } },
      detail: authority.evaluateVerdict,
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
      attemptStore: authority.attemptStore,
    });

    await expect(handlers['spawn:judge']({
      runId: RUN_ID,
      taskId: TASK_ID,
      attempt: {
        id: JUDGE_ATTEMPT_ID,
        run_id: RUN_ID,
        role: 'judge',
      },
      bundle: { inputs: { worktree_path: '/tmp/kernel', sprint_dir: 'sprints/kernel' } },
      observed: {
        pr: { head_sha: SHA },
        evaluateVerdict: rows[0].detail,
        evaluateResult: authority.evaluatorResult,
        callbackResult: null,
      },
    })).resolves.toEqual({
      status: 'DONE',
      detail: 'judge:FAIL',
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
