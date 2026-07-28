import { describe, expect, it, vi } from 'vitest';
import { planReleaseArtifactRoutes } from '../release-run-routing.js';

const artifacts = [
  { name: 'brain', version: '1.268.6', digest: `sha256:${'a'.repeat(64)}` },
  { name: 'workspace', version: 'b'.repeat(12), digest: `sha256:${'b'.repeat(64)}` },
  { name: 'workflow-skills', version: 'b'.repeat(12), digest: `sha256:${'c'.repeat(64)}` },
];

describe('ReleaseRun server-owned artifact routing', () => {
  it('routes every staging artifact to its own runtime seam', () => {
    expect(planReleaseArtifactRoutes('staging', artifacts, {
      repoRoot: '/release',
      mergeSha: 'b'.repeat(40),
      existsSync: vi.fn(() => true),
    })).toEqual([
      {
        artifact: 'brain',
        command: '/release/scripts/staging-deploy.sh',
        args: [],
        env: {},
      },
      {
        artifact: 'workspace',
        command: '/release/scripts/deploy-local.sh',
        args: ['--changed=apps/', 'main'],
        env: {
          CECELIA_PROD_GIT_SHA: 'b'.repeat(40),
          CECELIA_PROD_DASHBOARD_SHA: 'b'.repeat(40),
        },
      },
      {
        artifact: 'workflow-skills',
        command: '/release/packages/workflows/scripts/deploy-workflow-skills.sh',
        args: ['--staging'],
        env: {},
      },
    ]);
  });

  it('routes production without implicitly deploying Brain for workspace', () => {
    expect(planReleaseArtifactRoutes('production', artifacts.slice(1), {
      repoRoot: '/release',
      existsSync: vi.fn(() => true),
    })).toEqual([
      {
        artifact: 'workspace',
        command: '/release/scripts/promote-dashboard.sh',
        args: [],
        env: { CECELIA_SKIP_BRAIN_PROMOTE: '1' },
      },
      {
        artifact: 'workflow-skills',
        command: '/release/packages/workflows/scripts/deploy-workflow-skills.sh',
        args: [],
        env: {},
      },
    ]);
  });

  it('blocks unknown artifacts before spawning any child', () => {
    expect(() => planReleaseArtifactRoutes('production', [{
      name: 'mystery',
      version: 'v1',
      digest: `sha256:${'a'.repeat(64)}`,
    }], {
      repoRoot: '/release',
      existsSync: vi.fn(() => true),
    })).toThrow('release_artifact_route_unknown');
  });

  it('blocks a known artifact whose runtime seam is unavailable', () => {
    expect(() => planReleaseArtifactRoutes('production', [artifacts[2]], {
      repoRoot: '/release',
      existsSync: vi.fn(() => false),
    })).toThrow('release_artifact_runtime_unavailable');
  });
});
