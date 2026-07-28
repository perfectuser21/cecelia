import { describe, expect, it, vi } from 'vitest';
import {
  createHumanReviewEquivalenceSeam,
} from '../merge-authority.js';
import {
  assessPostDiffRisk,
  canonicalContractDigest,
} from '../post-diff-risk-policy.js';
import { sha256Canonical } from '../../lib/kernel-equivalence-receipts.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const GRANT_ID = '33333333-3333-4333-8333-333333333333';
const RESOURCE_ID = '44444444-4444-4444-8444-444444444444';
const ASSESSMENT_ID = '55555555-5555-4555-8555-555555555555';
const HEAD_SHA = 'a'.repeat(40);
const BASE_SHA = '9'.repeat(40);
const DIFF_DIGEST = `sha256:${'8'.repeat(64)}`;
const PR_URL = 'https://github.com/perfectuser21/cecelia/pull/4400';
const SEAM_ID = 'kernel.merge.human_review_authority';
const ADAPTER_ID = 'kernel.drill.human_review_authority.v1';
const CONTRACT_ID = '99999999-9999-4999-8999-999999999999';
const CONTRACT_CONTENT = Object.freeze({ acceptance: ['merge remains safe'] });
const CONTRACT_DIGEST = canonicalContractDigest(CONTRACT_CONTENT);
const REQUIRED_CHECKS = Object.freeze([Object.freeze({
  context: 'ci-passed',
  app_slug: 'github-actions',
  source: 'github-actions',
  run_id: '123456',
  job_id: '789012',
  head_sha: HEAD_SHA,
  conclusion: 'SUCCESS',
})]);
const FILES = Object.freeze([Object.freeze({
  path: 'apps/dashboard/src/App.jsx',
  previous_path: null,
  status: 'modified',
  blob_sha: '7'.repeat(40),
  patch_digest: `sha256:${'6'.repeat(64)}`,
  additions: 12,
  deletions: 3,
})]);

function row(hop, action, detail = {}, extra = {}) {
  return { hop, action, detail, observed: {}, gate_verdict: null, ...extra };
}

