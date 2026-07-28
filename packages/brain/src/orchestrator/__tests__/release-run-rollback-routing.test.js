import { describe, expect, it, vi } from 'vitest';
import { planRollbackArtifactRoutes } from '../release-run-rollback-routing.js';

const releaseRunId = '44444444-4444-4444-8444-444444444444';
const digest = (value) => `sha256:${value.repeat(64)}`;
const targets = [
  {
    artifact_name: 'brain',
    current_version: '1.268.17',
    current_digest: digest('a'),
    previous_version: `brain-image:${digest('b')}`,
    previous_digest: digest('b'),
    rollback_metadata: {
      image_reference: digest('b'),
      image_tag: `cecelia-brain:rollback-${'b'.repeat(12)}`,
      current_image_digest: digest('1'),
    },
  },
  {
    artifact_name: 'workspace',
    current_version: 'c'.repeat(12),
    current_digest: digest('c'),
    previous_version: 'dashboard:prod-cecelia-v41',
    previous_digest: digest('d'),
    rollback_metadata: {
      schema_version: 1,
      release_run_id: releaseRunId,
      artifact_name: 'workspace',
      old_tag: 'prod-cecelia-v41',
      new_tag: 'prod-cecelia-v42',
      merge_sha: 'f'.repeat(40),
      current_deployed_digest: digest('2'),
      previous_merge_sha: 'a'.repeat(40),
    },
  },
  {
    artifact_name: 'workflow-skills',
    current_version: 'e'.repeat(12),
    current_digest: digest('e'),
    previous_version: `workflow-skills:${digest('f')}`,
    previous_digest: digest('f'),
    rollback_metadata: {
      current_links_digest: digest('3'),
    },
  },
];

describe('typed rollback artifact routing', () => {
  it('maps persisted targets to fixed existing rollback primitives', () => {
    expect(planRollbackArtifactRoutes(targets, {
      repoRoot: '/deploy',
      releaseRunId,
      existsSync: vi.fn(() => true),
    })).toEqual([
      {
        artifact: 'brain',
        command: '/repo/scripts/brain-rollback.sh',
        args: [`rollback-${'b'.repeat(12)}`],
        expected_digest: digest('b'),
        expected_current_digest: digest('1'),
        readback_kind: 'brain-image',
      },
      {
        artifact: 'workspace',
        command: '/repo/scripts/promote-dashboard.sh',
        args: ['--rollback', 'prod-cecelia-v41'],
        expected_digest: digest('d'),
        expected_current_digest: digest('2'),
        expected_current_version: 'prod-cecelia-v42',
        expected_current_merge_sha: 'f'.repeat(40),
        readback_kind: 'dashboard-release',
        target_merge_sha: 'a'.repeat(40),
      },
      {
        artifact: 'workflow-skills',
        command: '/repo/packages/workflows/scripts/deploy-workflow-skills.sh',
        args: ['--rollback', releaseRunId],
        expected_digest: digest('f'),
        expected_current_digest: digest('3'),
        readback_kind: 'workflow-links',
      },
    ]);
  });

  it.each([
    ['brain command injection', { ...targets[0], rollback_metadata: { ...targets[0].rollback_metadata, image_tag: 'cecelia-brain:$(id)' } }],
    ['brain digest mismatch', { ...targets[0], rollback_metadata: { ...targets[0].rollback_metadata, image_reference: digest('9') } }],
    ['dashboard tag traversal', { ...targets[1], rollback_metadata: { ...targets[1].rollback_metadata, old_tag: '../../x' } }],
    ['dashboard run mismatch', { ...targets[1], rollback_metadata: { ...targets[1].rollback_metadata, release_run_id: crypto.randomUUID() } }],
    ['workflow target mismatch', { ...targets[2], previous_version: `workflow-skills:${digest('9')}` }],
  ])('rejects adversarial %s metadata before spawn', (_label, target) => {
    expect(() => planRollbackArtifactRoutes([target], {
      repoRoot: '/deploy',
      releaseRunId,
      existsSync: vi.fn(() => true),
    })).toThrow(/release_rollback_route_/);
  });

  it('rejects duplicate/unknown artifacts and unavailable primitives', () => {
    expect(() => planRollbackArtifactRoutes([targets[0], targets[0]], {
      repoRoot: '/deploy',
      releaseRunId,
      existsSync: vi.fn(() => true),
    })).toThrow('release_rollback_route_duplicate');
    expect(() => planRollbackArtifactRoutes([{
      ...targets[0],
      artifact_name: 'unknown',
    }], {
      repoRoot: '/deploy',
      releaseRunId,
      existsSync: vi.fn(() => true),
    })).toThrow('release_rollback_route_unknown');
    expect(() => planRollbackArtifactRoutes([targets[0]], {
      repoRoot: '/deploy',
      releaseRunId,
      existsSync: vi.fn(() => false),
    })).toThrow('release_rollback_route_unavailable');
  });
});
