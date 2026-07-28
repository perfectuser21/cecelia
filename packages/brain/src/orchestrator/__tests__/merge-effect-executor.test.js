import { describe, expect, it, vi } from 'vitest';

import { createMergeEffectExecutor } from '../merge-effect-executor.js';
import {
  assessPostDiffRisk,
  canonicalContractDigest,
  canonicalProductionReceiptDigest,
  deriveBehaviorAuthority,
} from '../post-diff-risk-policy.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const ASSESSMENT_ID = '33333333-3333-4333-8333-333333333333';
const HEAD_SHA = 'a'.repeat(40);
const BASE_SHA = '9'.repeat(40);
const DIFF_DIGEST = `sha256:${'8'.repeat(64)}`;
const PR_URL = 'https://github.com/perfectuser21/cecelia/pull/4400';
const FILES = Object.freeze([{
  path: 'apps/dashboard/src/App.jsx',
  previous_path: null,
  status: 'modified',
  blob_sha: '7'.repeat(40),
  patch_digest: `sha256:${'6'.repeat(64)}`,
  additions: 12,
  deletions: 3,
}]);
const CONTRACT_CONTENT = Object.freeze({ acceptance: ['dashboard remains green'] });
const CONTRACT_DIGEST = canonicalContractDigest(CONTRACT_CONTENT);
const CONTRACT_ID = '55555555-5555-4555-8555-555555555555';
const CONTRACT_APPROVED_AT = '2026-07-27T07:00:00.000Z';
const TEST_NOW = Date.parse('2026-07-28T08:05:00.000Z');
const REQUIRED_CHECKS = Object.freeze([Object.freeze({
  context: 'ci-passed',
  app_slug: 'github-actions',
  source: 'github-actions',
  run_id: '123456',
  job_id: '789012',
  head_sha: HEAD_SHA,
  conclusion: 'SUCCESS',
})]);

function productionReceipt() {
  const behavior = deriveBehaviorAuthority({
    repository: 'perfectuser21/cecelia',
    contract: { version: 7, digest: CONTRACT_DIGEST },
    files: FILES,
  });
  const value = {
    receipt_status: 'confirmed',
    release_authority_valid: true,
    repository: 'perfectuser21/cecelia',
    behavior_fingerprint: behavior.behavior_fingerprint,
    capability_fingerprint: behavior.capability_fingerprint,
    path_surface_digest: behavior.path_surface_digest,
    contract_version: 7,
    contract_digest: CONTRACT_DIGEST,
    path_class: 'application',
    artifact_digest: `sha256:${'5'.repeat(64)}`,
    release_run_id: '33333333-3333-4333-8333-333333333333',
    release_effect_receipt_id: '44444444-4444-4444-8444-444444444444',
    issuer: 'kernel-release-controller/v1',
    production_head_sha: 'b'.repeat(40),
    deployed_at: '2026-07-27T08:00:00.000Z',
    expires_at: '2026-08-03T08:00:00.000Z',
  };
  return { ...value, receipt_digest: canonicalProductionReceiptDigest(value) };
}

function postDiffRisk(overrides = {}) {
  const proof = assessPostDiffRisk({
    taskId: TASK_ID,
    runId: RUN_ID,
    hop: 3,
    repository: 'perfectuser21/cecelia',
    headRepository: 'perfectuser21/cecelia',
    headRef: 'cp-kernel-safe-merge',
    headSha: HEAD_SHA,
    baseRepository: 'perfectuser21/cecelia',
    baseRef: 'main',
    baseSha: BASE_SHA,
    diffDigest: DIFF_DIGEST,
    requiredChecks: REQUIRED_CHECKS,
    files: FILES,
    contract: {
      id: CONTRACT_ID,
      version: 7,
      status: 'approved',
      approved_at: CONTRACT_APPROVED_AT,
      digest: CONTRACT_DIGEST,
    },
    productionReceipt: productionReceipt(),
    callerRisk: 'low',
    evidence: { ci: 'pass', evaluator: 'PASS', judge: 'PASS' },
    now: () => Date.parse('2026-07-28T08:00:00.000Z'),
  });
  return { ...proof, ...overrides };
}

