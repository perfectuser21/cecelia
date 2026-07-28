'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const {
  canonicalJson,
  finalizeRoleResult,
} = require('./result-channel-finalizer.cjs');

const TASK_ID = '33333333-3333-4333-8333-333333333333';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const SHA = '0123456789abcdef0123456789abcdef01234567';
const DIGEST = `sha256:${'a'.repeat(64)}`;
const RUBRIC = {
  dod_machineability: 10,
  scope_match_prd: 9,
  test_is_red: 8,
  internal_consistency: 10,
  risk_registered: 9,
  verification_oracle_completeness: 8,
  ci_workflow_alignment: 10,
};

function providerResult(overrides = {}) {
  return {
    contract_version: '1.0',
    attempt_id: ATTEMPT_ID,
    status: 'completed',
    summary: 'Role completed with bounded evidence.',
    artifacts: [],
    checks: [],
    decision: null,
    error: null,
    provider_metadata: {
      provider: 'codex',
      session_id: 'thread-42',
    },
    ...overrides,
  };
}

function input(role, rawEnvelope, verifierEnvelope, overrides = {}) {
  return {
    expectedOutput: `harness-result/${role}-v1`,
    binding: {
      task_id: TASK_ID,
      run_id: RUN_ID,
      attempt_id: ATTEMPT_ID,
      role,
    },
    providerResult: providerResult(),
    rawEnvelope,
    verifierEnvelope,
    ...overrides,
  };
}

