import { afterEach, describe, expect, it } from 'vitest';

import {
  discoverPrFromGithub,
  parseBaseRepo,
} from '../github-pr-discovery.js';

const ORIGINAL_REPO_MAP = process.env.HARNESS_REPO_MAP;

afterEach(() => {
  if (ORIGINAL_REPO_MAP === undefined) delete process.env.HARNESS_REPO_MAP;
  else process.env.HARNESS_REPO_MAP = ORIGINAL_REPO_MAP;
});

describe('github-pr-discovery', () => {
  it('normalizes GitHub URLs and configured workspace aliases', () => {
    process.env.HARNESS_REPO_MAP = JSON.stringify({ custom: 'owner/custom-repo' });

    expect(parseBaseRepo('https://github.com/owner/repo.git')).toBe('owner/repo');
    expect(parseBaseRepo('/srv/custom/worktree')).toBe('owner/custom-repo');
    expect(parseBaseRepo('/workspace')).toBe('perfectuser21/cecelia');
    expect(parseBaseRepo(null)).toBeNull();
  });

  it('queries the resolved repo and prefers a merged matching PR over an open one', () => {
    let command = '';
    const execFn = (value) => {
      command = value;
      return JSON.stringify([
        { headRefName: 'cp-feature-abc12345', title: 'open', url: 'open-url', state: 'OPEN' },
        { headRefName: 'other', title: '[abc12345] merged', url: 'merged-url', state: 'MERGED' },
      ]);
    };

    const result = discoverPrFromGithub(
      { payload: { base_repo: 'https://github.com/owner/repo.git' } },
      'abc12345',
      execFn,
    );

    expect(command).toContain('gh pr list --repo "owner/repo"');
    expect(result).toMatchObject({ url: 'merged-url', state: 'MERGED' });
  });

  it('discovers PRs for tasks created by the unified router repo field', () => {
    let command = '';
    const execFn = (value) => {
      command = value;
      return JSON.stringify([
        { headRefName: 'cp-route-abc12345', title: 'open', url: 'open-url', state: 'OPEN' },
      ]);
    };

    const result = discoverPrFromGithub(
      { payload: { repo: 'cecelia' } },
      'abc12345',
      execFn,
    );

    expect(command).toContain('gh pr list --repo "perfectuser21/cecelia"');
    expect(result).toMatchObject({ url: 'open-url', state: 'OPEN' });
  });
});
