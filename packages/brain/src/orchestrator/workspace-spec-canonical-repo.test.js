import { describe, expect, it } from 'vitest';
import { createWorkspaceSpecResolver } from './workspace-spec.js';

const BASE_SHA = '0123456789abcdef0123456789abcdef01234567';
const resolve = (payload) => createWorkspaceSpecResolver({
  resolveRepoHead: async () => BASE_SHA,
})({
  action: 'spawn:generator', role: 'generator', readOnly: false,
  attemptId: '22222222-2222-4222-8222-222222222222',
  ctx: { runId: '11111111-1111-4111-8111-111111111111', observed: { task: { payload } } },
  bundle: { inputs: {} },
});

describe('canonical task repository identity', () => {
  it.each([
    ['cecelia', 'perfectuser21/cecelia'],
    ['zenithjoy-workspace', 'perfectuser21/zenithjoy-workspace'],
    ['perfectuser21/cecelia', 'perfectuser21/cecelia'],
    ['perfectuser21/zenithjoy-workspace', 'perfectuser21/zenithjoy-workspace'],
  ])('resolves canonical repo %s without a legacy alias', async (repo, expected) => {
    expect(await resolve({ repo })).toMatchObject({ repo: expected });
  });

  it('retains the repository default for tasks without either field', async () => {
    expect(await resolve({})).toMatchObject({ repo: 'perfectuser21/cecelia' });
  });

  it.each([
    'cecelia', 'perfectuser21/cecelia',
    'https://github.com/perfectuser21/cecelia.git',
    '/Users/administrator/perfect21/cecelia',
  ])('retains supported legacy base_repo %s', async (base_repo) => {
    expect(await resolve({ base_repo })).toMatchObject({ repo: 'perfectuser21/cecelia' });
  });

  it('accepts matching canonical and normalized legacy identities', async () => {
    expect(await resolve({ repo: 'zenithjoy-workspace', base_repo: 'zenithjoy' }))
      .toMatchObject({ repo: 'perfectuser21/zenithjoy-workspace' });
  });

  it.each([
    ['zenithjoy-workspace', 'cecelia'],
    ['cecelia', 'https://github.com/perfectuser21/zenithjoy-workspace.git'],
  ])('rejects conflicting repo %s and base_repo %s', async (repo, base_repo) => {
    await expect(resolve({ repo, base_repo })).rejects.toThrow('workspace_repo_conflict');
  });

  it.each([
    null, undefined, '', ' ', 1, false, [], {}, 'zenithjoy',
    'other/cecelia', '/tmp/cecelia', 'cecelia-unknown',
    'https://github.com/perfectuser21/cecelia.git',
    'perfectuser21/cecelia/extra',
  ])('rejects an invalid canonical identity %j even with valid legacy input', async (repo) => {
    await expect(resolve({ repo, base_repo: 'cecelia' }))
      .rejects.toThrow('workspace_repo_not_supported');
  });

  it.each([null, undefined, '', ' ', 1, false, [], {}, 'other/unknown'])
    ('rejects an invalid explicit legacy identity %j', async (base_repo) => {
      await expect(resolve({ repo: 'cecelia', base_repo }))
        .rejects.toThrow('workspace_repo_not_supported');
    });

  it.each([
    'other/cecelia', 'other/zenithjoy-workspace', 'unknown-cecelia-repo',
    'https://evil.example/perfectuser21/cecelia',
    'https://github.com/other/cecelia.git',
    'https://github.com/other/zenithjoy-workspace.git',
    'https://github.com.evil.example/perfectuser21/cecelia',
    '/tmp/attacker/cecelia', '/tmp/unknown-cecelia-repo',
  ])('rejects legacy identities that merely contain a supported alias %s', async (base_repo) => {
    await expect(resolve({ base_repo })).rejects.toThrow('workspace_repo_not_supported');
  });
});
