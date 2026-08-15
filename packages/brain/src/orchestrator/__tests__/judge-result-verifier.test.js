import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ runJudgeGate: vi.fn() }));

vi.mock('../../harness-judge.js', () => ({ runJudgeGate: mocks.runJudgeGate }));

import { verifyJudgeCallbackResult } from '../judge-result-verifier.js';

function passDecision(overrides = {}) {
  return {
    outcome: 'PASS',
    reason: 'covered',
    coverage: [],
    failure_class: null,
    failure_signature: null,
    ...overrides,
  };
}

function failDecision(overrides = {}) {
  return {
    outcome: 'FAIL',
    reason: 'failed',
    coverage: [],
    failure_class: 'product_failure',
    failure_signature: ['product_failure'],
    ...overrides,
  };
}

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
      decision: passDecision({
        coverage: [{
          step: 'contract', passed: true, deferred: false, evidence: 'contract checked',
        }],
      }),
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

  it('Fleet Judge 收到 Runner required assertion 回执时保留断言身份并映射 output_tail', async () => {
    const trustedCheck = {
      assertion_id: 'A1-save',
      command_argv: ['bash', 'scripts/assertion.sh'],
      exit_code: 0,
      output_tail: 'trusted runner proof',
      output_digest: 'a'.repeat(64),
    };
    const attempt = {
      id: '22222222-2222-4222-8222-222222222222',
      role: 'judge',
      task_bundle: { inputs: {
        task_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        candidate: { head_sha: 'b'.repeat(40) },
        evaluator_result: {
          status: 'completed',
          checks: [trustedCheck],
          decision: { outcome: 'PASS', reason: 'verified' },
        },
        artifacts: [],
      } },
    };

    await verifyJudgeCallbackResult({
      attempt,
      result: { status: 'completed', summary: 'covered', decision: passDecision() },
      dbPool: {},
    });

    expect(mocks.runJudgeGate).toHaveBeenCalledWith(expect.objectContaining({
      brainResult: expect.objectContaining({
        behavior_tests: [expect.objectContaining({
          assertion_id: 'A1-save',
          command: 'required_assertion:A1-save argv:["bash","scripts/assertion.sh"]',
          exit_code: 0,
          log_tail: 'trusted runner proof',
        })],
      }),
    }), expect.any(Object));
  });

  it('远端 PR 落后于 retained candidate 时 Judge 锚定候选 SHA', async () => {
    const candidateHead = 'b'.repeat(40);
    const stalePrHead = 'a'.repeat(40);
    const attempt = {
      id: '22222222-2222-4222-8222-222222222222',
      role: 'judge',
      task_bundle: { inputs: {
        task_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        sprint_dir: 'sprints/x',
        candidate: { head_sha: candidateHead },
        pull_request: {
          state: 'OPEN',
          merged: false,
          head_sha: stalePrHead,
        },
        evaluator_result: {
          status: 'completed',
          checks: [{ command: 'npm test', exit_code: 0, log_tail: 'passed' }],
          decision: { outcome: 'PASS', reason: 'verified' },
        },
        contract: { contract_content: 'contract', prd_content: 'prd' },
        artifacts: [],
      } },
    };

    await verifyJudgeCallbackResult({
      attempt,
      result: {
        status: 'completed',
        summary: 'provider judge passed',
        decision: passDecision(),
      },
      dbPool: {},
    });

    expect(mocks.runJudgeGate).toHaveBeenCalledWith(expect.objectContaining({
      stageFacts: expect.objectContaining({
        current_stage: 'local_candidate',
        head_sha: candidateHead,
      }),
    }), expect.any(Object));
  });

  it('把 Evaluator 的人式 findings、截图和探索记录完整交给独立 Judge', async () => {
    const findings = [{
      id: 'F-1',
      severity: 'P1',
      title: '保存按钮点击后没有反馈',
      expected: '显示成功提示',
      actual: '页面静默',
      reproduction_steps: ['打开表单', '点击保存'],
      evidence: ['console: POST /save 500'],
      screenshot_paths: ['/tmp/evidence/save-failed.png'],
    }];
    const screenshots = ['/tmp/evidence/save-failed.png'];
    const explorationNotes = ['验证了 happy path、错误态和刷新后的持久化'];
    const attempt = {
      id: '55555555-5555-4555-8555-555555555555',
      role: 'judge',
      task_bundle: { inputs: {
        task_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        candidate: { head_sha: 'e'.repeat(40) },
        evaluator_result: {
          status: 'completed',
          summary: 'human-like acceptance found a product defect',
          checks: [{ command: 'npm test', exit_code: 0, log_tail: 'passed' }],
          findings,
          screenshots,
          exploration_notes: explorationNotes,
          decision: {
            outcome: 'FAIL',
            reason: 'interactive acceptance failed',
            failure_class: 'product_failure',
          },
        },
        contract: { contract_content: 'contract', prd_content: 'prd' },
        artifacts: [],
      } },
    };

    await verifyJudgeCallbackResult({
      attempt,
      result: {
        status: 'completed',
        summary: 'judge confirmed defect',
        decision: failDecision({
          reason: 'confirmed',
          failure_signature: ['save_endpoint_500'],
        }),
      },
      dbPool: {},
    });

    expect(mocks.runJudgeGate).toHaveBeenCalledWith(expect.objectContaining({
      brainResult: expect.objectContaining({
        findings,
        screenshots,
        exploration_notes: explorationNotes,
      }),
    }), expect.any(Object));
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
      decision: failDecision({
        reason: 'coverage gap',
        coverage: [{
          step: 'contract', passed: false, deferred: false, evidence: 'coverage missing',
        }],
        failure_class: 'evidence_insufficient',
        failure_signature: ['contract_coverage_missing'],
      }),
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

  it('服务端未完成独立裁判时拒绝 Judge callback，不得把 Provider PASS 写成终态', async () => {
    mocks.runJudgeGate.mockResolvedValueOnce({
      verdict: 'PASS',
      feedback: null,
      judged: false,
      judgeError: 'judge evidence unavailable',
    });
    const attempt = {
      id: '44444444-4444-4444-8444-444444444444',
      role: 'judge',
      task_bundle: { inputs: {
        task_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        candidate: { head_sha: 'd'.repeat(40) },
        evaluator_result: {
          status: 'completed',
          checks: [{ command: 'npm test', exit_code: 0, log_tail: 'passed' }],
          decision: { outcome: 'PASS', reason: 'verified' },
        },
        contract: { contract_content: 'contract', prd_content: 'prd' },
        artifacts: [],
      } },
    };

    await expect(verifyJudgeCallbackResult({
      attempt,
      result: {
        status: 'completed',
        summary: 'provider judge passed',
        decision: passDecision(),
      },
      dbPool: {},
    })).rejects.toMatchObject({
      message: 'independent_judge_not_completed',
      status: 409,
    });
  });

  it.each(['MAYBE', 'FIXED', 'APPROVED', 'pass'])(
    '服务端拒绝 Judge 非法 outcome=%s，不得由机械闸归成 PASS',
    async (outcome) => {
      const attempt = {
        id: '77777777-7777-4777-8777-777777777777',
        role: 'judge',
        task_bundle: { inputs: {
          task_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          candidate: { head_sha: '1'.repeat(40) },
          evaluator_result: {
            status: 'completed',
            checks: [],
            findings: [],
            screenshots: [],
            exploration_notes: ['Explored the declared acceptance surface.'],
            decision: { outcome: 'PASS', reason: 'verified' },
          },
          contract: { contract_content: 'contract', prd_content: 'prd' },
          artifacts: [],
        } },
      };
      mocks.runJudgeGate.mockImplementationOnce(async (_ctx, opts) => {
        await opts.judgeFn();
        return { verdict: 'PASS', judged: true, feedback: 'must not happen' };
      });

      await expect(verifyJudgeCallbackResult({
        attempt,
        result: {
          status: 'completed',
          summary: 'provider response',
          decision: passDecision({ outcome, reason: 'ambiguous' }),
        },
        dbPool: {},
      })).rejects.toMatchObject({
        message: expect.stringMatching(/judge_result_decision_invalid/),
        status: 409,
      });
    },
  );

  it('在服务端拒绝畸形 Judge decision，不能只依赖 Runner JSON schema', async () => {
    const attempt = {
      id: '88888888-8888-4888-8888-888888888888',
      role: 'judge',
      task_bundle: { inputs: {
        task_id: '99999999-9999-4999-8999-999999999999',
        candidate: { head_sha: '2'.repeat(40) },
        evaluator_result: {
          status: 'completed', checks: [],
          decision: { outcome: 'PASS', reason: 'verified' },
        },
        contract: { contract_content: 'contract', prd_content: 'prd' },
        artifacts: [],
      } },
    };

    await expect(verifyJudgeCallbackResult({
      attempt,
      result: {
        status: 'completed',
        summary: 'forged provider response',
        decision: {
          outcome: 'PASS', reason: 'forged',
          coverage: [{ step: 123, passed: 'yes' }],
          failure_class: 'forged_class',
          failure_signature: { bad: true },
        },
      },
      dbPool: {},
    })).rejects.toThrow(/judge_result_decision_invalid/);
    expect(mocks.runJudgeGate).not.toHaveBeenCalled();
  });

  it('只把服务端已验证的 coverage 与 failure_signature 封入 Judge 终态结果', async () => {
    const coverage = [{ step: 'interactive save', passed: false, evidence: 'POST /save 500' }];
    mocks.runJudgeGate.mockResolvedValueOnce({
      verdict: 'FAIL',
      feedback: 'save is broken',
      judged: true,
      failure_class: 'product_failure',
      failure_signature: ['save_endpoint_500'],
      coverage,
    });
    const verified = await verifyJudgeCallbackResult({
      attempt: {
        id: '66666666-6666-4666-8666-666666666666',
        role: 'judge',
        task_bundle: { inputs: {
          task_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          candidate: { head_sha: 'f'.repeat(40) },
          evaluator_result: {
            status: 'completed',
            checks: [{ command: 'npm test', exit_code: 0, log_tail: 'passed' }],
            decision: { outcome: 'PASS', reason: 'verified' },
          },
          contract: { contract_content: 'contract', prd_content: 'prd' },
          artifacts: [],
        } },
      },
      result: {
        status: 'completed',
        summary: 'provider response',
        decision: failDecision({ reason: 'raw provider response' }),
      },
      dbPool: {},
    });

    expect(verified.decision).toEqual({
      outcome: 'FAIL',
      reason: 'save is broken',
      failure_class: 'product_failure',
      failure_signature: ['save_endpoint_500'],
      coverage,
    });
  });

  it('Runner Judge schema 保留 coverage、failure_class 与 failure_signature', () => {
    const entrypointPath = new URL(
      '../../../../../docker/cecelia-runner/entrypoint.sh',
      import.meta.url,
    );
    const source = readFileSync(entrypointPath, 'utf8');
    const functions = source.match(
      /provider_result_schema_json\(\) \{[\s\S]*?\n\}\n\nvalidate_commander_task_bundle\(\)/,
    )?.[0].replace(/\n\nvalidate_commander_task_bundle\(\)$/, '');
    expect(functions).toBeTruthy();
    const root = mkdtempSync(path.join(tmpdir(), 'judge-schema-'));
    try {
      const bundle = path.join(root, 'bundle.json');
      writeFileSync(bundle, JSON.stringify({
        task_bundle: { expected_output: 'harness-result/judge-v1', role: 'judge' },
      }));
      const schemaFile = path.join(root, 'schema.json');
      execFileSync('/bin/bash', [
        '-c', `${functions}\nschema="$(provider_result_schema_json "$1")"\npublish_provider_result_schema "$2" "$schema"`,
        '_', bundle, schemaFile,
      ], { encoding: 'utf8' });
      const schema = JSON.parse(readFileSync(schemaFile, 'utf8'));
      const decision = schema.properties.decision.anyOf[0];
      expect(decision.required).toEqual(expect.arrayContaining([
        'outcome', 'reason', 'coverage', 'failure_class', 'failure_signature',
      ]));
      expect(decision.properties.coverage.items.required)
        .toEqual(['step', 'passed', 'evidence', 'deferred']);
      expect(decision.properties.coverage.items.properties.deferred)
        .toEqual({ type: 'boolean' });
      expect(decision.properties.failure_class.anyOf[0].enum)
        .toEqual(['evidence_insufficient', 'product_failure', 'evidence_invalid']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('Runner Evaluator schema 强制人式 findings、截图与探索记录', () => {
    const entrypointPath = new URL(
      '../../../../../docker/cecelia-runner/entrypoint.sh',
      import.meta.url,
    );
    const source = readFileSync(entrypointPath, 'utf8');
    const functions = source.match(
      /provider_result_schema_json\(\) \{[\s\S]*?\n\}\n\nvalidate_commander_task_bundle\(\)/,
    )?.[0].replace(/\n\nvalidate_commander_task_bundle\(\)$/, '');
    expect(functions).toBeTruthy();
    const root = mkdtempSync(path.join(tmpdir(), 'evaluator-schema-'));
    try {
      const bundle = path.join(root, 'bundle.json');
      writeFileSync(bundle, JSON.stringify({
        task_bundle: { expected_output: 'harness-result/evaluator-v1', role: 'evaluator' },
      }));
      const schemaFile = path.join(root, 'schema.json');
      execFileSync('/bin/bash', [
        '-c', `${functions}\nschema="$(provider_result_schema_json "$1")"\npublish_provider_result_schema "$2" "$schema"`,
        '_', bundle, schemaFile,
      ], { encoding: 'utf8' });
      const schema = JSON.parse(readFileSync(schemaFile, 'utf8'));
      expect(schema.required).toEqual(expect.arrayContaining([
        'findings', 'screenshots', 'exploration_notes',
      ]));
      const finding = schema.properties.findings.items;
      expect(finding.required).toEqual([
        'id', 'severity', 'title', 'expected', 'actual',
        'reproduction_steps', 'evidence', 'screenshot_paths',
      ]);
      expect(finding.properties.severity.enum).toEqual(['P0', 'P1', 'P2', 'P3']);
      expect(schema.properties.screenshots.items).toEqual({ type: 'string' });
      expect(schema.properties.exploration_notes.items).toEqual({ type: 'string' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
