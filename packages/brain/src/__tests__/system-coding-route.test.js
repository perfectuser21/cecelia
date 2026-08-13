import { describe, expect, it, vi } from 'vitest';

import { buildCeceliaMutationRoute, buildMutationRoute } from '../system-coding-route.js';

describe('system coding route', () => {
  it('binds an explicit four-form change, Map scope and source revision', () => {
    const revisionReader = vi.fn().mockReturnValue('a'.repeat(40));
    const branchReader = vi.fn().mockReturnValue('cp-router-fix');

    const route = buildCeceliaMutationRoute({
      change_kind: 'bugfix',
      map_scope: ['F1'],
      repo_root: '/repo',
      revision_reader: revisionReader,
      branch_reader: branchReader,
    });

    expect(route).toEqual({
      mutation_intent: 'write',
      declared_domain: 'coding',
      declared_change_kind: 'bugfix',
      repo_hint: 'cecelia',
      map_scope_hint: ['F1'],
      branch: 'cp-router-fix',
      base_sha: 'a'.repeat(40),
    });
    expect(revisionReader).toHaveBeenCalledWith('/repo');
    expect(branchReader).toHaveBeenCalledWith('/repo');
  });

  it('rejects missing explicit Map scope', () => {
    expect(() => buildCeceliaMutationRoute({
      change_kind: 'bugfix',
      map_scope: [],
      revision_reader: vi.fn(),
    })).toThrow('system_coding_map_scope_required');
  });

  it('binds an arbitrary registered repo hint to its actual revision', () => {
    const revisionReader = vi.fn().mockReturnValue('b'.repeat(40));

    expect(buildMutationRoute({
      change_kind: 'capability_change',
      map_scope: ['Z1'],
      repo_hint: 'zenithjoy-workspace',
      repo_root: '/workspace',
      revision_reader: revisionReader,
    })).toMatchObject({
      declared_change_kind: 'capability_change',
      repo_hint: 'zenithjoy-workspace',
      map_scope_hint: ['Z1'],
      base_sha: 'b'.repeat(40),
    });
  });
});
