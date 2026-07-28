import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  assessPostDiffRisk,
  canonicalDiffHash,
  classifyChangedPaths,
} from './post-diff-risk-policy.js';

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const HEAD_SHA = 'a'.repeat(40);
const CONTRACT_DIGEST = `sha256:${'b'.repeat(64)}`;
const NOW = Date.parse('2026-07-28T08:00:00.000Z');
const FILES = Object.freeze([
  { path: 'apps/dashboard/src/components/StatusCard.jsx', additions: 12, deletions: 3 },
  { path: 'apps/dashboard/src/components/StatusCard.test.jsx', additions: 18, deletions: 2 },
]);

function receipt(overrides = {}) {
  return {
    receipt_status: 'confirmed',
    behavior_version: 'dashboard-status-card/v3',
    contract_version: 7,
    contract_digest: CONTRACT_DIGEST,
    path_class: 'application',
    production_head_sha: 'c'.repeat(40),
    deployed_at: '2026-07-27T08:00:00.000Z',
    expires_at: '2026-08-27T08:00:00.000Z',
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    taskId: TASK_ID,
    runId: RUN_ID,
    hop: 12,
    headSha: HEAD_SHA,
    files: FILES,
    contract: {
      version: 7,
      digest: CONTRACT_DIGEST,
    },
    behaviorVersion: 'dashboard-status-card/v3',
    productionReceipt: receipt(),
    callerRisk: 'low',
    changeSignals: {
      newCapability: false,
    },
    evidence: {
      ci: 'pass',
      evaluator: 'PASS',
      judge: 'PASS',
    },
    now: () => NOW,
    ...overrides,
  };
}

describe('canonical post-diff evidence', () => {
  it('sorts files before hashing and binds path plus additions/deletions', () => {
    const reversed = [...FILES].reverse();
    expect(canonicalDiffHash(reversed)).toBe(canonicalDiffHash(FILES));

    const changed = FILES.map((file, index) => (
      index === 0 ? { ...file, additions: file.additions + 1 } : file
    ));
    expect(canonicalDiffHash(changed)).not.toBe(canonicalDiffHash(FILES));
    expect(canonicalDiffHash(FILES)).toBe(
      `sha256:${createHash('sha256').update(JSON.stringify([
        { path: FILES[0].path, additions: 12, deletions: 3 },
        { path: FILES[1].path, additions: 18, deletions: 2 },
      ])).digest('hex')}`,
    );
  });

  it.each([
    [['packages/brain/migrations/373_example.sql'], 'migration'],
    [['.github/workflows/ci.yml'], 'ci_workflow'],
    [['packages/brain/src/security/token.js'], 'security_credential'],
    [['scripts/deploy/brain-deploy.sh'], 'deploy_release'],
    [['packages/brain/src/orchestrator/derive.js'], 'core_orchestration'],
    [['some-new-root/file.xyz'], 'unknown'],
    [['apps/dashboard/src/App.jsx'], 'application'],
  ])('classifies %j as %s', (paths, expected) => {
    expect(classifyChangedPaths(paths)).toEqual({
      path_class: expected,
      protected: !['application'].includes(expected),
      classes: [expected],
    });
  });
});

