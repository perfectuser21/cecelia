import { describe, expect, it, vi } from 'vitest';

import { loadMapRepoAdapters } from '../map-repo-adapter.js';

describe('loadMapRepoAdapters', () => {
  it('只读取 scope 的显式 repo adapter，并按 repo 稳定排序', async () => {
    const client = {
      query: vi.fn(async () => ({
        rows: [
          { scope_key: 'cecelia', repo: 'zenithjoy-workspace', adapter_key: 'registry-v1' },
          { scope_key: 'cecelia', repo: 'cecelia', adapter_key: 'legacy-ledger-v1' },
        ],
      })),
    };

    await expect(loadMapRepoAdapters(client, 'cecelia')).resolves.toEqual([
      { scope_key: 'cecelia', repo: 'cecelia', adapter_key: 'legacy-ledger-v1' },
      { scope_key: 'cecelia', repo: 'zenithjoy-workspace', adapter_key: 'registry-v1' },
    ]);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringMatching(/WHERE scope_key = \$1[\s\S]*ORDER BY repo ASC/i),
      ['cecelia'],
    );
  });

  it('未配置 scope 时 fail closed，不使用 scope_key 同名 repo fallback', async () => {
    const client = { query: vi.fn(async () => ({ rows: [] })) };

    await expect(loadMapRepoAdapters(client, 'unconfigured-repo')).rejects.toMatchObject({
      code: 'MAP_REPO_ADAPTER_NOT_CONFIGURED',
      details: { scope_key: 'unconfigured-repo' },
    });
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it('拒绝无效 client 与空 scope', async () => {
    await expect(loadMapRepoAdapters({}, 'cecelia')).rejects.toMatchObject({
      code: 'MAP_REPO_ADAPTER_CLIENT_INVALID',
    });
    await expect(loadMapRepoAdapters({ query: vi.fn() }, '  ')).rejects.toMatchObject({
      code: 'MAP_REPO_ADAPTER_SCOPE_INVALID',
    });
  });
});
