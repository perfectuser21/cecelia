import { describe, expect, it, vi } from 'vitest';

import { createMergeEffectExecutor } from '../merge-effect-executor.js';
import { canonicalContractDigest, canonicalDiffHash } from '../post-diff-risk-policy.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const HEAD_SHA = 'a'.repeat(40);
const PR_URL = 'https://github.com/perfectuser21/cecelia/pull/4400';
const FILES = Object.freeze([{
  path: 'apps/dashboard/src/App.jsx',
  additions: 12,
  deletions: 3,
}]);
const CONTRACT_CONTENT = Object.freeze({ acceptance: ['dashboard remains green'] });
const CONTRACT_DIGEST = canonicalContractDigest(CONTRACT_CONTENT);

function postDiffRisk(overrides = {}) {
  return {
    schema_version: 'kernel-post-diff-risk/v1',
    policy_version: 'kernel-post-diff-risk/v1',
    risk_level: 'low',
    human_review_required: false,
    auto_eligible: true,
    reasons: [],
    bindings: {
      task_id: TASK_ID,
      run_id: RUN_ID,
      hop: 3,
      head_sha: HEAD_SHA,
      diff_hash: canonicalDiffHash(FILES),
      contract_version: 7,
      contract_digest: CONTRACT_DIGEST,
      behavior_version: 'dashboard/v3',
      path_class: 'application',
    },
    expires_at: '2099-07-28T08:15:00.000Z',
    ...overrides,
  };
}

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
    files: FILES,
    ...overrides,
  };
}

function evidence() {
  return {
    run: { id: RUN_ID, current_task_id: TASK_ID, pr_url: PR_URL },
    task: {
      id: TASK_ID,
      payload: {
        review_required: false,
        behavior_version: 'dashboard/v3',
        risk_level: 'low',
      },
    },
    contract: {
      version: 7,
      contract_content: CONTRACT_CONTENT,
    },
    productionReceipt: {
      receipt_status: 'confirmed',
      behavior_version: 'dashboard/v3',
      contract_version: 7,
      contract_digest: CONTRACT_DIGEST,
      path_class: 'application',
      production_head_sha: 'b'.repeat(40),
      deployed_at: '2026-07-27T08:00:00.000Z',
      expires_at: '2099-07-27T08:00:00.000Z',
    },
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
          post_diff_risk: postDiffRisk(),
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

  it('recomputes the current diff risk and rejects changed diff bytes before persistence', async () => {
    const d = deps();
    d.observePullRequest = vi.fn(async () => currentPr({
      files: [{
        path: 'apps/dashboard/src/App.jsx',
        additions: 13,
        deletions: 3,
      }],
    }));
    const execute = createMergeEffectExecutor(d);

    await expect(execute({ runId: RUN_ID, taskId: TASK_ID })).rejects.toMatchObject({
      code: 'post_diff_risk_revalidation_failed',
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

  it('reconciles GitHub truth when the merge command reports an error', async () => {
    const d = deps();
    d.mergePullRequest.mockRejectedValueOnce(new Error('transport failed with secret text'));
    const execute = createMergeEffectExecutor(d);

    await expect(execute({ runId: RUN_ID, taskId: TASK_ID })).resolves.toMatchObject({
      status: 'DONE_WITH_CONCERNS',
      detail: 'merge confirmed after command error',
    });
    expect(d.store.appendReceipt).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      receipt_status: 'confirmed',
      evidence: expect.not.objectContaining({
        error: expect.stringContaining('secret text'),
      }),
    }));
  });

  it('records a bounded failed receipt when command error is confirmed unmerged', async () => {
    const d = deps();
    d.mergePullRequest.mockRejectedValueOnce(new Error('GH_TOKEN=must-not-leak'));
    d.observePullRequest = vi.fn(async () => currentPr());
    const execute = createMergeEffectExecutor(d);

    await expect(execute({ runId: RUN_ID, taskId: TASK_ID })).resolves.toMatchObject({
      status: 'BLOCKED',
      detail: 'merge effect failed and was not confirmed',
    });
    expect(d.store.appendReceipt).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      receipt_status: 'failed',
      evidence: {
        source: 'post_effect_observation',
        error_code: 'github_merge_command_failed',
        pr_url: PR_URL,
        state: 'OPEN',
      },
    }));
  });
});
