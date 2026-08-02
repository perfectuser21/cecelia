import { describe, expect, it, vi } from 'vitest';

import { defaultCommitLineageResolver } from './commit-lineage-resolver.js';

const REPO = 'perfectuser21/zenithjoy-workspace';
const START = '0dc4e3c07ff19a0ac95440723986bf3cb78580b2';
const HEAD = '7629efe6cef4817a3498b8c10a8b2f8cfd9f31f8';
const MERGE_BASE = '676fed7de12023d355deac7849af8a525ae53f8d';

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn(async () => body),
  };
}

describe('commit lineage resolver', () => {
  it.each([
    ['ahead', true],
    ['identical', true],
    ['behind', false],
    ['diverged', false],
  ])('maps GitHub compare status %s to is_ancestor %s', async (status, expected) => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {
      status,
      merge_base_commit: { sha: MERGE_BASE },
    }));

    const result = await defaultCommitLineageResolver(
      { repo: REPO, base: START, head: HEAD },
      { fetchFn, resolveToken: async () => 'token' },
    );

    expect(result).toEqual({ is_ancestor: expected, merge_base_sha: MERGE_BASE });
    expect(fetchFn).toHaveBeenCalledWith(
      `https://api.github.com/repos/${REPO}/compare/${START}...${HEAD}`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token' }),
      }),
    );
  });

  // The fork point is the fact that catches a rebase onto a moved main: plain
  // ancestry still holds there, the merge base is what shifts forward.
  it('reports the fork point when the base is a branch name', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {
      status: 'diverged',
      merge_base_commit: { sha: MERGE_BASE },
    }));

    const result = await defaultCommitLineageResolver(
      { repo: REPO, base: 'main', head: HEAD },
      { fetchFn, resolveToken: async () => 'token' },
    );

    expect(result).toEqual({ is_ancestor: false, merge_base_sha: MERGE_BASE });
    expect(fetchFn.mock.calls[0][0]).toBe(
      `https://api.github.com/repos/${REPO}/compare/main...${HEAD}`,
    );
  });

  it('reports a null fork point rather than inventing one', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { status: 'ahead' }));

    await expect(defaultCommitLineageResolver(
      { repo: REPO, base: START, head: HEAD },
      { fetchFn, resolveToken: async () => 'token' },
    )).resolves.toEqual({ is_ancestor: true, merge_base_sha: null });
  });

  it('throws so the caller can fail closed when GitHub rejects the compare', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(502, {}));

    await expect(defaultCommitLineageResolver(
      { repo: REPO, base: START, head: HEAD },
      { fetchFn, resolveToken: async () => 'token' },
    )).rejects.toThrow('github_commit_compare_http_502');
  });

  it.each([
    { repo: 'not-a-repo', base: START, head: HEAD },
    { repo: REPO, base: 'main..other', head: HEAD },
    { repo: REPO, base: START, head: 'origin/main' },
  ])('rejects uncanonical lineage inputs before touching the network', async (input) => {
    const fetchFn = vi.fn();

    await expect(defaultCommitLineageResolver(input, {
      fetchFn,
      resolveToken: async () => 'token',
    })).rejects.toThrow('commit_lineage_request_invalid');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
