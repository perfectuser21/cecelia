import { fileURLToPath } from 'node:url';

import { readGitRevision } from './lib/git-revision.js';

const DEFAULT_REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

export function buildMutationRoute({
  change_kind,
  map_scope,
  repo_hint,
  repo_root,
  revision_reader = readGitRevision,
}) {
  if (!Array.isArray(map_scope) || map_scope.length === 0) {
    throw new Error('system_coding_map_scope_required');
  }
  return {
    mutation_intent: 'write',
    declared_domain: 'coding',
    declared_change_kind: change_kind,
    repo_hint,
    map_scope_hint: map_scope,
    base_sha: revision_reader(repo_root),
  };
}

export function buildCeceliaMutationRoute(options) {
  return buildMutationRoute({
    ...options,
    repo_hint: 'cecelia',
    repo_root: options.repo_root || process.env.REPO_ROOT_CECELIA || DEFAULT_REPO_ROOT,
  });
}