describe('assessPostDiffRisk', () => {
  it('allows automatic merge only for an exact, current production receipt and green evidence', () => {
    const proof = assessPostDiffRisk(input());
    expect(proof).toMatchObject({
      schema_version: 'kernel-post-diff-risk/v1',
      policy_version: 'kernel-post-diff-risk/v1',
      risk_level: 'low',
      human_review_required: false,
      auto_eligible: true,
      reasons: [],
      bindings: {
        task_id: TASK_ID,
        run_id: RUN_ID,
        hop: 12,
        head_sha: HEAD_SHA,
        diff_hash: canonicalDiffHash(FILES),
        contract_version: 7,
        contract_digest: CONTRACT_DIGEST,
        behavior_version: 'dashboard-status-card/v3',
        path_class: 'application',
      },
    });
    expect(Date.parse(proof.expires_at)).toBe(NOW + 15 * 60_000);
    expect(Object.isFrozen(proof)).toBe(true);
  });

  it.each([
    ['missing receipt', null, 'medium', 'first_behavior'],
    ['expired receipt', receipt({ expires_at: '2026-07-28T07:59:59.000Z' }), 'high', 'production_proof_expired'],
    ['behavior drift', receipt({ behavior_version: 'dashboard-status-card/v2' }), 'high', 'behavior_version_changed'],
    ['contract version drift', receipt({ contract_version: 6 }), 'high', 'contract_changed'],
    ['contract digest drift', receipt({ contract_digest: `sha256:${'d'.repeat(64)}` }), 'high', 'contract_changed'],
    ['path class drift', receipt({ path_class: 'docs' }), 'high', 'path_class_changed'],
  ])('requires a human for %s', (_label, productionReceipt, risk, reason) => {
    expect(assessPostDiffRisk(input({ productionReceipt }))).toMatchObject({
      risk_level: risk,
      human_review_required: true,
      auto_eligible: false,
      reasons: expect.arrayContaining([reason]),
    });
  });

  it.each([
    ['migration', [{ path: 'packages/brain/migrations/373_x.sql', additions: 3, deletions: 0 }], 'protected:migration'],
    ['workflow', [{ path: '.github/workflows/ci.yml', additions: 3, deletions: 0 }], 'protected:ci_workflow'],
    ['credential', [{ path: 'packages/brain/src/credential-broker.js', additions: 3, deletions: 0 }], 'protected:security_credential'],
    ['deploy', [{ path: 'scripts/brain-deploy.sh', additions: 3, deletions: 0 }], 'protected:deploy_release'],
    ['orchestrator', [{ path: 'packages/brain/src/orchestrator/derive.js', additions: 3, deletions: 0 }], 'protected:core_orchestration'],
    ['unknown', [{ path: 'new-root/thing.bin', additions: 3, deletions: 0 }], 'protected:unknown'],
  ])('forces high-risk human review for %s paths', (_label, files, reason) => {
    expect(assessPostDiffRisk(input({ files }))).toMatchObject({
      risk_level: 'high',
      human_review_required: true,
      auto_eligible: false,
      reasons: expect.arrayContaining([reason]),
    });
  });

  it('caller risk can elevate but cannot lower server risk', () => {
    expect(assessPostDiffRisk(input({ callerRisk: 'high' }))).toMatchObject({
      risk_level: 'high',
      human_review_required: true,
      reasons: ['caller_risk_elevated'],
    });
    expect(assessPostDiffRisk(input({
      callerRisk: 'low',
      changeSignals: { newCapability: true },
    }))).toMatchObject({
      risk_level: 'high',
      human_review_required: true,
      reasons: expect.arrayContaining(['new_capability']),
    });
  });

  it.each([
    ['too many files', Array.from({ length: 6 }, (_, index) => ({
      path: `apps/dashboard/src/component-${index}.jsx`,
      additions: 1,
      deletions: 0,
    }))],
    ['too many changed lines', [{
      path: 'apps/dashboard/src/App.jsx',
      additions: 180,
      deletions: 21,
    }]],
  ])('requires human review for %s', (_label, files) => {
    expect(assessPostDiffRisk(input({ files }))).toMatchObject({
      risk_level: 'medium',
      human_review_required: true,
      reasons: expect.arrayContaining(['diff_not_small']),
    });
  });

  it.each([
    ['CI unknown', { ci: 'unknown', evaluator: 'PASS', judge: 'PASS' }, 'ci_not_green'],
    ['evaluator stale', { ci: 'pass', evaluator: null, judge: 'PASS' }, 'evaluator_not_green'],
    ['judge failure', { ci: 'pass', evaluator: 'PASS', judge: 'FAIL' }, 'judge_not_green'],
  ])('fails closed when %s', (_label, evidence, reason) => {
    expect(assessPostDiffRisk(input({ evidence }))).toMatchObject({
      human_review_required: true,
      auto_eligible: false,
      reasons: expect.arrayContaining([reason]),
    });
  });

  it.each([
    ['missing files', { files: null }],
    ['empty files', { files: [] }],
    ['unknown line counts', { files: [{ path: 'apps/dashboard/src/App.jsx' }] }],
    ['missing contract digest', { contract: { version: 7, digest: null } }],
    ['missing behavior version', { behaviorVersion: null }],
  ])('returns an unknown high-risk proof for %s', (_label, override) => {
    expect(assessPostDiffRisk(input(override))).toMatchObject({
      risk_level: 'high',
      human_review_required: true,
      auto_eligible: false,
      reasons: expect.arrayContaining(['ground_truth_unknown']),
    });
  });
});
