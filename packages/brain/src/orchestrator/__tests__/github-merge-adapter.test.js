import { describe, expect, it, vi } from 'vitest';

import { createGitHubMergeAdapter } from '../github-merge-adapter.js';

const PR_URL = 'https://github.com/perfectuser21/cecelia/pull/4400';
const HEAD_SHA = 'a'.repeat(40);

describe('GitHub merge adapter', () => {
  it('normalizes an exact PR observation without invoking a shell', async () => {
    const execFile = vi.fn(() => JSON.stringify({
      url: PR_URL,
      number: 4400,
      headRefName: 'cp-safe',
      headRefOid: HEAD_SHA,
      state: 'OPEN',
      mergeStateStatus: 'CLEAN',
      statusCheckRollup: [
        { name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' },
        { context: 'lint', state: 'SUCCESS' },
      ],
      files: [
        { path: 'packages/brain/src/orchestrator/merge-authority.js' },
        { path: 'packages/brain/src/orchestrator/merge-authority.js' },
        { path: 'apps/dashboard/src/App.jsx' },
      ],
      mergeCommit: null,
    }));
    const adapter = createGitHubMergeAdapter({ execFile });

    await expect(adapter.observePullRequest(PR_URL)).resolves.toEqual({
      url: PR_URL,
      repository: 'perfectuser21/cecelia',
      number: 4400,
      head_ref: 'cp-safe',
      head_sha: HEAD_SHA,
      state: 'OPEN',
      merge_state_status: 'CLEAN',
      ci: 'pass',
      merged: false,
      merge_commit_sha: null,
      changed_paths: [
        'apps/dashboard/src/App.jsx',
        'packages/brain/src/orchestrator/merge-authority.js',
      ],
    });
    expect(execFile).toHaveBeenCalledWith('gh', [
      'pr',
      'view',
      PR_URL,
      '--json',
      expect.stringContaining('headRefOid'),
    ]);
    expect(execFile.mock.calls[0][1].at(-1)).toContain('files');
  });

  it('fails closed for no checks, failed checks, and a mismatched returned URL', async () => {
    const response = {
      url: PR_URL,
      number: 4400,
      headRefName: 'cp-safe',
      headRefOid: HEAD_SHA,
      state: 'OPEN',
      mergeStateStatus: 'CLEAN',
      statusCheckRollup: [],
      files: [{ path: 'apps/dashboard/src/App.jsx' }],
      mergeCommit: null,
    };
    const execFile = vi.fn(() => JSON.stringify(response));
    const adapter = createGitHubMergeAdapter({ execFile });

    await expect(adapter.observePullRequest(PR_URL)).resolves.toMatchObject({ ci: 'pending' });

    response.statusCheckRollup = [{ name: 'test', conclusion: 'CANCELLED' }];
    await expect(adapter.observePullRequest(PR_URL)).resolves.toMatchObject({ ci: 'fail' });

    response.statusCheckRollup = [{ name: 'test', conclusion: 'SKIPPED' }];
    await expect(adapter.observePullRequest(PR_URL)).resolves.toMatchObject({ ci: 'pending' });

    response.statusCheckRollup = [{ name: 'test', conclusion: 'NEUTRAL' }];
    await expect(adapter.observePullRequest(PR_URL)).resolves.toMatchObject({ ci: 'pending' });

    response.url = 'https://github.com/perfectuser21/cecelia/pull/4401';
    await expect(adapter.observePullRequest(PR_URL)).rejects.toThrow('github_pr_identity_mismatch');
  });

  it.each([
    [undefined],
    [[]],
    [[{ path: '' }]],
    [[{ path: '../outside' }]],
    [[{ path: 'safe\u0000unsafe' }]],
  ])('fails closed when changed files are absent or invalid: %j', async (files) => {
    const execFile = vi.fn(() => JSON.stringify({
      url: PR_URL,
      number: 4400,
      headRefName: 'cp-safe',
      headRefOid: HEAD_SHA,
      state: 'OPEN',
      mergeStateStatus: 'CLEAN',
      statusCheckRollup: [{ conclusion: 'SUCCESS' }],
      files,
      mergeCommit: null,
    }));
    const adapter = createGitHubMergeAdapter({ execFile });

    await expect(adapter.observePullRequest(PR_URL)).rejects.toThrow(
      'github_pr_files_invalid',
    );
  });

  it('merges with an exact head fence through argv, never a command string', async () => {
    const execFile = vi.fn(() => '');
    const adapter = createGitHubMergeAdapter({ execFile });

    await adapter.mergePullRequest({
      pr_url: PR_URL,
      expected_head_sha: HEAD_SHA,
      method: 'squash',
    });

    expect(execFile).toHaveBeenCalledWith('gh', [
      'pr',
      'merge',
      PR_URL,
      '--squash',
      '--delete-branch',
      '--match-head-commit',
      HEAD_SHA,
    ]);
  });
});
