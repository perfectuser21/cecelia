import { describe, expect, it, vi } from 'vitest';
import { acquireFactSnapshotLock } from '../fact-snapshot-lock.js';

describe('acquireFactSnapshotLock', () => {
  it('使用参数化、按 namespace/repo 隔离的事务锁键', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) };

    await acquireFactSnapshotLock(client, 'api', 'cecelia');
    await acquireFactSnapshotLock(client, 'graph_edges', 'zenithjoy-workspace');

    expect(client.query.mock.calls).toEqual([
      ['SELECT pg_advisory_xact_lock(hashtext($1::text))', ['fact-snapshot:api:cecelia']],
      ['SELECT pg_advisory_xact_lock(hashtext($1::text))', ['fact-snapshot:graph_edges:zenithjoy-workspace']],
    ]);
  });

  it('锁获取失败向上抛出，调用方事务负责回滚', async () => {
    const client = { query: vi.fn().mockRejectedValue(new Error('lock failed')) };
    await expect(acquireFactSnapshotLock(client, 'test', 'cecelia')).rejects.toThrow('lock failed');
  });
});
