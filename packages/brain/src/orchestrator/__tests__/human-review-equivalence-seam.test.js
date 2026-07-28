import { describe, expect, it, vi } from 'vitest';
import {
  createHumanReviewEquivalenceSeam,
} from '../merge-authority.js';
import { sha256Canonical } from '../../lib/kernel-equivalence-receipts.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const GRANT_ID = '33333333-3333-4333-8333-333333333333';
const RESOURCE_ID = '44444444-4444-4444-8444-444444444444';
const HEAD_SHA = 'a'.repeat(40);
const PR_URL = 'https://github.com/perfectuser21/cecelia/pull/4400';
const SEAM_ID = 'kernel.merge.human_review_authority';
const ADAPTER_ID = 'kernel.drill.human_review_authority.v1';

function row(hop, action, detail = {}, extra = {}) {
  return { hop, action, detail, observed: {}, gate_verdict: null, ...extra };
}

function mergeEvidence({ staleReview = false } = {}) {
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
    pr: {
      url: PR_URL,
      repository: 'perfectuser21/cecelia',
      number: 4400,
      head_ref: 'cp-equivalence-review',
      head_sha: HEAD_SHA,
      state: 'OPEN',
      ci: 'pass',
      merged: false,
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
      }, {
        observed: { pr: { url: PR_URL, head_sha: HEAD_SHA } },
      }),
      row(4, 'verdict:human_review', {
        approved: true,
        review_class: 'merge_gate',
        review_request_hop: 3,
        pr_head_sha: staleReview ? 'b'.repeat(40) : HEAD_SHA,
      }),
      row(5, 'merge_pr', { reason: 'all_gates_passed' }, {
        gate_verdict: 'allow',
        observed: {
          pr: {
            url: PR_URL,
            state: 'OPEN',
            ci: 'pass',
            merged: false,
            head_sha: HEAD_SHA,
          },
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
