import { describe, expect, it, vi } from 'vitest';

import {
  createIndependentJudgeEquivalenceSeam,
  createKernelHandlers,
} from '../kernel-handlers.js';

const taskId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const runId = '11111111-1111-4111-8111-111111111111';
const attemptId = '22222222-2222-4222-8222-222222222222';
const evaluatorAttemptId = '33333333-3333-4333-8333-333333333333';

function context(overrides = {}) {
  return {
    taskId,
    runId,
    hop: 5,
    attempt: { id: attemptId, run_id: runId, role: 'judge' },
    bundle: { inputs: { worktree_path: '/tmp/wt', sprint_dir: 'sprints/x' } },
    observed: {
      task: { id: taskId, title: 'T', payload: { sprint_dir: 'sprints/x' } },
      run: { id: runId, initiative_id: taskId },
      pr: {
        url: 'https://github.com/o/r/pull/42',
        state: 'OPEN',
        head_sha: 'sha-1',
        mergeStateStatus: 'CLEAN',
        merged: false,
      },
      reviewApproved: false,
      evaluateVerdict: {
        attempt_id: evaluatorAttemptId,
        verdict: 'PASS',
        pr_head_sha: 'sha-1',
      },
      evaluateResult: {
        contract_version: '1.0',
        attempt_id: evaluatorAttemptId,
        status: 'completed',
        checks: [{ command: 'npm test', exit_code: 0, log_tail: 'ok' }],
        decision: { outcome: 'PASS', reason: 'verified' },
      },
      callbackResult: { verdict: 'PASS', behavior_tests: [{ exit_code: 0, log_tail: 'ok' }] },
      decisionLog: [],
    },
    ...overrides,
  };
}

function deps() {
  const transactionQuery = vi.fn(async () => ({ rows: [], rowCount: 1 }));
  const releaseTransaction = vi.fn();
  return {
    pool: {
      query: vi.fn(async () => ({ rows: [], rowCount: 1 })),
      connect: vi.fn(async () => ({ query: transactionQuery, release: releaseTransaction })),
      transactionQuery,
      releaseTransaction,
    },
    execCmd: vi.fn(() => ''),
    mergeEffect: vi.fn(async () => ({ status: 'DONE', detail: 'merge confirmed' })),
    attemptStore: {
      complete: vi.fn(async () => ({ deduped: false })),
      getById: vi.fn(async (id) => {
        if (id === attemptId) {
          return { id, run_id: runId, role: 'judge', status: 'running' };
        }
        if (id === evaluatorAttemptId) {
          return {
            id,
            run_id: runId,
            role: 'evaluator',
            status: 'completed',
            result: context().observed.evaluateResult,
          };
        }
        return null;
      }),
    },
    judgeGate: vi.fn(async () => ({ verdict: 'PASS', feedback: null, judged: true })),
    promptDir: '/host/cecelia-prompts',
    allocatePort: vi.fn(async () => 5301),
    spawnReviewPreview: vi.fn(() => ({ status: 0 })),
    notifyReview: vi.fn(async () => true),
    promote: vi.fn(async () => ({ dbWritten: true })),
    buildHandoff: vi.fn((x) => x),
    saveHandoff: vi.fn(async () => ({ dbWritten: true })),
    syncOkr: vi.fn(async () => true),
    spawnStaging: vi.fn(async () => ({ created: true })),
    cleanup: vi.fn(async () => undefined),
  };
}

