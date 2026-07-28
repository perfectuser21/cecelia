import { describe, expect, it } from 'vitest';

import {
  MergeAuthorizationError,
  validateMergeAuthorizationEvidence,
} from '../merge-authority.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const HEAD_SHA = 'a'.repeat(40);
const PR_URL = 'https://github.com/perfectuser21/cecelia/pull/4400';

function row(hop, action, detail = {}, extra = {}) {
  return { hop, action, detail, observed: {}, gate_verdict: null, ...extra };
}

function evidence(overrides = {}) {
  const reviewRequired = overrides.reviewRequired ?? true;
  const reviewRequest = row(3, 'effect:human_review_requested', {
    review_reason: 'awaiting_human_review',
  }, {
    observed: { pr: { url: PR_URL, head_sha: HEAD_SHA } },
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
    pr: {
      url: PR_URL,
      repository: 'perfectuser21/cecelia',
      number: 4400,
      head_ref: 'cp-07280905-result-channel',
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
      ...(reviewRequired
        ? [
            reviewRequest,
            row(4, 'verdict:human_review', {
              approved: true,
              review_class: 'merge_gate',
              review_request_hop: 3,
              pr_head_sha: HEAD_SHA,
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
            head_sha: HEAD_SHA,
          },
        },
      }),
    ],
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
      policy_version: 'kernel-merge/v1',
      review_required: true,
      evaluator_hop: 1,
      judge_hop: 2,
      human_review_hop: 4,
      merge_intent_hop: 5,
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
    const input = evidence({
      pr: { ...evidence().pr, head_sha: 'c'.repeat(40) },
    });
    expectDenied(input, 'stale_evaluator');
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
