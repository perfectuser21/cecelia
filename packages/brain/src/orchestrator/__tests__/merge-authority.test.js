import { describe, expect, it } from 'vitest';

import {
  MergeAuthorizationError,
  validateMergeAuthorizationEvidence,
} from '../merge-authority.js';
import { canonicalRequiredChecksDigest } from '../post-diff-risk-policy.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const HEAD_SHA = 'a'.repeat(40);
const BASE_SHA = '9'.repeat(40);
const DIFF_DIGEST = `sha256:${'8'.repeat(64)}`;
const PR_URL = 'https://github.com/perfectuser21/cecelia/pull/4400';
const REQUIRED_CHECKS = Object.freeze([Object.freeze({
  context: 'ci-passed',
  app_slug: 'github-actions',
  source: 'github-actions',
  run_id: '123456',
  job_id: '789012',
  head_sha: HEAD_SHA,
  conclusion: 'SUCCESS',
})]);

function riskProof(reviewRequired, overrides = {}) {
  return {
    schema_version: 'kernel-post-diff-risk/v1',
    policy_version: 'kernel-post-diff-risk/v1',
    risk_level: reviewRequired ? 'high' : 'low',
    human_review_required: reviewRequired,
    auto_eligible: !reviewRequired,
    reasons: reviewRequired ? ['caller_risk_elevated'] : [],
    bindings: {
      task_id: TASK_ID,
      run_id: RUN_ID,
      hop: 5,
      repository: 'perfectuser21/cecelia',
      head_repository: 'perfectuser21/cecelia',
      head_ref: 'cp-07280905-result-channel',
      head_sha: HEAD_SHA,
      base_repository: 'perfectuser21/cecelia',
      base_ref: 'main',
      base_sha: BASE_SHA,
      diff_hash: DIFF_DIGEST,
      required_checks_digest: canonicalRequiredChecksDigest(REQUIRED_CHECKS, HEAD_SHA),
      contract_id: '33333333-3333-4333-8333-333333333333',
      contract_version: 7,
      contract_digest: `sha256:${'c'.repeat(64)}`,
      contract_approved_at: '2026-07-28T07:00:00.000Z',
      behavior_fingerprint: `sha256:${'d'.repeat(64)}`,
      capability_fingerprint: `sha256:${'e'.repeat(64)}`,
      path_surface_digest: `sha256:${'f'.repeat(64)}`,
      path_class: 'application',
    },
    expires_at: '2099-07-28T08:15:00.000Z',
    ...overrides,
  };
}

function row(hop, action, detail = {}, extra = {}) {
  return { hop, action, detail, observed: {}, gate_verdict: null, ...extra };
}

function evidence(overrides = {}) {
  const reviewRequired = overrides.reviewRequired ?? true;
  const postDiffRisk = overrides.postDiffRisk ?? riskProof(reviewRequired);
  const reviewRequest = row(3, 'effect:human_review_requested', {
    review_reason: 'awaiting_human_review',
    post_diff_risk: {
      ...postDiffRisk,
      bindings: { ...postDiffRisk.bindings, hop: 3 },
    },
  }, {
    observed: {
      pr: { url: PR_URL, head_sha: HEAD_SHA },
      post_diff_risk: {
        ...postDiffRisk,
        bindings: { ...postDiffRisk.bindings, hop: 3 },
      },
    },
  });
  return {
    run: {
      id: RUN_ID,
      current_task_id: TASK_ID,
      pr_url: PR_URL,
    },
    task: {
      id: TASK_ID,
      payload: { review_required: reviewRequired },
    },
    contract: {
      id: '33333333-3333-4333-8333-333333333333',
      version: 7,
      status: 'approved',
      approved_at: '2026-07-28T07:00:00.000Z',
      contract_digest: `sha256:${'c'.repeat(64)}`,
    },
    pr: {
      url: PR_URL,
      repository: 'perfectuser21/cecelia',
      number: 4400,
      head_repository: 'perfectuser21/cecelia',
      head_ref: 'cp-07280905-result-channel',
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
      ...(reviewRequired
        ? [
            reviewRequest,
            row(4, 'verdict:human_review', {
              approved: true,
              review_class: 'merge_gate',
              review_request_hop: 3,
              pr_head_sha: HEAD_SHA,
              post_diff_risk: {
                ...postDiffRisk,
                bindings: { ...postDiffRisk.bindings, hop: 3 },
              },
            }),
          ]
        : []),
      row(5, 'merge_pr', { reason: 'all_gates_passed' }, {
        gate_verdict: 'allow',
        observed: {
          pr: {
            url: PR_URL,
            state: 'OPEN',
            ci: 'pass',
            merged: false,
            repository: 'perfectuser21/cecelia',
            number: 4400,
            head_repository: 'perfectuser21/cecelia',
            head_ref: 'cp-07280905-result-channel',
            head_sha: HEAD_SHA,
            base_repository: 'perfectuser21/cecelia',
            base_ref: 'main',
            base_sha: BASE_SHA,
            diff_digest: DIFF_DIGEST,
            merge_state_status: 'CLEAN',
            is_draft: false,
          },
          post_diff_risk: postDiffRisk,
        },
      }),
    ],
    postDiffRisk,
    revalidatedPostDiffRisk: postDiffRisk,
    policyVersion: 'kernel-merge/v1',
    ...overrides,
  };
}

