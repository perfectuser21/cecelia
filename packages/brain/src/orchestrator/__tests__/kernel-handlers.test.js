import { describe, expect, it, vi } from 'vitest';

import { createKernelHandlers } from '../kernel-handlers.js';

const taskId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const runId = '11111111-1111-4111-8111-111111111111';
const attemptId = '22222222-2222-4222-8222-222222222222';

function context(overrides = {}) {
  return {
    taskId,
    runId,
    hop: 5,
    attempt: { id: attemptId },
    bundle: { inputs: { worktree_path: '/tmp/wt', sprint_dir: 'sprints/x' } },
    observed: {
      task: { id: taskId, title: 'T', payload: { sprint_dir: 'sprints/x' } },
      run: { id: runId, initiative_id: taskId },
      pr: {
        url: 'https://github.com/o/r/pull/42',
        head_sha: 'sha-1',
        mergeStateStatus: 'CLEAN',
        merged: false,
      },
      evaluateVerdict: { verdict: 'PASS', pr_head_sha: 'sha-1' },
      callbackResult: { verdict: 'PASS', behavior_tests: [{ exit_code: 0, log_tail: 'ok' }] },
      decisionLog: [],
    },
    ...overrides,
  };
}

function deps() {
  return {
    pool: { query: vi.fn(async () => ({ rows: [], rowCount: 1 })) },
    execCmd: vi.fn(() => ''),
    attemptStore: { complete: vi.fn(async () => ({ deduped: false })) },
    judgeGate: vi.fn(async () => ({ verdict: 'PASS', feedback: null, judged: true })),
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
  it('judge 必须是真正独立判定，写 attempt 与 SHA 锚定 verdict', async () => {
    const d = deps();
    const handlers = createKernelHandlers(d);

    const result = await handlers['spawn:judge'](context());

    expect(result).toMatchObject({ status: 'DONE', detail: 'judge:PASS' });
    expect(d.judgeGate).toHaveBeenCalledWith(expect.objectContaining({
      agentVerdict: 'PASS',
      worktreePath: '/tmp/wt',
    }), expect.objectContaining({ strict: true, dbPool: d.pool }));
    expect(d.attemptStore.complete).toHaveBeenCalledWith(attemptId, expect.objectContaining({
      decision: { outcome: 'PASS', reason: 'independent judge verdict' },
    }));
    expect(d.pool.query.mock.calls.some(([sql]) => /verdict:judge/.test(sql))).toBe(true);
  });

  it('judge 优先使用 evaluator attempt result，并把 checks 适配为机械闸证据', async () => {
    const d = deps();
    const evaluatorResult = {
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

  it('merge 按 GitHub 真相处理 CLEAN / BEHIND / CONFLICTING', async () => {
    const cleanDeps = deps();
    const clean = createKernelHandlers(cleanDeps)['merge_pr'];
    await expect(clean(context())).resolves.toMatchObject({ status: 'DONE' });
    expect(cleanDeps.execCmd).toHaveBeenCalledWith(expect.stringContaining('gh pr merge'));

    const behindDeps = deps();
    const behind = createKernelHandlers(behindDeps)['merge_pr'];
    await expect(behind(context({
      observed: {
        ...context().observed,
        pr: { ...context().observed.pr, mergeStateStatus: 'BEHIND' },
      },
    }))).resolves.toMatchObject({ status: 'DONE_WITH_CONCERNS' });
    expect(behindDeps.execCmd).toHaveBeenCalledWith(expect.stringContaining('gh pr update-branch'));

    const conflictDeps = deps();
    const conflict = createKernelHandlers(conflictDeps)['merge_pr'];
    await expect(conflict(context({
      observed: {
        ...context().observed,
        pr: { ...context().observed.pr, mergeStateStatus: 'CONFLICTING' },
      },
    }))).resolves.toMatchObject({ status: 'BLOCKED' });
    expect(conflictDeps.execCmd).not.toHaveBeenCalled();
  });

  it('report 执行完整收尾链，最后才写 run/task done', async () => {
    const d = deps();
    const handlers = createKernelHandlers(d);

    const result = await handlers.report(context());

    expect(d.promote).toHaveBeenCalledOnce();
    expect(d.saveHandoff).toHaveBeenCalledOnce();
    expect(d.syncOkr).toHaveBeenCalledOnce();
    expect(d.spawnStaging).toHaveBeenCalledOnce();
    expect(d.cleanup).toHaveBeenCalledOnce();
    const sql = d.pool.query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toMatch(/UPDATE initiative_runs/);
    expect(sql).toMatch(/UPDATE tasks/);
    expect(result.status).toBe('DONE');
  });
});