describe('kernel deterministic handlers', () => {
  it('judge receives the host forensics directory and server-derived stage facts', async () => {
    const d = deps();

    await createKernelHandlers(d)['spawn:judge'](context());

    expect(d.judgeGate).toHaveBeenCalledWith(expect.objectContaining({
      promptDir: '/host/cecelia-prompts',
      stageFacts: {
        current_stage: 'independent_judge',
        pr_state: 'OPEN',
        pr_merged: false,
        head_sha: 'sha-1',
        merge_gate_approved: false,
      },
    }), expect.any(Object));
  });

  it('judge 必须是真正独立判定，写 attempt 与 SHA 锚定 verdict', async () => {
    const d = deps();
    const handlers = createKernelHandlers(d);

    const result = await handlers['spawn:judge'](context());

    expect(result).toMatchObject({ status: 'DONE', detail: 'judge:PASS' });
    expect(d.judgeGate).toHaveBeenCalledWith(expect.objectContaining({
      agentVerdict: 'PASS',
      worktreePath: '/tmp/wt',
      promptDir: '/host/cecelia-prompts',
      stageFacts: {
        current_stage: 'independent_judge',
        pr_state: 'OPEN',
        pr_merged: false,
        head_sha: 'sha-1',
        merge_gate_approved: false,
      },
    }), expect.objectContaining({ strict: true, dbPool: d.pool }));
    expect(d.attemptStore.complete).toHaveBeenCalledWith(attemptId, expect.objectContaining({
      decision: { outcome: 'PASS', reason: 'independent judge verdict' },
    }));
    expect(d.pool.query.mock.calls.some(([sql]) => /verdict:judge/.test(sql))).toBe(true);
  });

  it('judge blocks an evaluator attempt from certifying itself', async () => {
    const d = deps();
    const ctx = context({
      observed: {
        ...context().observed,
        evaluateVerdict: {
          ...context().observed.evaluateVerdict,
          attempt_id: attemptId,
        },
        evaluateResult: {
          ...context().observed.evaluateResult,
          attempt_id: attemptId,
        },
      },
    });

    await expect(createKernelHandlers(d)['spawn:judge'](ctx)).resolves.toEqual({
      status: 'BLOCKED',
      detail: 'self-certification denied',
    });
    expect(d.judgeGate).not.toHaveBeenCalled();
    expect(d.attemptStore.complete).not.toHaveBeenCalled();
  });

  it.each([
    ['missing evaluator id', (ctx, d) => {
      delete ctx.observed.evaluateVerdict.attempt_id;
      delete ctx.observed.evaluateResult.attempt_id;
    }],
    ['missing persisted evaluator attempt', (_ctx, d) => {
      d.attemptStore.getById.mockResolvedValue(null);
    }],
    ['wrong persisted evaluator role', (_ctx, d) => {
      d.attemptStore.getById.mockImplementation(async (id) => (
        id === attemptId
          ? { id, run_id: runId, role: 'judge', status: 'running' }
          : { id, run_id: runId, role: 'generator', status: 'completed' }
      ));
    }],
    ['verdict not tied to evaluator result', (ctx) => {
      ctx.observed.evaluateResult.attempt_id =
        '44444444-4444-4444-8444-444444444444';
    }],
  ])('judge fails closed for invalid Attempt authority: %s', async (
    _label,
    mutate,
  ) => {
    const d = deps();
    const ctx = structuredClone(context());
    mutate(ctx, d);

    await expect(createKernelHandlers(d)['spawn:judge'](ctx)).resolves.toEqual({
      status: 'BLOCKED',
      detail: 'independent judge Attempt authority invalid',
    });
    expect(d.judgeGate).not.toHaveBeenCalled();
    expect(d.attemptStore.complete).not.toHaveBeenCalled();
  });

  it('judge 优先使用 evaluator attempt result，并把 checks 适配为机械闸证据', async () => {
    const d = deps();
    const evaluatorResult = {
      contract_version: '1.0',
      attempt_id: evaluatorAttemptId,
      status: 'completed',
      summary: 'all checks passed',
      checks: [{ command: 'npm test', exit_code: 0, log_tail: '12 tests passed' }],
      decision: { outcome: 'PASS', reason: 'verified' },
      judgments_written: 2,
    };
    const ctx = context({
      observed: {
        ...context().observed,
        evaluateResult: evaluatorResult,
        callbackResult: null,
      },
    });

    await createKernelHandlers(d)['spawn:judge'](ctx);

    expect(d.judgeGate).toHaveBeenCalledWith(expect.objectContaining({
      agentVerdict: 'PASS',
      agentFeedback: 'verified',
      brainResult: {
        verdict: 'PASS',
        behavior_tests: evaluatorResult.checks,
        judgments_written: 2,
        summary: 'all checks passed',
      },
    }), expect.any(Object));
  });

  it('judge 没有完成独立判定时返回 NEEDS_CONTEXT，不伪造第二个 PASS', async () => {
    const d = deps();
    d.judgeGate.mockResolvedValueOnce({ verdict: 'PASS', judged: false, feedback: null });
    const handlers = createKernelHandlers(d);

    await expect(handlers['spawn:judge'](context())).resolves.toMatchObject({
      status: 'NEEDS_CONTEXT',
    });
    expect(d.pool.query.mock.calls.some(([sql]) => /verdict:judge/.test(sql))).toBe(false);
  });

  it('judge 缺 failure_class 时落 null，不得用 evaluator 分类回填', async () => {
    const d = deps();
    d.judgeGate.mockResolvedValueOnce({
      verdict: 'FAIL',
      judged: true,
      feedback: 'judge omitted classification',
    });
    const ctx = context({
      observed: {
        ...context().observed,
        evaluateVerdict: {
          ...context().observed.evaluateVerdict,
          verdict: 'FAIL',
          failure_class: 'product_failure',
        },
      },
    });

    await createKernelHandlers(d)['spawn:judge'](ctx);

    const verdictCall = d.pool.query.mock.calls.find(([sql]) => /verdict:judge/.test(sql));
    const detail = JSON.parse(verdictCall[1][3]);
    expect(detail.failure_class).toBeNull();
    expect(detail.evaluator_failure_class).toBe('product_failure');
  });

  it('human review 首次创建预览并通知', async () => {
    const d = deps();
    const result = await createKernelHandlers(d)['wait:human_review'](context());

    expect(d.allocatePort).toHaveBeenCalledWith(42, expect.any(String), undefined, d.pool);
    expect(d.spawnReviewPreview).toHaveBeenCalledWith(5301, 42);
    expect(d.notifyReview).toHaveBeenCalledWith(expect.objectContaining({
      task_id: taskId,
      preview_url: expect.stringContaining('5301'),
    }));
    expect(result.status).toBe('DONE');
  });

  it('CLEAN merge 只能调用 receipted effect executor，不能直接执行 gh', async () => {
    const cleanDeps = deps();
    const clean = createKernelHandlers(cleanDeps)['merge_pr'];
    await expect(clean(context())).resolves.toMatchObject({
      status: 'DONE',
      detail: 'merge confirmed',
    });
    expect(cleanDeps.mergeEffect).toHaveBeenCalledWith({ runId, taskId });
    expect(cleanDeps.execCmd).not.toHaveBeenCalled();
  });

  it('BEHIND / CONFLICTING fail closed without an unreceipted branch mutation', async () => {
    const behindDeps = deps();
    const behind = createKernelHandlers(behindDeps)['merge_pr'];
    await expect(behind(context({
      observed: {
        ...context().observed,
        pr: { ...context().observed.pr, mergeStateStatus: 'BEHIND' },
      },
    }))).resolves.toMatchObject({
      status: 'BLOCKED',
      detail: 'branch update requires a new generator cycle',
    });
    expect(behindDeps.mergeEffect).not.toHaveBeenCalled();
    expect(behindDeps.execCmd).not.toHaveBeenCalled();

    const conflictDeps = deps();
    const conflict = createKernelHandlers(conflictDeps)['merge_pr'];
    await expect(conflict(context({
      observed: {
        ...context().observed,
        pr: { ...context().observed.pr, mergeStateStatus: 'CONFLICTING' },
      },
    }))).resolves.toMatchObject({ status: 'BLOCKED' });
    expect(conflictDeps.mergeEffect).not.toHaveBeenCalled();
    expect(conflictDeps.execCmd).not.toHaveBeenCalled();
  });

  it('连续三次 BEHIND 已写入快照时封顶，不再 update-branch', async () => {
    const d = deps();
    const priorRebases = [1, 2, 3].map((hop) => ({
      hop,
      action: 'merge_pr',
      observed: { pr: { mergeStateStatus: 'BEHIND' } },
    }));
    const ctx = context({
      observed: {
        ...context().observed,
        pr: { ...context().observed.pr, mergeStateStatus: 'BEHIND' },
        decisionLog: priorRebases,
      },
    });

    await expect(createKernelHandlers(d).merge_pr(ctx)).resolves.toMatchObject({
      status: 'BLOCKED',
      detail: 'rebase attempt cap reached',
    });
    expect(d.execCmd).not.toHaveBeenCalled();
    expect(d.mergeEffect).not.toHaveBeenCalled();
  });

  it('report 执行完整收尾链，最后才写 run/task done', async () => {
    const d = deps();
    const handlers = createKernelHandlers(d);

    const result = await handlers.report(context());

    expect(d.promote).toHaveBeenCalledOnce();
    expect(d.saveHandoff).toHaveBeenCalledOnce();
    expect(d.syncOkr).toHaveBeenCalledOnce();
    expect(d.spawnStaging).toHaveBeenCalledOnce();
    expect(d.cleanup).toHaveBeenCalledWith(runId);
    expect(d.pool.connect).toHaveBeenCalledOnce();
    const sql = d.pool.transactionQuery.mock.calls.map(([statement]) => statement).join('\n');
    expect(d.pool.transactionQuery.mock.calls[0][0]).toBe('BEGIN');
    expect(sql).toMatch(/UPDATE initiative_runs/);
    expect(sql).toMatch(/UPDATE tasks/);
    expect(d.pool.transactionQuery.mock.calls.at(-1)[0]).toBe('COMMIT');
    expect(d.pool.releaseTransaction).toHaveBeenCalledOnce();
    expect(result.status).toBe('DONE');
  });

  it('report 事务失败时在同一 client 回滚并归还连接', async () => {
    const d = deps();
    d.pool.transactionQuery
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockRejectedValueOnce(new Error('task update failed'))
      .mockResolvedValueOnce({});

    await expect(createKernelHandlers(d).report(context())).rejects.toThrow('task update failed');

    expect(d.pool.transactionQuery.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      expect.stringMatching(/UPDATE initiative_runs/),
      expect.stringMatching(/UPDATE tasks/),
      'ROLLBACK',
    ]);
    expect(d.pool.releaseTransaction).toHaveBeenCalledOnce();
  });
});

