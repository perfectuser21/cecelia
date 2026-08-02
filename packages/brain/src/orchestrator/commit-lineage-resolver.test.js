import { describe, expect, it, vi } from 'vitest';

import { defaultCommitLineageResolver } from './commit-lineage-resolver.js';

const REPO = 'perfectuser21/zenithjoy-workspace';
const ANCESTOR = '0dc4e3c07ff19a0ac95440723986bf3cb78580b2';
const DESCENDANT = '7629efe6cef4817a3498b8c10a8b2f8cfd9f31f8';

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
    const fetchFn = vi.fn(async () => jsonResponse(200, { status }));

    const result = await defaultCommitLineageResolver(
      { repo: REPO, ancestor: ANCESTOR, descendant: DESCENDANT },
      { fetchFn, resolveToken: async () => 'token' },
    );

    expect(result).toEqual({ is_ancestor: expected });
    expect(fetchFn).toHaveBeenCalledWith(
      `https://api.github.com/repos/${REPO}/compare/${ANCESTOR}...${DESCENDANT}`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token',
        }),
      }),
    );
  });

  it('throws so the caller can fail closed when GitHub rejects the compare', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(502, {}));

    await expect(defaultCommitLineageResolver(
      { repo: REPO, ancestor: ANCESTOR, descendant: DESCENDANT },
      { fetchFn, resolveToken: async () => 'token' },
    )).rejects.toThrow('github_commit_compare_http_502');
  });

  it.each([
    { repo: 'not-a-repo', ancestor: ANCESTOR, descendant: DESCENDANT },
    { repo: REPO, ancestor: 'HEAD', descendant: DESCENDANT },
    { repo: REPO, ancestor: ANCESTOR, descendant: 'origin/main' },
  ])('rejects uncanonical lineage inputs before touching the network', async (input) => {
    const fetchFn = vi.fn();

    await expect(defaultCommitLineageResolver(input, {
      fetchFn,
      resolveToken: async () => 'token',
    })).rejects.toThrow('commit_lineage_request_invalid');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
