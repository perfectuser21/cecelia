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
  it('事务次序:BEGIN → DELETE(带 repo 参数) → INSERT → COMMIT,返回 inserted 数', async () => {
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
    expect(calls[2].sql).toContain('DELETE FROM graph_edges');
    expect(calls[2].params).toEqual(['cecelia']);
    expect(calls[3].sql).toContain('INSERT INTO graph_edges');
    expect(calls[3].sql).toContain('source_revision');
    expect(calls[3].sql).toContain('scanner_version');
    expect(calls[3].params).toEqual(expect.arrayContaining(['abc123', 'graph-v3']));
    const header = calls.find((call) => call.sql.includes('INSERT INTO fact_snapshot_headers'));
    expect(header.sql).toContain('ON CONFLICT (kind, repo)');
    expect(header.params).toEqual(['graph', 'cecelia', 'abc123', 'graph-v3', 2]);
    expect(calls[calls.length - 1].sql).toContain('COMMIT');
    expect(client.release).toHaveBeenCalled();
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
