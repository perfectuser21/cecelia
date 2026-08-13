import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

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

  it('Evaluator FIXED 仍必须经过独立 Judge，Provider FAIL 不得被覆盖', async () => {
    const candidateHead = 'c'.repeat(40);
    const attempt = {
      id: '33333333-3333-4333-8333-333333333333',
      role: 'judge',
      task_bundle: { inputs: {
        task_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        sprint_dir: 'sprints/x',
        candidate: { head_sha: candidateHead },
        evaluator_result: {
          status: 'completed',
          summary: 'fixed and verified',
          checks: [{ command: 'npm test', exit_code: 0, log_tail: 'passed' }],
          decision: { outcome: 'FIXED', reason: 'fix verified' },
        },
        contract: { contract_content: 'contract', prd_content: 'prd' },
        artifacts: [],
      } },
    };
    const result = {
      status: 'completed',
      summary: 'provider rejected evidence',
      decision: {
        outcome: 'FAIL', reason: 'coverage gap',
        coverage: [{ step: 'contract', passed: false }],
        failure_class: 'evidence_insufficient',
      },
    };
    mocks.runJudgeGate.mockImplementationOnce(async (ctx, opts) => {
      expect(ctx.agentVerdict).toBe('PASS');
      const provider = await opts.judgeFn();
      expect(provider.verdict).toBe('FAIL');
      return {
        verdict: 'FAIL', feedback: provider.feedback, judged: true,
        failure_class: provider.failure_class,
      };
    });

    const verified = await verifyJudgeCallbackResult({ attempt, result, dbPool: {} });

    expect(mocks.runJudgeGate).toHaveBeenCalledOnce();
    expect(verified.decision).toMatchObject({
      outcome: 'FAIL',
      failure_class: 'evidence_insufficient',
    });
  });

  it('Runner Judge schema 保留 coverage、failure_class 与 failure_signature', () => {
    const entrypointPath = new URL(
      '../../../../../docker/cecelia-runner/entrypoint.sh',
      import.meta.url,
    );
    const source = readFileSync(entrypointPath, 'utf8');
    const fn = source.match(
      /provider_result_schema_json\(\) \{[\s\S]*?\n\}\n\npublish_provider_result_schema\(\)/,
    )?.[0].replace(/\n\npublish_provider_result_schema\(\)$/, '');
    expect(fn).toBeTruthy();
    const root = mkdtempSync(path.join(tmpdir(), 'judge-schema-'));
    try {
      const bundle = path.join(root, 'bundle.json');
      writeFileSync(bundle, JSON.stringify({
        task_bundle: { expected_output: 'harness-result/judge-v1', role: 'judge' },
      }));
      const schema = JSON.parse(execFileSync('/bin/bash', [
        '-c', `${fn}\nprovider_result_schema_json "$1"`, '_', bundle,
      ], { encoding: 'utf8' }));
      const decision = schema.properties.decision.anyOf[0];
      expect(decision.required).toEqual(expect.arrayContaining([
        'outcome', 'reason', 'coverage', 'failure_class', 'failure_signature',
      ]));
      expect(decision.properties.coverage.items.required)
        .toEqual(['step', 'passed', 'evidence']);
      expect(decision.properties.failure_class.anyOf[0].enum)
        .toEqual(['evidence_insufficient', 'product_failure', 'evidence_invalid']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
