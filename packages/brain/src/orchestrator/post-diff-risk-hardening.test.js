import { describe, expect, it } from 'vitest';

import {
  assessPostDiffRisk,
  canonicalContractDigest,
  canonicalProductionReceiptDigest,
  classifyChangedPaths,
  deriveBehaviorAuthority,
} from './post-diff-risk-policy.js';

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const RELEASE_RUN_ID = '33333333-3333-4333-8333-333333333333';
const RELEASE_EFFECT_ID = '44444444-4444-4444-8444-444444444444';
const HEAD_SHA = 'a'.repeat(40);
const BASE_SHA = 'b'.repeat(40);
const BLOB_SHA = 'c'.repeat(40);
const ARTIFACT_DIGEST = `sha256:${'d'.repeat(64)}`;
const DIFF_DIGEST = `sha256:${'e'.repeat(64)}`;
const NOW = Date.parse('2026-07-28T08:00:00.000Z');
const CONTRACT = Object.freeze({
  id: '55555555-5555-4555-8555-555555555555',
  version: 7,
  status: 'approved',
  approved_at: '2026-07-27T07:00:00.000Z',
  digest: canonicalContractDigest({ acceptance: ['exact'] }),
});
const FILES = Object.freeze([Object.freeze({
  path: 'apps/dashboard/src/App.jsx',
  previous_path: null,
  status: 'modified',
  blob_sha: BLOB_SHA,
  patch_digest: `sha256:${'f'.repeat(64)}`,
  additions: 2,
  deletions: 1,
})]);

function receipt(overrides = {}) {
  const behavior = deriveBehaviorAuthority({
    repository: 'perfectuser21/cecelia',
    contract: CONTRACT,
    files: FILES,
  });
  const value = {
    receipt_status: 'confirmed',
    release_authority_valid: true,
    repository: 'perfectuser21/cecelia',
    behavior_fingerprint: behavior.behavior_fingerprint,
    capability_fingerprint: behavior.capability_fingerprint,
    path_surface_digest: behavior.path_surface_digest,
    path_class: 'application',
    contract_version: CONTRACT.version,
    contract_digest: CONTRACT.digest,
    artifact_digest: ARTIFACT_DIGEST,
    release_run_id: RELEASE_RUN_ID,
    release_effect_receipt_id: RELEASE_EFFECT_ID,
    issuer: 'kernel-release-controller/v1',
    production_head_sha: '9'.repeat(40),
    deployed_at: '2026-07-27T08:00:00.000Z',
    expires_at: '2026-08-03T08:00:00.000Z',
    ...overrides,
  };
  return {
    ...value,
    receipt_digest: canonicalProductionReceiptDigest(value),
  };
}

function input(overrides = {}) {
  return {
    taskId: TASK_ID,
    runId: RUN_ID,
    hop: 12,
    repository: 'perfectuser21/cecelia',
    headRepository: 'perfectuser21/cecelia',
    headRef: 'cp-safe',
    headSha: HEAD_SHA,
    baseRepository: 'perfectuser21/cecelia',
    baseRef: 'main',
    baseSha: BASE_SHA,
    diffDigest: DIFF_DIGEST,
    requiredChecks: [{
      context: 'ci-passed',
      app_slug: 'github-actions',
      source: 'github-actions',
      run_id: '123456',
      job_id: '789012',
      head_sha: HEAD_SHA,
      conclusion: 'SUCCESS',
    }],
    files: FILES,
    contract: CONTRACT,
    productionReceipt: receipt(),
    callerRisk: 'low',
    changeSignals: { newCapability: false },
    evidence: { ci: 'pass', evaluator: 'PASS', judge: 'PASS' },
    now: () => NOW,
    ...overrides,
  };
}

