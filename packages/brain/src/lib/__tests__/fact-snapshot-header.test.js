import { describe, expect, it, vi } from 'vitest';
import { readFactSnapshotHeader, upsertFactSnapshotHeader } from '../fact-snapshot-header.js';

describe('fact-snapshot-header', () => {
  it('以 kind/repo 复合键写入完整 provenance 与真实行数', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) };

    await upsertFactSnapshotHeader(client, 'api', {
      repo: 'cecelia',
      sourceRevision: 'a'.repeat(40),
      scannerVersion: 'api-registry-v2',
      rowCount: 763,
    });

    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain('ON CONFLICT (kind, repo)');
    expect(sql).toContain('scanned_at = EXCLUDED.scanned_at');
    expect(params).toEqual(['api', 'cecelia', 'a'.repeat(40), 'api-registry-v2', 763]);
  });

  it('未知 kind fail closed，且不发 SQL', async () => {
    const client = { query: vi.fn() };
    await expect(upsertFactSnapshotHeader(client, 'unknown', {
      repo: 'cecelia', sourceRevision: 'a'.repeat(40), scannerVersion: 'scanner-v1', rowCount: 0,
    })).rejects.toThrow('unsupported snapshot header kind');
    expect(client.query).not.toHaveBeenCalled();
  });

  it('按 kind/repo 读取同一 header；不存在时返回 null', async () => {
    const header = { kind: 'graph', repo: 'cecelia', row_count: 12 };
    const client = { query: vi.fn()
      .mockResolvedValueOnce({ rows: [header] })
      .mockResolvedValueOnce({ rows: [] }) };

    await expect(readFactSnapshotHeader(client, 'graph', 'cecelia')).resolves.toBe(header);
    await expect(readFactSnapshotHeader(client, 'graph', 'missing')).resolves.toBeNull();
    expect(client.query.mock.calls[0][1]).toEqual(['graph', 'cecelia']);
  });
});