function mergeEvidence({ staleReview = false } = {}) {
  const contract = {
    id: CONTRACT_ID,
    version: 7,
    status: 'approved',
    approved_at: '2026-07-27T07:00:00.000Z',
    contract_content: CONTRACT_CONTENT,
    contract_digest: CONTRACT_DIGEST,
  };
  const pr = {
    url: PR_URL,
    repository: 'perfectuser21/cecelia',
    number: 4400,
    head_repository: 'perfectuser21/cecelia',
    head_ref: 'cp-equivalence-review',
    head_sha: HEAD_SHA,
    base_repository: 'perfectuser21/cecelia',
    base_ref: 'main',
    base_sha: BASE_SHA,
    diff_digest: DIFF_DIGEST,
    required_checks: REQUIRED_CHECKS,
    files: FILES,
    changed_paths: FILES.map(({ path }) => path).sort(),
    state: 'OPEN',
    is_draft: false,
    merge_state_status: 'CLEAN',
    ci: 'pass',
    merged: false,
  };
  const postDiffRisk = assessPostDiffRisk({
    taskId: TASK_ID,
    runId: RUN_ID,
    hop: 5,
    repository: pr.repository,
    headRepository: pr.head_repository,
    headRef: pr.head_ref,
    headSha: pr.head_sha,
    baseRepository: pr.base_repository,
    baseRef: pr.base_ref,
    baseSha: pr.base_sha,
    diffDigest: pr.diff_digest,
    requiredChecks: pr.required_checks,
    files: pr.files,
    contract: {
      id: contract.id,
      version: contract.version,
      status: contract.status,
      approved_at: contract.approved_at,
      digest: contract.contract_digest,
    },
    productionReceipt: null,
    callerRisk: 'high',
    evidence: { ci: 'pass', evaluator: 'PASS', judge: 'PASS' },
    now: Date.now,
  });
  const reviewRisk = {
    ...postDiffRisk,
    bindings: { ...postDiffRisk.bindings, hop: 3 },
  };
  return {
    run: {
      id: RUN_ID,
      current_task_id: TASK_ID,
      pr_url: PR_URL,
    },
    task: {
      id: TASK_ID,
      payload: { review_required: true },
    },
    pr,
    contract,
    postDiffRisk,
    revalidatedPostDiffRisk: postDiffRisk,
    reviewPolicy: {
      assessment_id: ASSESSMENT_ID,
      policy_version: 'kernel-merge/v1',
      changed_paths: pr.changed_paths,
      risk_tier: 'low',
      risk_reasons: ['low_risk_paths', 'first_kernel_release'],
      first_kernel_release: true,
      payload_review_required: true,
      review_required: true,
    },
    decisionLog: [
      row(1, 'verdict:evaluate', {
        verdict: 'PASS',
        pr_head_sha: HEAD_SHA,
      }),
      row(2, 'verdict:judge', {
        verdict: 'PASS',
        pr_head_sha: HEAD_SHA,
      }),
      row(3, 'effect:human_review_requested', {
        review_reason: 'awaiting_human_review',
        post_diff_risk: reviewRisk,
      }, {
        observed: {
          pr: { url: PR_URL, head_sha: HEAD_SHA },
          post_diff_risk: reviewRisk,
        },
      }),
      row(4, 'verdict:human_review', {
        approved: true,
        review_class: 'merge_gate',
        review_request_hop: 3,
        pr_head_sha: staleReview ? 'b'.repeat(40) : HEAD_SHA,
        post_diff_risk: reviewRisk,
      }),
      row(5, 'merge_pr', { reason: 'all_gates_passed' }, {
        gate_verdict: 'allow',
        observed: {
          pr: {
            url: PR_URL,
            base_repository: pr.base_repository,
            base_ref: pr.base_ref,
            base_sha: pr.base_sha,
            diff_digest: pr.diff_digest,
            state: 'OPEN',
            ci: 'pass',
            merged: false,
            head_sha: HEAD_SHA,
          },
          post_diff_risk: postDiffRisk,
        },
      }),
    ],
    policyVersion: 'kernel-merge/v1',
  };
}

function targetCell(scenario = 'normal') {
  return {
    cell_id: `KERNEL-P0-06-HUMAN-REVIEW-AUTHORITY::codex::${scenario}`,
    behavior_id: 'KERNEL-P0-06-HUMAN-REVIEW-AUTHORITY',
    provider: 'codex',
    scenario,
    seam_id: SEAM_ID,
    adapter_id: ADAPTER_ID,
  };
}

function targetGrant() {
  return {
    grant_id: GRANT_ID,
    nonce: '55555555-5555-4555-8555-555555555555',
    run_id: RUN_ID,
    attempt_id: '66666666-6666-4666-8666-666666666666',
    resource_id: RESOURCE_ID,
    resource_ref: `equivalence-drill/${RUN_ID}/review`,
    seam_id: SEAM_ID,
    adapter_id: ADAPTER_ID,
  };
}

function predecessor() {
  return Object.freeze({
    grant: Object.freeze({ ...targetGrant() }),
    receipt: Object.freeze({
      schema_version: 'kernel-equivalence-effect-receipt/v1',
      receipt_id: '77777777-7777-4777-8777-777777777777',
      cell_id: 'KERNEL-P0-06-HUMAN-REVIEW-AUTHORITY::codex::violation',
      observed_outcome: 'denied',
      effect_code: 'stale_human_approval_denied',
    }),
  });
}

