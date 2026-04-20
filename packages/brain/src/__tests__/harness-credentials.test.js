import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveGitHubToken } from '../harness-credentials.js';

describe('resolveGitHubToken', () => {
  const origEnv = process.env.GITHUB_TOKEN;

  beforeEach(() => {
    delete process.env.GITHUB_TOKEN;
    vi.resetModules();
  });

  afterEach(() => {
    if (origEnv !== undefined) process.env.GITHUB_TOKEN = origEnv;
    else delete process.env.GITHUB_TOKEN;
    vi.restoreAllMocks();
  });

  it('prefers process.env.GITHUB_TOKEN when non-empty', async () => {
    process.env.GITHUB_TOKEN = 'ghs_fromEnv';
    const token = await resolveGitHubToken({ execFn: async () => 'ghs_fromGh', readFileFn: async () => 'GITHUB_TOKEN=ghs_fromFile\n' });
    expect(token).toBe('ghs_fromEnv');
  });

  it('falls back to gh auth token when env missing', async () => {
    const token = await resolveGitHubToken({ execFn: async () => 'ghs_fromGh\n', readFileFn: async () => 'GITHUB_TOKEN=ghs_fromFile\n' });
    expect(token).toBe('ghs_fromGh');
  });

  it('falls back to credentials file when gh fails', async () => {
    const token = await resolveGitHubToken({
      execFn: async () => { throw new Error('gh not logged in'); },
      readFileFn: async () => 'GITHUB_TOKEN=ghs_fromFile\nOTHER=x\n',
    });
    expect(token).toBe('ghs_fromFile');
  });

  it('throws github_token_unavailable when all sources fail', async () => {
    await expect(resolveGitHubToken({
      execFn: async () => { throw new Error('no gh'); },
      readFileFn: async () => { throw new Error('no file'); },
    })).rejects.toThrow('github_token_unavailable');
  });

  it('treats empty env var as missing (not hit)', async () => {
    process.env.GITHUB_TOKEN = '';
    const token = await resolveGitHubToken({ execFn: async () => 'ghs_fromGh', readFileFn: async () => '' });
    expect(token).toBe('ghs_fromGh');
  });
});