function currentPr(overrides = {}) {
  return {
    url: PR_URL,
    repository: 'perfectuser21/cecelia',
    number: 4400,
    head_repository: 'perfectuser21/cecelia',
    head_ref: 'cp-kernel-safe-merge',
    head_sha: HEAD_SHA,
    base_repository: 'perfectuser21/cecelia',
    base_ref: 'main',
    base_sha: BASE_SHA,
    diff_digest: DIFF_DIGEST,
    state: 'OPEN',
    is_draft: false,
    merge_state_status: 'CLEAN',
    ci: 'pass',
    required_checks: REQUIRED_CHECKS,
    merged: false,
    files: FILES,
    changed_paths: ['apps/dashboard/src/App.jsx'],
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
      id: CONTRACT_ID,
      version: 7,
      status: 'approved',
      approved_at: CONTRACT_APPROVED_AT,
      contract_content: CONTRACT_CONTENT,
    },
    productionReceipt: productionReceipt(),
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
            repository: 'perfectuser21/cecelia',
            number: 4400,
            head_repository: 'perfectuser21/cecelia',
            head_ref: 'cp-kernel-safe-merge',
            head_sha: HEAD_SHA,
            base_repository: 'perfectuser21/cecelia',
            base_ref: 'main',
            base_sha: BASE_SHA,
            diff_digest: DIFF_DIGEST,
            state: 'OPEN',
            is_draft: false,
            merge_state_status: 'CLEAN',
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
    assessReviewPolicy: vi.fn(async () => ({
      assessment_id: ASSESSMENT_ID,
      policy_version: 'kernel-merge/v1',
      changed_paths: ['apps/dashboard/src/App.jsx'],
      risk_tier: 'low',
      risk_reasons: ['low_risk_paths'],
      first_kernel_release: false,
      payload_review_required: false,
      review_required: false,
    })),
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
    now: () => TEST_NOW,
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
    expect(d.store.assessReviewPolicy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        runId: RUN_ID,
        taskId: TASK_ID,
        currentPr: expect.objectContaining({ head_sha: HEAD_SHA }),
        policyVersion: 'kernel-merge/v1',
      }),
    );
    expect(d.store.assessReviewPolicy).toHaveBeenCalledTimes(2);
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
    const changedHead = 'b'.repeat(40);
    d.observePullRequest = vi.fn(async () => currentPr({
      head_sha: changedHead,
      required_checks: REQUIRED_CHECKS.map((check) => ({
        ...check,
        head_sha: changedHead,
      })),
    }));
    const execute = createMergeEffectExecutor(d);

    await expect(execute({ runId: RUN_ID, taskId: TASK_ID })).rejects.toMatchObject({
      code: 'stale_evaluator',
    });
    expect(d.store.createAuthorizationIntent).not.toHaveBeenCalled();
    expect(d.mergePullRequest).not.toHaveBeenCalled();
  });

  it('rejects an expired post-diff risk proof before creating merge authority', async () => {
    const d = deps({
      now: () => Date.parse('2026-07-28T08:16:00.000Z'),
    });
    const execute = createMergeEffectExecutor(d);

    await expect(execute({ runId: RUN_ID, taskId: TASK_ID })).rejects.toMatchObject({
      code: 'post_diff_risk_expired',
    });
    expect(d.store.createAuthorizationIntent).not.toHaveBeenCalled();
    expect(d.mergePullRequest).not.toHaveBeenCalled();
  });

  it('recomputes the current diff risk and rejects changed diff bytes before persistence', async () => {
    const d = deps();
    d.observePullRequest = vi.fn(async () => currentPr({
      diff_digest: `sha256:${'4'.repeat(64)}`,
      files: [{
        ...FILES[0],
        additions: 13,
        deletions: 3,
      }],
    }));
    const execute = createMergeEffectExecutor(d);

    await expect(execute({ runId: RUN_ID, taskId: TASK_ID })).rejects.toMatchObject({
      code: 'stale_merge_intent',
    });
    expect(d.store.createAuthorizationIntent).not.toHaveBeenCalled();
    expect(d.mergePullRequest).not.toHaveBeenCalled();
  });

  it('re-observes base and required checks immediately before the merge effect', async () => {
    const d = deps();
    d.observePullRequest = vi.fn()
      .mockResolvedValueOnce(currentPr())
      .mockResolvedValueOnce(currentPr({ base_sha: '4'.repeat(40) }));
    const execute = createMergeEffectExecutor(d);

    await expect(execute({ runId: RUN_ID, taskId: TASK_ID })).rejects.toMatchObject({
      code: expect.stringMatching(/stale|risk|base/),
    });
    expect(d.mergePullRequest).not.toHaveBeenCalled();
  });

  it('re-loads the approved contract immediately before the merge effect', async () => {
    const d = deps();
    d.store.loadEvidence
      .mockResolvedValueOnce(evidence())
      .mockResolvedValueOnce({
        ...evidence(),
        contract: { ...evidence().contract, status: 'superseded' },
      });
    const execute = createMergeEffectExecutor(d);

    await expect(execute({ runId: RUN_ID, taskId: TASK_ID })).rejects.toMatchObject({
      code: 'contract_not_approved',
    });
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