function expectDenied(input, code) {
  expect(() => validateMergeAuthorizationEvidence(input)).toThrow(
    expect.objectContaining({
      name: 'MergeAuthorizationError',
      code,
    }),
  );
}

describe('validateMergeAuthorizationEvidence', () => {
  it('returns one exact-SHA authorization evidence record after all gates', () => {
    expect(validateMergeAuthorizationEvidence(evidence())).toEqual({
      run_id: RUN_ID,
      task_id: TASK_ID,
      repository: 'perfectuser21/cecelia',
      pr_number: 4400,
      pr_url: PR_URL,
      head_ref: 'cp-07280905-result-channel',
      head_sha: HEAD_SHA,
      base_repository: 'perfectuser21/cecelia',
      base_ref: 'main',
      base_sha: BASE_SHA,
      diff_digest: DIFF_DIGEST,
      contract_id: '33333333-3333-4333-8333-333333333333',
      contract_version: 7,
      contract_digest: `sha256:${'c'.repeat(64)}`,
      contract_approved_at: '2026-07-28T07:00:00.000Z',
      policy_version: 'kernel-merge/v1',
      review_required: true,
      evaluator_hop: 1,
      judge_hop: 2,
      human_review_hop: 4,
      merge_intent_hop: 5,
      post_diff_risk: riskProof(true),
    });
  });

  it('does not use mutable title metadata as authority', () => {
    const first = validateMergeAuthorizationEvidence(evidence({
      pr: { ...evidence().pr, title: 'feat(harness): old title' },
    }));
    const renamed = validateMergeAuthorizationEvidence(evidence({
      pr: { ...evidence().pr, title: 'fix(ci): renamed by author' },
    }));
    expect(renamed).toEqual(first);
  });

  it.each([
    ['evaluate stale', 0, 'pr_head_sha', 'b'.repeat(40), 'stale_evaluator'],
    ['judge stale', 1, 'pr_head_sha', 'b'.repeat(40), 'stale_judge'],
    ['judge fail', 1, 'verdict', 'FAIL', 'judge_not_pass'],
  ])('%s denies', (_name, rowIndex, field, value, code) => {
    const input = evidence();
    input.decisionLog[rowIndex].detail[field] = value;
    expectDenied(input, code);
  });

  it.each(['cancelled', 'failure', 'pending', 'unknown', 'skipped'])(
    'CI state %s denies',
    (ci) => {
      const input = evidence();
      input.pr.ci = ci;
      input.decisionLog.at(-1).observed.pr.ci = ci;
      expectDenied(input, 'ci_not_pass');
    },
  );

  it('required human approval must reference a same-SHA open request', () => {
    const missing = evidence();
    missing.decisionLog.splice(2, 1);
    expectDenied(missing, 'human_review_request_missing');

    const stale = evidence();
    stale.decisionLog[2].observed.pr.head_sha = 'b'.repeat(40);
    expectDenied(stale, 'stale_human_review');
  });

  it('a new PR head invalidates every old verdict and merge intent', () => {
    const newHead = 'c'.repeat(40);
    const input = evidence({
      pr: {
        ...evidence().pr,
        head_sha: newHead,
        required_checks: REQUIRED_CHECKS.map((check) => ({
          ...check,
          head_sha: newHead,
        })),
      },
    });
    expectDenied(input, 'stale_evaluator');
  });

  it.each([
    ['retargeted base', { base_ref: 'release' }, 'stale_merge_intent'],
    ['advanced base', { base_sha: '7'.repeat(40) }, 'stale_merge_intent'],
    ['changed exact diff', { diff_digest: `sha256:${'7'.repeat(64)}` }, 'stale_merge_intent'],
    ['draft', { is_draft: true }, 'pr_not_ready'],
    ['unstable merge state', { merge_state_status: 'UNSTABLE' }, 'pr_not_clean'],
    ['missing required evidence', { required_checks: [] }, 'ci_authority_invalid'],
  ])('rejects %s at the merge boundary', (_label, patch, code) => {
    const input = evidence({ pr: { ...evidence().pr, ...patch } });
    expectDenied(input, code);
  });

  it('revalidates that the immutable approved contract is still approved', () => {
    expectDenied(evidence({
      contract: { ...evidence().contract, status: 'superseded' },
    }), 'contract_not_approved');
  });

  it.each([
    ['diff hash', {
      bindings: {
        ...riskProof(true).bindings,
        diff_hash: `sha256:${'d'.repeat(64)}`,
      },
    }],
    ['contract digest', {
      bindings: {
        ...riskProof(true).bindings,
        contract_digest: `sha256:${'d'.repeat(64)}`,
      },
    }],
    ['policy version', { policy_version: 'kernel-post-diff-risk/v2' }],
    ['task', {
      bindings: {
        ...riskProof(true).bindings,
        task_id: '33333333-3333-4333-8333-333333333333',
      },
    }],
    ['run', {
      bindings: {
        ...riskProof(true).bindings,
        run_id: '33333333-3333-4333-8333-333333333333',
      },
    }],
    ['hop', {
      bindings: { ...riskProof(true).bindings, hop: 6 },
    }],
  ])('rejects a stale %s post-diff authority at the merge boundary', (
    _label,
    patch,
  ) => {
    const input = evidence();
    input.postDiffRisk = {
      ...input.postDiffRisk,
      ...patch,
    };
    expectDenied(input, 'stale_post_diff_risk');
  });

  it('rejects missing and expired risk authority', () => {
    expectDenied(evidence({ postDiffRisk: null }), 'post_diff_risk_missing');
    expectDenied(evidence({
      postDiffRisk: riskProof(true, {
        expires_at: '2020-01-01T00:00:00.000Z',
      }),
    }), 'post_diff_risk_expired');
  });

  it('rejects a merge-time revalidation that no longer matches the logged diff proof', () => {
    expectDenied(evidence({
      revalidatedPostDiffRisk: riskProof(true, {
        bindings: {
          ...riskProof(true).bindings,
          diff_hash: `sha256:${'d'.repeat(64)}`,
        },
      }),
    }), 'stale_post_diff_risk');
  });

  it('missing or denied merge intent cannot issue an authorization', () => {
    const missing = evidence();
    missing.decisionLog.pop();
    expectDenied(missing, 'merge_intent_missing');

    const denied = evidence();
    denied.decisionLog.at(-1).gate_verdict = 'deny:review_not_approved';
    expectDenied(denied, 'merge_intent_missing');
  });

  it('unknown/conflicting ownership axes fail closed', () => {
    expectDenied(evidence({
      run: { ...evidence().run, pr_url: 'https://github.com/perfectuser21/cecelia/pull/9999' },
    }), 'run_pr_mismatch');
    expectDenied(evidence({
      run: { ...evidence().run, current_task_id: '33333333-3333-4333-8333-333333333333' },
    }), 'run_task_mismatch');
  });

  it('exports a typed error for callers to preserve denial semantics', () => {
    const error = new MergeAuthorizationError('stale_judge');
    expect(error).toMatchObject({
      name: 'MergeAuthorizationError',
      code: 'stale_judge',
      message: 'stale_judge',
    });
  });
});