function fixture(scenario = 'normal') {
  const snapshots = [
    { pr_head_sha: HEAD_SHA, approved_head_sha: scenario === 'normal' ? null : 'b'.repeat(40) },
    {
      pr_head_sha: HEAD_SHA,
      approved_head_sha: scenario === 'violation' ? 'b'.repeat(40) : HEAD_SHA,
    },
  ];
  const reviewAuthority = {
    owner_service: SEAM_ID,
    loadEvidence: vi.fn(async () => mergeEvidence({
      staleReview: scenario === 'violation',
    })),
    snapshot: vi.fn(async () => snapshots.shift()),
    confirmDenial: vi.fn(async ({ error }) => error?.code === 'stale_human_review'),
    confirmRenewal: vi.fn(async ({ proof, predecessor: previous }) => (
      proof.head_sha === HEAD_SHA
      && previous?.receipt?.effect_code === 'stale_human_approval_denied'
    )),
    cancel: vi.fn(async () => ({ confirmed: true })),
    cleanup: vi.fn(async () => ({ confirmed: true })),
  };
  const effectSigner = {
    signEffectResult: vi.fn(async (input) => ({
      schema_version: 'kernel-equivalence-effect-receipt/v1',
      receipt_id: '88888888-8888-4888-8888-888888888888',
      ...input.observation,
      signature: 'signed',
    })),
  };
  return {
    reviewAuthority,
    effectSigner,
    seam: createHumanReviewEquivalenceSeam({
      reviewAuthority,
      effectSigner,
    }),
  };
}

describe('Kernel human-review authority equivalence seam', () => {
  it.each([
    ['normal', 'confirmed', 'exact_sha_human_approval_accepted'],
    ['violation', 'denied', 'stale_human_approval_denied'],
    ['recovery', 'recovered', 'renewed_human_approval_accepted'],
  ])('executes exact merge authority for %s', async (
    scenario,
    observedOutcome,
    effectCode,
  ) => {
    const value = fixture(scenario);
    const cell = targetCell(scenario);
    const grant = targetGrant();
    const previous = scenario === 'recovery' ? predecessor() : null;

    const result = await value.seam.invoke({
      cell,
      grant,
      resource: {
        resource_id: RESOURCE_ID,
        resource_ref: grant.resource_ref,
        evidence: mergeEvidence({ staleReview: false }),
      },
      predecessor: previous,
      signal: AbortSignal.timeout(1_000),
    });

    expect(result).toMatchObject({ observed_outcome: observedOutcome, effect_code: effectCode });
    expect(value.reviewAuthority.loadEvidence).toHaveBeenCalledOnce();
    expect(value.reviewAuthority.snapshot).toHaveBeenCalledTimes(2);
    expect(value.effectSigner.signEffectResult).toHaveBeenCalledWith({
      cell,
      grant,
      observation: {
        observed_outcome: observedOutcome,
        effect_code: effectCode,
        before_hash: sha256Canonical({
          pr_head_sha: HEAD_SHA,
          approved_head_sha: scenario === 'normal' ? null : 'b'.repeat(40),
        }),
        after_hash: sha256Canonical({
          pr_head_sha: HEAD_SHA,
          approved_head_sha: scenario === 'violation' ? 'b'.repeat(40) : HEAD_SHA,
        }),
      },
      predecessor: previous,
    });
  });

  it('does not sign an unconfirmed stale-review denial', async () => {
    const value = fixture('violation');
    value.reviewAuthority.confirmDenial.mockResolvedValue(false);
    await expect(value.seam.invoke({
      cell: targetCell('violation'),
      grant: targetGrant(),
      resource: {
        resource_id: RESOURCE_ID,
        resource_ref: targetGrant().resource_ref,
      },
      signal: AbortSignal.timeout(1_000),
    })).rejects.toMatchObject({ code: 'human_review_denial_unconfirmed' });
    expect(value.effectSigner.signEffectResult).not.toHaveBeenCalled();
  });

  it('requires a DB-owned review authority and exact isolated resource', async () => {
    const value = fixture();
    expect(() => createHumanReviewEquivalenceSeam({
      effectSigner: value.effectSigner,
      reviewAuthority: { ...value.reviewAuthority, owner_service: 'caller' },
    })).toThrow('human_review_equivalence_authority_unavailable');

    await expect(value.seam.invoke({
      cell: targetCell(),
      grant: targetGrant(),
      resource: {
        resource_id: RESOURCE_ID,
        resource_ref: 'equivalence-drill/other',
      },
      signal: AbortSignal.timeout(1_000),
    })).rejects.toMatchObject({ code: 'human_review_equivalence_resource_invalid' });
    expect(value.reviewAuthority.loadEvidence).not.toHaveBeenCalled();
  });
});