describe('server-derived behavior authority', () => {
  it('derives capability and behavior identity without trusting caller labels', () => {
    const first = deriveBehaviorAuthority({
      repository: 'perfectuser21/cecelia',
      contract: CONTRACT,
      files: FILES,
    });
    const relabeled = deriveBehaviorAuthority({
      repository: 'perfectuser21/cecelia',
      contract: CONTRACT,
      files: FILES,
      behaviorVersion: 'caller-controlled/v999',
      newCapability: false,
    });
    expect(relabeled).toEqual(first);
    expect(first).toEqual({
      capability_fingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      behavior_fingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      path_surface_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
  });

  it('changes behavior identity when the exact blob or patch changes at the same path', () => {
    const first = deriveBehaviorAuthority({
      repository: 'perfectuser21/cecelia',
      contract: CONTRACT,
      files: FILES,
    });
    const changedContent = deriveBehaviorAuthority({
      repository: 'perfectuser21/cecelia',
      contract: CONTRACT,
      files: [{
        ...FILES[0],
        blob_sha: 'f'.repeat(40),
        patch_digest: `sha256:${'e'.repeat(64)}`,
      }],
    });

    expect(changedContent.path_surface_digest).toBe(first.path_surface_digest);
    expect(changedContent.behavior_fingerprint).not.toBe(first.behavior_fingerprint);
  });

  it.each([
    'packages/brain/src/consciousness-guard.js',
    'packages/brain/src/policy-validator.js',
    'packages/brain/src/middleware/permission-check.js',
    'packages/engine/src/branch-protect.js',
    'packages/engine/src/stop-hook.js',
    'packages/engine/src/credential-loader.js',
    'packages/brain/src/release-controller.js',
    'packages/brain/src/harness-controller.js',
  ])('classifies the safety surface %s as protected', (path) => {
    expect(classifyChangedPaths([path])).toMatchObject({ protected: true });
  });

  it('classifies both sides of a rename so a moved guard remains protected', () => {
    expect(assessPostDiffRisk(input({
      files: [{
        ...FILES[0],
        path: 'apps/dashboard/src/helper.js',
        previous_path: 'packages/brain/src/consciousness-guard.js',
        status: 'renamed',
      }],
    }))).toMatchObject({
      human_review_required: true,
      reasons: expect.arrayContaining([expect.stringMatching(/^protected:/)]),
    });
  });

  it('caller labels cannot turn a first or new behavior into an automatic change', () => {
    expect(assessPostDiffRisk(input({
      behaviorVersion: 'reused/v1',
      changeSignals: { newCapability: false },
      productionReceipt: null,
    }))).toMatchObject({
      auto_eligible: false,
      human_review_required: true,
      reasons: expect.arrayContaining(['first_behavior']),
    });
  });
});

describe('production receipt authority', () => {
  it('allows only an exact ReleaseRun-backed receipt with bounded freshness', () => {
    expect(assessPostDiffRisk(input())).toMatchObject({
      risk_level: 'low',
      human_review_required: false,
      auto_eligible: true,
      reasons: [],
      bindings: {
        repository: 'perfectuser21/cecelia',
        base_repository: 'perfectuser21/cecelia',
        base_ref: 'main',
        base_sha: BASE_SHA,
        diff_hash: DIFF_DIGEST,
        behavior_fingerprint: expect.stringMatching(/^sha256:/),
        capability_fingerprint: expect.stringMatching(/^sha256:/),
      },
    });
  });

  it.each([
    ['wrong repository', { repository: 'evil/repo' }],
    ['wrong artifact digest', { artifact_digest: 'not-a-digest' }],
    ['missing ReleaseRun', { release_run_id: null }],
    ['missing effect receipt', { release_effect_receipt_id: null }],
    ['unverified ReleaseRun authority', { release_authority_valid: false }],
    ['wrong issuer', { issuer: 'task-caller/v1' }],
    ['future deployment', { deployed_at: '2026-07-29T08:00:00.000Z' }],
    ['overlong TTL', { expires_at: '2026-09-27T08:00:00.000Z' }],
    ['wrong receipt digest', { receipt_digest: `sha256:${'0'.repeat(64)}` }],
  ])('forces human review for %s', (_label, patch) => {
    const forged = receipt(patch);
    if (Object.hasOwn(patch, 'receipt_digest')) {
      forged.receipt_digest = patch.receipt_digest;
    }
    expect(assessPostDiffRisk(input({ productionReceipt: forged }))).toMatchObject({
      human_review_required: true,
      auto_eligible: false,
      reasons: expect.arrayContaining(['production_proof_unknown']),
    });
  });

  it('fails closed without exact base and diff authority', () => {
    expect(assessPostDiffRisk(input({ baseSha: null }))).toMatchObject({
      risk_level: 'high',
      auto_eligible: false,
      reasons: expect.arrayContaining(['ground_truth_unknown']),
    });
    expect(assessPostDiffRisk(input({ diffDigest: null }))).toMatchObject({
      risk_level: 'high',
      auto_eligible: false,
      reasons: expect.arrayContaining(['ground_truth_unknown']),
    });
  });
});
