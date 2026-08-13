import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ runJudgeGate: vi.fn() }));

vi.mock('../../harness-judge.js', () => ({ runJudgeGate: mocks.runJudgeGate }));

import { verifyJudgeCallbackResult } from '../judge-result-verifier.js';

describe('Fleet Judge callback verifier', () => {
  beforeEach(() => {
    mocks.runJudgeGate.mockReset().mockResolvedValue({
      verdict: 'PASS',
      feedback: 'server verified',
      judged: true,
      failure_class: null,
    });
  });

  it('以 evaluator 真证据和 local candidate SHA 运行服务端机械闸', async () => {
    const candidateHead = 'b'.repeat(40);
    const attempt = {
      id: '22222222-2222-4222-8222-222222222222',
      role: 'judge',
      task_bundle: {
        inputs: {
          task_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          sprint_dir: 'sprints/x',
          candidate: { head_sha: candidateHead },
          evaluator_result: {
            status: 'completed',
            summary: 'evaluator passed',
            checks: [{ command: 'npm test', exit_code: 0, log_tail: 'passed' }],
            decision: { outcome: 'PASS', reason: 'verified' },
          },
          contract: { contract_content: 'contract', prd_content: 'prd' },
          artifacts: [],
        },
      },
    };
    const result = {
      status: 'completed',
      summary: 'provider judge passed',
      decision: {
        outcome: 'PASS',
        reason: 'covered',
        coverage: [{ step: 'contract', passed: true }],
      },
    };
    const dbPool = { query: vi.fn() };

    const verified = await verifyJudgeCallbackResult({ attempt, result, dbPool });

    expect(mocks.runJudgeGate).toHaveBeenCalledWith(expect.objectContaining({
      agentVerdict: 'PASS',
      brainResult: expect.objectContaining({
        behavior_tests: attempt.task_bundle.inputs.evaluator_result.checks,
      }),
      stageFacts: {
        current_stage: 'local_candidate',
        pr_state: null,
        pr_merged: false,
        head_sha: candidateHead,
        merge_gate_approved: false,
      },
    }), expect.objectContaining({ strict: true, dbPool, judgeFn: expect.any(Function) }));
    const judgeFn = mocks.runJudgeGate.mock.calls[0][1].judgeFn;
    await expect(judgeFn()).resolves.toMatchObject({
      verdict: 'PASS',
      coverage: [{ step: 'contract', passed: true }],
    });
    expect(verified.decision).toEqual({
      outcome: 'PASS',
      reason: 'server verified',
    });
  });

  it('非 Judge 或非成功终态不调用机械闸', async () => {
    const failed = { status: 'failed', decision: null };
    await expect(verifyJudgeCallbackResult({
      attempt: { role: 'judge' }, result: failed, dbPool: {},
    })).resolves.toBe(failed);
    expect(mocks.runJudgeGate).not.toHaveBeenCalled();
  });
});
