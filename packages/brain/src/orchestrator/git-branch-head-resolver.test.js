import { describe, expect, it, vi } from 'vitest';

import { defaultGitBranchHeadResolver } from './git-branch-head-resolver.js';

describe('defaultGitBranchHeadResolver', () => {
  it('cross-checks the exact public branch head and artifact path', async () => {
    const sha = 'a'.repeat(40);
    const execute = vi.fn().mockResolvedValueOnce({
      stdout: `${sha}\trefs/heads/cp-harness-prd-aaaaaaaa-a2\n`,
    });
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200 }));
    const resolveToken = vi.fn(async () => 'github-secret');

    await expect(defaultGitBranchHeadResolver({
      repo: 'perfectuser21/zenithjoy-workspace',
      branch: 'cp-harness-prd-aaaaaaaa-a2',
      path: 'sprints/kernel real/sprint-prd.md',
    }, {
      execute,
      fetchFn,
      resolveToken,
    })).resolves.toEqual({
      head_sha: sha,
      path_exists: true,
    });

    expect(execute.mock.calls[0][1]).toEqual([
      'ls-remote',
      '--exit-code',
      'https://github.com/perfectuser21/zenithjoy-workspace.git',
      'refs/heads/cp-harness-prd-aaaaaaaa-a2',
    ]);
    expect(fetchFn).toHaveBeenCalledWith(
      `https://api.github.com/repos/perfectuser21/zenithjoy-workspace/contents/sprints/kernel%20real/sprint-prd.md?ref=${sha}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: 'Bearer github-secret',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: expect.any(AbortSignal),
      },
    );
  });
});