describe('independent judge equivalence seam', () => {
  function seamFixture(scenario) {
    const d = deps();
    const effectSigner = {
      signEffectResult: vi.fn(async (effect) => ({
        schema_version: 'kernel-equivalence-effect-receipt/v1',
        ...effect,
        signature: 'test-signature',
      })),
    };
    const currentEvaluatorAttemptId = scenario === 'violation'
      ? attemptId
      : evaluatorAttemptId;
    const handlerContext = context({
      observed: {
        ...context().observed,
        evaluateVerdict: {
          ...context().observed.evaluateVerdict,
          attempt_id: currentEvaluatorAttemptId,
        },
        evaluateResult: {
          ...context().observed.evaluateResult,
          attempt_id: currentEvaluatorAttemptId,
        },
      },
    });
    const snapshots = [
      { judge_status: 'queued' },
      { judge_status: scenario === 'violation' ? 'blocked' : 'completed' },
    ];
    const resource = {
      resource_id: `eq-${attemptId}`,
      resource_ref: `equivalence-drill/${runId}/${attemptId}/judge/case`,
      handler_context: { forged: true },
      snapshot: vi.fn(async () => ({ forged: true })),
    };
    const judgeAuthority = {
      owner_service: 'kernel.evaluation.independent_judge',
      loadContext: vi.fn(async () => handlerContext),
      snapshot: vi.fn(async () => snapshots.shift()),
      loadPredecessorActors: vi.fn(async () => ({
        receipt_id: '44444444-4444-4444-8444-444444444444',
        evaluator_attempt_id:
          '55555555-5555-4555-8555-555555555555',
      })),
    };
    const cell = {
      cell_id: `KERNEL-P0-05-INDEPENDENT-EVALUATOR-JUDGE::codex::${scenario}`,
      behavior_id: 'KERNEL-P0-05-INDEPENDENT-EVALUATOR-JUDGE',
      provider: 'codex',
      scenario,
      seam_id: 'kernel.evaluation.independent_judge',
      adapter_id: 'kernel.drill.independent_evaluator_judge.v1',
    };
    const grant = {
      run_id: runId,
      attempt_id: attemptId,
      resource_id: resource.resource_id,
      resource_ref: resource.resource_ref,
    };
    return {
      d,
      effectSigner,
      judgeAuthority,
      resource,
      cell,
      grant,
      seam: createIndependentJudgeEquivalenceSeam({
        handlerDeps: d,
        effectSigner,
        judgeAuthority,
      }),
    };
  }

  it.each([
    ['normal', 'confirmed', 'independent_verdict_recorded'],
    ['violation', 'denied', 'self_certification_denied'],
    ['recovery', 'recovered', 'reassigned_evaluator_verdict_recorded'],
  ])('signs the exact %s outcome only at the judge seam', async (
    scenario,
    observedOutcome,
    effectCode,
  ) => {
    const value = seamFixture(scenario);
    const predecessor = scenario === 'recovery'
      ? { receipt_id: '44444444-4444-4444-8444-444444444444' }
      : null;

    const receipt = await value.seam.invoke({
      cell: value.cell,
      grant: value.grant,
      resource: value.resource,
      predecessor,
      signal: new AbortController().signal,
    });

    expect(receipt).toMatchObject({
      observed_outcome: observedOutcome,
      effect_code: effectCode,
      signature: 'test-signature',
    });
    expect(value.effectSigner.signEffectResult).toHaveBeenCalledWith(
      expect.objectContaining({
        service_id: value.cell.seam_id,
        cell: value.cell,
        grant: value.grant,
        resource_id: value.grant.resource_id,
        resource_ref: value.grant.resource_ref,
        observed_outcome: observedOutcome,
        effect_code: effectCode,
        predecessor,
        before_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        after_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(value.judgeAuthority.loadContext).toHaveBeenCalledOnce();
    expect(value.judgeAuthority.snapshot).toHaveBeenCalledTimes(2);
    expect(value.resource.snapshot).not.toHaveBeenCalled();
    if (scenario === 'recovery') {
      expect(value.judgeAuthority.loadPredecessorActors).toHaveBeenCalledWith(
        expect.objectContaining({
          predecessor,
          current_evaluator_attempt_id: evaluatorAttemptId,
        }),
      );
    }
  });

  it('rejects recovery when no newly assigned evaluator is proven', async () => {
    const value = seamFixture('recovery');
    value.judgeAuthority.loadPredecessorActors.mockResolvedValue({
      receipt_id: '44444444-4444-4444-8444-444444444444',
      evaluator_attempt_id: evaluatorAttemptId,
    });

    await expect(value.seam.invoke({
      cell: value.cell,
      grant: value.grant,
      resource: value.resource,
      predecessor: {
        receipt_id: '44444444-4444-4444-8444-444444444444',
      },
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      code: 'judge_recovery_reassignment_unproven',
    });
    expect(value.effectSigner.signEffectResult).not.toHaveBeenCalled();
  });

  it('requires seam-owned signer and authority ports at construction', () => {
    expect(() => createIndependentJudgeEquivalenceSeam({
      handlerDeps: deps(),
    })).toThrowError(expect.objectContaining({
      code: 'seam_effect_signer_unavailable',
    }));
    expect(() => createIndependentJudgeEquivalenceSeam({
      handlerDeps: deps(),
      effectSigner: { signEffectResult: vi.fn() },
    })).toThrowError(expect.objectContaining({
      code: 'judge_authority_port_unavailable',
    }));
  });
});
