import { describe, expect, it } from 'vitest';

import {
  RELEASE_STATES,
  nextReleaseState,
  normalizeArtifactVersions,
  sameArtifactVersions,
  validateProductionObservation,
  validateReleaseIdentity,
  validateStagingObservation,
} from '../release-run-contract.js';

const MERGE_SHA = 'b'.repeat(40);
const HEAD_SHA = 'a'.repeat(40);
const artifacts = [
  { name: 'brain', version: '1.268.2', digest: `sha256:${'1'.repeat(64)}` },
  { name: 'dashboard', version: 'prod-4401', digest: `sha256:${'2'.repeat(64)}` },
];

describe('ReleaseRun contract', () => {
  it('accepts and freezes exact identity axes with canonical artifact order', () => {
    expect(validateReleaseIdentity({
      run_id: '11111111-1111-4111-8111-111111111111',
      task_id: '22222222-2222-4222-8222-222222222222',
      merge_intent_id: '33333333-3333-4333-8333-333333333333',
      merge_receipt_id: '44444444-4444-4444-8444-444444444444',
      repository: 'perfectuser21/cecelia',
      pr_number: 4401,
      source_head_sha: HEAD_SHA,
      merge_sha: MERGE_SHA,
      artifact_versions: [...artifacts].reverse(),
      policy_version: 'kernel-release/v1',
    })).toMatchObject({
      source_head_sha: HEAD_SHA,
      merge_sha: MERGE_SHA,
      artifact_versions: artifacts,
      policy_version: 'kernel-release/v1',
    });
  });

  it.each([
    ['merge_sha', 'short'],
    ['source_head_sha', 'A'.repeat(40)],
    ['repository', ''],
    ['pr_number', 0],
    ['policy_version', 'kernel-release/latest'],
    ['artifact_versions', []],
  ])('rejects malformed identity field %s', (field, value) => {
    expect(() => validateReleaseIdentity({
      run_id: '11111111-1111-4111-8111-111111111111',
      task_id: '22222222-2222-4222-8222-222222222222',
      merge_intent_id: '33333333-3333-4333-8333-333333333333',
      merge_receipt_id: '44444444-4444-4444-8444-444444444444',
      repository: 'perfectuser21/cecelia',
      pr_number: 4401,
      source_head_sha: HEAD_SHA,
      merge_sha: MERGE_SHA,
      artifact_versions: artifacts,
      policy_version: 'kernel-release/v1',
      [field]: value,
    })).toThrow(`release_identity_${field}_invalid`);
  });

  it('rejects duplicate or non-digest artifacts and compares canonical sets', () => {
    expect(() => normalizeArtifactVersions([artifacts[0], artifacts[0]]))
      .toThrow('release_artifact_duplicate');
    expect(() => normalizeArtifactVersions([{ ...artifacts[0], digest: HEAD_SHA }]))
      .toThrow('release_artifact_digest_invalid');
    expect(sameArtifactVersions(artifacts, [...artifacts].reverse())).toBe(true);
    expect(sameArtifactVersions(artifacts, [{ ...artifacts[0], version: 'other' }, artifacts[1]]))
      .toBe(false);
  });

  it('allows only the exact six-state predecessor chain', () => {
    expect(RELEASE_STATES).toEqual([
      'merged',
      'staging_queued',
      'staging_running',
      'staging_passed',
      'production_deploying',
      'production_verified',
    ]);
    expect(nextReleaseState(null)).toBe('merged');
    expect(nextReleaseState('staging_running')).toBe('staging_passed');
    expect(nextReleaseState('production_verified')).toBeNull();
    expect(() => nextReleaseState('skipped')).toThrow('release_state_invalid');
  });

  it('confirms staging only for exact PASS SHA and artifacts', () => {
    expect(validateStagingObservation({
      status: 'pass',
      merge_sha: MERGE_SHA,
      artifact_versions: artifacts,
    }, { merge_sha: MERGE_SHA, artifact_versions: artifacts })).toMatchObject({
      status: 'pass',
      merge_sha: MERGE_SHA,
    });
  });

  it.each(['skipped', 'idle', 'unknown', 'unavailable', 'fail', '', null])(
    'denies staging status %s',
    (status) => {
      expect(() => validateStagingObservation({
        status,
        merge_sha: MERGE_SHA,
        artifact_versions: artifacts,
      }, { merge_sha: MERGE_SHA, artifact_versions: artifacts }))
        .toThrow('release_staging_not_passed');
    },
  );

  it('denies stale staging SHA and artifact drift', () => {
    expect(() => validateStagingObservation({
      status: 'pass',
      merge_sha: HEAD_SHA,
      artifact_versions: artifacts,
    }, { merge_sha: MERGE_SHA, artifact_versions: artifacts }))
      .toThrow('release_staging_sha_mismatch');
    expect(() => validateStagingObservation({
      status: 'pass',
      merge_sha: MERGE_SHA,
      artifact_versions: [{ ...artifacts[0], version: 'drift' }, artifacts[1]],
    }, { merge_sha: MERGE_SHA, artifact_versions: artifacts }))
      .toThrow('release_staging_artifacts_mismatch');
  });

  it('requires complete production verification and rollback metadata', () => {
    const observation = {
      status: 'pass',
      health: 'pass',
      required_e2e: 'pass',
      merge_sha: MERGE_SHA,
      deployed_versions: artifacts,
      rollback_metadata: {
        anchor: 'prod-cecelia-v4401',
        previous_version: 'prod-cecelia-v4400',
      },
    };
    expect(validateProductionObservation(observation, {
      merge_sha: MERGE_SHA,
      artifact_versions: artifacts,
    })).toEqual({
      ...observation,
      deployed_versions: artifacts,
    });
  });

  it.each([
    ['status', 'unknown', 'release_production_not_passed'],
    ['health', 'idle', 'release_production_health_not_passed'],
    ['required_e2e', 'skipped', 'release_production_e2e_not_passed'],
    ['merge_sha', HEAD_SHA, 'release_production_sha_mismatch'],
    ['deployed_versions', [], 'release_artifact_versions_invalid'],
    ['rollback_metadata', null, 'release_production_rollback_invalid'],
    ['rollback_metadata', { anchor: '', previous_version: 'v1' }, 'release_production_rollback_invalid'],
  ])('denies incomplete production field %s', (field, value, code) => {
    expect(() => validateProductionObservation({
      status: 'pass',
      health: 'pass',
      required_e2e: 'pass',
      merge_sha: MERGE_SHA,
      deployed_versions: artifacts,
      rollback_metadata: { anchor: 'v2', previous_version: 'v1' },
      [field]: value,
    }, { merge_sha: MERGE_SHA, artifact_versions: artifacts })).toThrow(code);
  });
});