function rawDigest(value) {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

test('planner preserves claimed review policy but only labels verifier evidence as verified', () => {
  const rawEnvelope = {
    verdict: 'DONE',
    branch: 'cp-07280905-harness-prd',
    sprint_dir: 'sprints/07280905-kernel-result-channel-bootstrap',
    planner_branch: 'cp-07280905-harness-prd',
    review_required: true,
    status: 'DONE',
  };
  const verifierEnvelope = {
    branch: rawEnvelope.branch,
    sprint_dir: rawEnvelope.sprint_dir,
    planner_branch: rawEnvelope.planner_branch,
    prd_sha256: DIGEST,
    effective_review_required: true,
  };

  const result = finalizeRoleResult(input('planner', rawEnvelope, verifierEnvelope));

  assert.equal(result.status, 'completed');
  assert.equal(result.decision.review_required, true);
  assert.deepEqual(result.role_result, {
    kind: 'planner',
    raw_sha256: rawDigest(rawEnvelope),
    claimed: rawEnvelope,
    verified: verifierEnvelope,
  });
  assert.equal(result.role_result.verified.effective_review_required, true);
});

test('proposer emits only the verified branch and four verified artifact digests', () => {
  const rawEnvelope = {
    propose_branch: 'cp-harness-propose-r1-33333333-a2',
    workstream_count: 1,
    task_plan_path: 'sprints/07280905-kernel-result-channel-bootstrap/task-plan.json',
  };
  const verifierEnvelope = {
    propose_branch: rawEnvelope.propose_branch,
    head_sha: SHA,
    artifacts: {
      contract_draft: {
        path: 'sprints/07280905-kernel-result-channel-bootstrap/contract-draft.md',
        sha256: DIGEST,
      },
      contract_dod: {
        path: 'sprints/07280905-kernel-result-channel-bootstrap/contract-dod.md',
        sha256: DIGEST,
      },
      task_plan: {
        path: rawEnvelope.task_plan_path,
        sha256: DIGEST,
      },
      contract_tests: {
        path: 'sprints/07280905-kernel-result-channel-bootstrap/tests',
        sha256: DIGEST,
      },
    },
  };

  const result = finalizeRoleResult(input('proposer', rawEnvelope, verifierEnvelope));

  assert.equal(result.status, 'completed');
  assert.equal(result.artifacts.length, 4);
  assert.ok(result.artifacts.every((artifact) => artifact.head_sha === SHA));
  assert.deepEqual(result.role_result.verified, verifierEnvelope);
});

test('reviewer REVISION remains a completed business decision and requires verified rubric and judgment count', () => {
  const rawEnvelope = {
    verdict: 'REVISION',
    rubric_scores: RUBRIC,
    judgments_written: 0,
    feedback: '补充真实重启回放断言。',
  };
  const verifierEnvelope = {
    contract_sha: SHA,
    verdict: 'REVISION',
    rubric_scores: RUBRIC,
    judgments_written: 0,
  };

  const result = finalizeRoleResult(input('reviewer', rawEnvelope, verifierEnvelope));

  assert.equal(result.status, 'completed');
  assert.equal(result.decision.outcome, 'REVISION');
  assert.deepEqual(result.role_result.verified, verifierEnvelope);
});

test('reviewer APPROVED requires a positive observed judgment count', () => {
  const rawEnvelope = {
    verdict: 'APPROVED',
    rubric_scores: RUBRIC,
    judgments_written: 0,
    feedback: '',
  };
  const verifierEnvelope = {
    contract_sha: SHA,
    verdict: 'APPROVED',
    rubric_scores: RUBRIC,
    judgments_written: 0,
  };

  assert.throws(
    () => finalizeRoleResult(input('reviewer', rawEnvelope, verifierEnvelope)),
    /APPROVED judgments_written/,
  );
});

test('generator FAILED is completed_with_concerns and emits only the verified open PR artifact', () => {
  const prUrl = 'https://github.com/perfectuser21/cecelia/pull/4391';
  const rawEnvelope = {
    verdict: 'FAILED',
    pr_url: prUrl,
    reason: 'CI remained red after the bounded repair budget.',
  };
  const verifierEnvelope = {
    pull_request: {
      type: 'pull_request',
      url: prUrl,
      number: 4391,
      head_ref: 'cp-07280905-result-channel',
      head_sha: SHA,
      state: 'OPEN',
    },
  };

  const result = finalizeRoleResult(input('generator', rawEnvelope, verifierEnvelope));

  assert.equal(result.status, 'completed_with_concerns');
  assert.deepEqual(result.artifacts, [verifierEnvelope.pull_request]);
  assert.equal(result.decision.outcome, 'FAILED');
});

test('evaluator FAIL remains a completed decision and checks come from verifierEnvelope', () => {
  const behaviorTest = {
    command: 'npm test',
    exit_code: 1,
    log_tail: 'expected receipt, got none',
    verification_level: 'L2',
  };
  const rawEnvelope = {
    verdict: 'FAIL',
    task_id: TASK_ID,
    attempt_id: ATTEMPT_ID,
    failed_step: 'Step 4',
    log_excerpt: 'receipt missing',
    behavior_tests: [behaviorTest],
    unverifiable: [],
    verification_level: 'L2',
    screenshots: ['https://evidence.example.invalid/result.png'],
    cascade_assertions: [{
      link_id: '44444444-4444-4444-8444-444444444444',
      assertion_ref: 'tests/receipt-replay.test.js',
      ran: true,
      result: 'pass',
    }],
  };
  const verifierEnvelope = {
    pr_head_sha: SHA,
    behavior_tests: [behaviorTest],
  };

  const result = finalizeRoleResult(input('evaluator', rawEnvelope, verifierEnvelope));

  assert.equal(result.status, 'completed');
  assert.equal(result.decision.outcome, 'FAIL');
  assert.deepEqual(result.checks, verifierEnvelope.behavior_tests);
});

test('reporter maps observed report, learning, screenshots and DB count without upgrading raw claims', () => {
  const prUrl = 'https://github.com/perfectuser21/cecelia/pull/4391';
  const rawEnvelope = {
    verdict: 'DONE_WITH_CONCERNS',
    task_id: TASK_ID,
    report_path: 'sprints/07280905-kernel-result-channel-bootstrap/harness-report.md',
    pr_url: prUrl,
    screenshots: ['sprints/07280905-kernel-result-channel-bootstrap/screenshots/result.png'],
    concerns: 'Notion sync unavailable.',
  };
  const verifierEnvelope = {
    pull_request_url: prUrl,
    report: { path: rawEnvelope.report_path, sha256: DIGEST },
    learning: {
      path: 'sprints/07280905-kernel-result-channel-bootstrap/learning.md',
      sha256: DIGEST,
    },
    screenshots: [{ path: rawEnvelope.screenshots[0], sha256: DIGEST }],
    learnings_inserted: 1,
  };

  const result = finalizeRoleResult(input('reporter', rawEnvelope, verifierEnvelope));

  assert.equal(result.status, 'completed_with_concerns');
  assert.equal(result.artifacts.length, 3);
  assert.equal(result.role_result.verified.learnings_inserted, 1);
});

test('canonical JSON and raw_sha256 are deterministic across input key order', () => {
  const rawA = {
    verdict: 'DONE',
    branch: 'cp-07280905-harness-prd',
    sprint_dir: 'sprints/07280905-kernel-result-channel-bootstrap',
    planner_branch: 'cp-07280905-harness-prd',
    review_required: false,
    status: 'DONE',
  };
  const rawB = {
    status: 'DONE',
    review_required: false,
    planner_branch: rawA.planner_branch,
    sprint_dir: rawA.sprint_dir,
    branch: rawA.branch,
    verdict: 'DONE',
  };
  const verified = {
    branch: rawA.branch,
    sprint_dir: rawA.sprint_dir,
    planner_branch: rawA.planner_branch,
    prd_sha256: DIGEST,
    effective_review_required: false,
  };

  const a = finalizeRoleResult(input('planner', rawA, verified));
  const b = finalizeRoleResult(input('planner', rawB, verified));

  assert.equal(canonicalJson(rawA), canonicalJson(rawB));
  assert.equal(a.role_result.raw_sha256, b.role_result.raw_sha256);
});

test('canonical JSON preserves adversarial own property names without digest collisions', () => {
  const adversarial = JSON.parse(
    '{"__proto__":{"polluted":true},"constructor":"owned","prototype":"owned"}',
  );

  assert.equal(
    canonicalJson(adversarial),
    '{"__proto__":{"polluted":true},"constructor":"owned","prototype":"owned"}',
  );
  assert.notEqual(canonicalJson(adversarial), canonicalJson({}));
  assert.equal({}.polluted, undefined);
});

test('rejects unknown fields at every authority boundary', () => {
  const raw = {
    verdict: 'REVISION',
    rubric_scores: RUBRIC,
    judgments_written: 0,
    feedback: 'fix',
  };
  const verified = {
    contract_sha: SHA,
    verdict: 'REVISION',
    rubric_scores: RUBRIC,
    judgments_written: 0,
  };
  const cases = [
    { ...input('reviewer', raw, verified), injected: true },
    input('reviewer', { ...raw, injected: true }, verified),
    input('reviewer', JSON.parse(JSON.stringify({
      ...raw,
      __proto_placeholder__: true,
    }).replace('"__proto_placeholder__"', '"__proto__"')), verified),
    input('reviewer', { ...raw, constructor: 'owned' }, verified),
    input('reviewer', { ...raw, prototype: 'owned' }, verified),
    input('reviewer', raw, { ...verified, injected: true }),
    input('reviewer', raw, verified, {
      providerResult: providerResult({ injected: true }),
    }),
  ];

  for (const value of cases) {
    assert.throws(() => finalizeRoleResult(value), /unknown field/);
  }
});

test('accepts the exact feedback-only segmented FAIL and relative mac_web screenshot Skill shapes', () => {
  const rawEnvelope = {
    verdict: 'FAIL',
    task_id: TASK_ID,
    attempt_id: ATTEMPT_ID,
    feedback: 'DoD 缺 [BEHAVIOR] 条目',
    segment_eval: 'ws2',
    screenshots: [
      'sprints/07280905-kernel-result-channel-bootstrap/screenshots/result.png',
    ],
  };
  const verifierEnvelope = {
    pr_head_sha: SHA,
    behavior_tests: [],
  };

  const result = finalizeRoleResult(input('evaluator', rawEnvelope, verifierEnvelope));

  assert.equal(result.status, 'completed');
  assert.equal(result.decision.outcome, 'FAIL');
  assert.equal(result.decision.reason, rawEnvelope.feedback);
  assert.equal(result.role_result.claimed.segment_eval, 'ws2');
});

test('rejects identity, SHA, artifact, judgment, test and PR claims not established by verifierEnvelope', () => {
  const evaluatorRaw = {
    verdict: 'PASS',
    task_id: TASK_ID,
    attempt_id: ATTEMPT_ID,
    failed_step: null,
    log_excerpt: null,
    behavior_tests: [{
      command: 'npm test',
      exit_code: 0,
      log_tail: 'green',
    }],
    unverifiable: [],
    verification_level: 'L2',
  };
  assert.throws(
    () => finalizeRoleResult(input('evaluator', {
      ...evaluatorRaw,
      attempt_id: RUN_ID,
    }, {
      pr_head_sha: SHA,
      behavior_tests: evaluatorRaw.behavior_tests,
    })),
    /attempt_id mismatch/,
  );
  assert.throws(
    () => finalizeRoleResult(input('evaluator', evaluatorRaw, {
      pr_head_sha: 'short-sha',
      behavior_tests: evaluatorRaw.behavior_tests,
    })),
    /sha/,
  );
  assert.throws(
    () => finalizeRoleResult(input('evaluator', evaluatorRaw, {
      pr_head_sha: SHA,
      behavior_tests: [{ ...evaluatorRaw.behavior_tests[0], log_tail: 'fabricated' }],
    })),
    /behavior_tests mismatch/,
  );

  const reviewerRaw = {
    verdict: 'APPROVED',
    rubric_scores: RUBRIC,
    judgments_written: 2,
    feedback: '',
  };
  assert.throws(
    () => finalizeRoleResult(input('reviewer', reviewerRaw, {
      contract_sha: SHA,
      verdict: 'APPROVED',
      rubric_scores: RUBRIC,
      judgments_written: 1,
    })),
    /judgments_written mismatch/,
  );

  const prUrl = 'https://github.com/perfectuser21/cecelia/pull/4391';
  assert.throws(
    () => finalizeRoleResult(input('generator', {
      verdict: 'DONE',
      pr_url: prUrl,
    }, {
      pull_request: {
        type: 'pull_request',
        url: 'https://github.com/perfectuser21/cecelia/pull/9999',
        number: 9999,
        head_ref: 'cp-other',
        head_sha: SHA,
        state: 'OPEN',
      },
    })),
    /pr_url mismatch/,
  );

  const proposerRaw = {
    propose_branch: 'cp-harness-propose-r1-33333333-a2',
    workstream_count: 1,
    task_plan_path: 'sprints/07280905-kernel-result-channel-bootstrap/task-plan.json',
  };
  assert.throws(
    () => finalizeRoleResult(input('proposer', proposerRaw, {
      propose_branch: proposerRaw.propose_branch,
      head_sha: SHA,
      artifacts: {
        contract_draft: { path: 'contract-draft.md', sha256: DIGEST },
        contract_dod: { path: 'contract-dod.md', sha256: DIGEST },
        task_plan: { path: 'different-task-plan.json', sha256: DIGEST },
        contract_tests: { path: 'tests', sha256: DIGEST },
      },
    })),
    /task_plan_path mismatch/,
  );
});

test('rejects oversized or non-canonical values and provider claims that bypass role verification', () => {
  const raw = {
    verdict: 'DONE',
    branch: 'cp-07280905-harness-prd',
    sprint_dir: 'sprints/07280905-kernel-result-channel-bootstrap',
    planner_branch: 'cp-07280905-harness-prd',
    review_required: false,
    status: 'DONE',
  };
  const verified = {
    branch: raw.branch,
    sprint_dir: raw.sprint_dir,
    planner_branch: raw.planner_branch,
    prd_sha256: DIGEST,
    effective_review_required: false,
  };

  assert.throws(
    () => finalizeRoleResult(input('planner', { ...raw, branch: `cp-${'x'.repeat(300)}` }, verified)),
    /branch/,
  );
  assert.throws(
    () => finalizeRoleResult(input('planner', raw, verified, {
      providerResult: providerResult({
        artifacts: [{ type: 'pull_request', url: 'https://example.invalid/forged' }],
      }),
    })),
    /providerResult.artifacts/,
  );
  assert.throws(
    () => finalizeRoleResult(input('planner', raw, verified, {
      providerResult: providerResult({ summary: 'x'.repeat(20_000) }),
    })),
    /summary/,
  );
});

test('planner review policy is verifier-owned and cannot downgrade a true claim', () => {
  const raw = {
    verdict: 'DONE',
    branch: 'cp-07280905-harness-prd',
    sprint_dir: 'sprints/07280905-kernel-result-channel-bootstrap',
    planner_branch: 'cp-07280905-harness-prd',
    review_required: false,
    status: 'DONE',
  };
  const verified = {
    branch: raw.branch,
    sprint_dir: raw.sprint_dir,
    planner_branch: raw.planner_branch,
    prd_sha256: DIGEST,
    effective_review_required: true,
  };

  assert.equal(
    finalizeRoleResult(input('planner', raw, verified)).decision.review_required,
    true,
  );
  assert.throws(
    () => finalizeRoleResult(input('planner', {
      ...raw,
      review_required: true,
    }, {
      ...verified,
      effective_review_required: false,
    })),
    /review_required downgrade/,
  );
});
