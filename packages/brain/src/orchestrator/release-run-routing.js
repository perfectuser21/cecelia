import { existsSync as defaultExistsSync } from 'node:fs';
import { join } from 'node:path';
import { ReleaseRunError } from './release-run-contract.js';

const ROUTES = Object.freeze({
  staging: Object.freeze({
    brain: ({ repoRoot }) => ({
      command: join(repoRoot, 'scripts/staging-deploy.sh'),
      args: [],
      env: {},
    }),
    workspace: ({ repoRoot }) => ({
      command: join(repoRoot, 'scripts/deploy-local.sh'),
      args: ['--changed=apps/', 'main'],
      env: {},
    }),
    'workflow-skills': ({ repoRoot }) => ({
      command: join(repoRoot, 'packages/workflows/scripts/deploy-workflow-skills.sh'),
      args: ['--staging'],
      env: {},
    }),
  }),
  production: Object.freeze({
    brain: ({ repoRoot }) => ({
      command: join(repoRoot, 'scripts/brain-deploy.sh'),
      args: [],
      env: {},
    }),
    workspace: ({ repoRoot }) => ({
      command: join(repoRoot, 'scripts/promote-dashboard.sh'),
      args: [],
      env: { CECELIA_SKIP_BRAIN_PROMOTE: '1' },
    }),
    'workflow-skills': ({ repoRoot }) => ({
      command: join(repoRoot, 'packages/workflows/scripts/deploy-workflow-skills.sh'),
      args: [],
      env: {},
    }),
  }),
});

export function planReleaseArtifactRoutes(effectKind, artifactVersions, {
  repoRoot,
  mergeSha,
  existsSync = defaultExistsSync,
} = {}) {
  if (!Object.hasOwn(ROUTES, effectKind) || !repoRoot) {
    throw new ReleaseRunError('release_artifact_route_request_invalid');
  }
  if (!Array.isArray(artifactVersions) || artifactVersions.length === 0) {
    throw new ReleaseRunError('release_artifact_route_empty');
  }
  const seen = new Set();
  return artifactVersions.map((artifact) => {
    if (!artifact || seen.has(artifact.name)) {
      throw new ReleaseRunError('release_artifact_route_duplicate');
    }
    seen.add(artifact.name);
    const makeRoute = ROUTES[effectKind][artifact.name];
    if (!makeRoute) {
      throw new ReleaseRunError('release_artifact_route_unknown');
    }
    const route = makeRoute({ repoRoot });
    if (effectKind === 'staging' && artifact.name === 'workspace') {
      if (!/^[0-9a-f]{40}$/.test(mergeSha ?? '')) {
        throw new ReleaseRunError('release_artifact_route_request_invalid');
      }
      route.env = {
        ...route.env,
        CECELIA_PROD_GIT_SHA: mergeSha,
        CECELIA_PROD_DASHBOARD_SHA: mergeSha,
      };
    }
    if (!existsSync(route.command)) {
      throw new ReleaseRunError('release_artifact_runtime_unavailable');
    }
    return Object.freeze({ artifact: artifact.name, ...route });
  });
}

export const __test__ = { ROUTES };
