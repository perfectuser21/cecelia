import { describe, expect, it, vi } from 'vitest';

import { createMergeEffectExecutor } from '../merge-effect-executor.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const HEAD_SHA = 'a'.repeat(40);
const PR_URL = 'https://github.com/perfectuser21/cecelia/pull/4400';

function currentPr(overrides = {}) {
  return {
    url: PR_URL,
    repository: 'perfectuser21/cecelia',
    number: 4400,
    head_ref: 'cp-kernel-safe-merge',
    head_sha: HEAD_SHA,
    state: 'OPEN',
    ci: 'pass',
    merged: false,
    ...overrides,
  };
}

function evidence() {
  return {
    run: { id: RUN_ID, current_task_id: TASK_ID, pr_url: PR_URL },
    task: { id: TASK_ID, payload: { review_required: false } },
    decisionLog: [
      {
        hop: 1,
        action: 'verdict:evaluate',
        detail: { verdict: 'PASS', pr_head_sha: HEAD_SHA },
      },
      {
        hop: 2,
        action: 'verdict:judge',
        detail: { verdict: 'PASS', pr_head_sha: HEAD_SHA },
      },
      {
        hop: 3,
        action: 'merge_pr',
        gate_verdict: 'allow',
        observed: {
          pr: {
            url: PR_URL,
            head_sha: HEAD_SHA,
            state: 'OPEN',
            ci: 'pass',
            merged: false,
          },
        },
      },
    ],
  };
}

function deps(overrides = {}) {
  const order = [];
  const store = {
    withRunLock: vi.fn(async (_runId, fn) => fn({})),
    loadEvidence: vi.fn(async () => evidence()),
    findIntent: vi.fn(async () => null),
    createAuthorizationIntent: vi.fn(async () => {
      order.push('intent');
      return {
        intent_id: 'intent-1',
        requested_head_sha: HEAD_SHA,
        confirmed_receipt: null,
      };
    }),
    appendReceipt: vi.fn(async (_client, receipt) => {
      order.push(`receipt:${receipt.receipt_status}`);
      return receipt;
    }),
  };
  const observePullRequest = vi.fn()
    .mockResolvedValueOnce(currentPr())
    .mockResolvedValueOnce(currentPr({ state: 'MERGED', merged: true }));
  const mergePullRequest = vi.fn(async () => {
    order.push('effect');
  });
  return {
    order,
    store,
    observePullRequest,
    mergePullRequest,
    ...overrides,
  };
}

describe('merge effect executor', () => {
  it('persists exact-SHA authorization and intent before the GitHub effect', async () => {
    const d = deps();
    const execute = createMergeEffectExecutor(d);

    await expect(execute({ runId: RUN_ID, taskId: TASK_ID })).resolves.toMatchObject({
      status: 'DONE',
      detail: 'merge confirmed',
    });

    expect(d.order).toEqual(['intent', 'effect', 'receipt:confirmed']);
    expect(d.mergePullRequest).toHaveBeenCalledWith({
      pr_url: PR_URL,
      expected_head_sha: HEAD_SHA,
      method: 'squash',
    });
  });

  it('recovers a crash-after-merge by observing and receipting without reissuing', async () => {
    const d = deps();
    d.store.findIntent.mockResolvedValueOnce({
      intent_id: 'intent-1',
      requested_head_sha: HEAD_SHA,
      confirmed_receipt: null,
    });
    d.observePullRequest = vi.fn(async () => currentPr({ state: 'MERGED', merged: true }));
    const execute = createMergeEffectExecutor(d);

    await expect(execute({ runId: RUN_ID, taskId: TASK_ID })).resolves.toMatchObject({
      status: 'DONE',
      detail: 'merge confirmed by recovery',
    });
    expect(d.mergePullRequest).not.toHaveBeenCalled();
    expect(d.store.createAuthorizationIntent).not.toHaveBeenCalled();
    expect(d.store.appendReceipt).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      receipt_status: 'confirmed',
      observed_head_sha: HEAD_SHA,
    }));
  });

  it('does not create authority when current GitHub head differs from signed evidence', async () => {
    const d = deps();
    d.observePullRequest = vi.fn(async () => currentPr({ head_sha: 'b'.repeat(40) }));
    const execute = createMergeEffectExecutor(d);

    await expect(execute({ runId: RUN_ID, taskId: TASK_ID })).rejects.toMatchObject({
      code: 'stale_evaluator',
    });
    expect(d.store.createAuthorizationIntent).not.toHaveBeenCalled();
    expect(d.mergePullRequest).not.toHaveBeenCalled();
  });

  it('does not report success until a post-effect observation confirms merged', async () => {
    const d = deps();
    d.observePullRequest = vi.fn(async () => currentPr());
    const execute = createMergeEffectExecutor(d);

    await expect(execute({ runId: RUN_ID, taskId: TASK_ID })).resolves.toMatchObject({
      status: 'BLOCKED',
      detail: 'merge effect not confirmed',
    });
    expect(d.store.appendReceipt).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      receipt_status: 'observed_not_merged',
      merged: false,
    }));
  });
});
