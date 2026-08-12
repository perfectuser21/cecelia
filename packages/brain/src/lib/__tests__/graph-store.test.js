import { describe, it, expect, vi } from 'vitest';
import { replaceRepoEdges } from '../graph-store.js';

function mockPool() {
  const calls = [];
  const client = {
    query: vi.fn(async (sql, params) => { calls.push({ sql: String(sql), params }); return { rows: [] }; }),
    release: vi.fn(),
  };
  return { pool: { connect: async () => client }, client, calls };
}

describe('replaceRepoEdges', () => {
  it('同时写 live graph 与 revision-indexed immutable snapshot', async () => {
    const { pool, calls, client } = mockPool();
    const edges = [
      { src_path: 'a.js', dst_path: 'b.js', edge_type: 'import', detail: { via: 'import' } },
      { src_path: 'a.js', dst_path: 'cmd:git', edge_type: 'spawn', detail: { line: 3, via: 'execSync' } },
    ];
    const r = await replaceRepoEdges(pool, 'cecelia', edges, {
      sourceRevision: 'abc123', scannerVersion: 'graph-v3',
    });
    expect(r.inserted).toBe(2);
    expect(calls[0].sql).toContain('BEGIN');
    expect(calls[1].sql).toMatch(/pg_advisory_xact_lock/);
    expect(calls[1].params).toEqual(['fact-snapshot:graph_edges:cecelia']);
    expect(calls.some(call => call.sql.includes('INSERT INTO graph_edge_snapshots'))).toBe(true);
    expect(calls.some(call => call.sql.includes('INSERT INTO graph_snapshot_versions'))).toBe(true);
    const liveDelete = calls.find(call => call.sql.includes('DELETE FROM graph_edges'));
    expect(liveDelete.params).toEqual(['cecelia']);
    const liveInsert = calls.find(call => call.sql.includes('INSERT INTO graph_edges'));
    expect(liveInsert.params).toEqual(expect.arrayContaining(['abc123', 'graph-v3']));
    const header = calls.find((call) => call.sql.includes('INSERT INTO fact_snapshot_headers'));
    expect(header.sql).toContain('ON CONFLICT (kind, repo)');
    expect(header.params).toEqual(['graph', 'cecelia', 'abc123', 'graph-v3', 2]);
    expect(calls[calls.length - 1].sql).toContain('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  it('同一 repo/revision 已有不同边时拒绝覆盖 immutable snapshot', async () => {
    const { pool, client } = mockPool();
    client.query.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('FROM graph_snapshot_versions')) return { rows: [{ row_count: 1 }] };
      if (text.includes('FROM graph_edge_snapshots')) return { rows: [{
        src_path: 'old.js', dst_path: 'target.js', edge_type: 'import', detail: {},
      }] };
      return { rows: [] };
    });
    await expect(replaceRepoEdges(pool, 'cecelia', [{
      src_path: 'new.js', dst_path: 'target.js', edge_type: 'import', detail: {},
    }], { sourceRevision: 'a'.repeat(40), scannerVersion: 'graph-v3' }))
      .rejects.toMatchObject({ code: 'GRAPH_SNAPSHOT_IMMUTABILITY_VIOLATION' });
  });

  it('INSERT 抛错 → ROLLBACK 且 rethrow,client 释放', async () => {
    const { pool, calls, client } = mockPool();
    client.query.mockImplementation(async (sql) => {
      calls.push({ sql: String(sql) });
      if (String(sql).includes('INSERT')) throw new Error('boom');
      return { rows: [] };
    });
    await expect(replaceRepoEdges(pool, 'cecelia', [{ src_path: 'a', dst_path: 'b', edge_type: 'import', detail: {} }])).rejects.toThrow('boom');
    expect(calls[calls.length - 1].sql).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  it('空边数组:仍清空该 repo 并提交(全量替换语义,扫描出零边=真相就是零边)', async () => {
    const { pool, calls } = mockPool();
    const r = await replaceRepoEdges(pool, 'cecelia', []);
    expect(r.inserted).toBe(0);
    expect(calls.some((c) => c.sql.includes('DELETE'))).toBe(true);
    const header = calls.find((c) => c.sql.includes('INSERT INTO fact_snapshot_headers'));
    expect(header.params).toEqual(['graph', 'cecelia', 'legacy-unknown', 'legacy', 0]);
    expect(calls[calls.length - 1].sql).toContain('COMMIT');
  });

  it('不同 repo 使用不同且参数化的 graph 锁键', async () => {
    const first = mockPool();
    const second = mockPool();
    await replaceRepoEdges(first.pool, 'repo-a', []);
    await replaceRepoEdges(second.pool, 'repo-b', []);

    const firstLock = first.calls.find(({ sql }) => /pg_advisory_xact_lock/.test(sql));
    const secondLock = second.calls.find(({ sql }) => /pg_advisory_xact_lock/.test(sql));
    expect(firstLock.params).toEqual(['fact-snapshot:graph_edges:repo-a']);
    expect(secondLock.params).toEqual(['fact-snapshot:graph_edges:repo-b']);
    expect(firstLock.sql).not.toContain('repo-a');
    expect(secondLock.sql).not.toContain('repo-b');
  });
});
