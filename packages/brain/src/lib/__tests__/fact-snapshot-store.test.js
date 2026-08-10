import { describe, expect, it, vi } from 'vitest';
import { replaceFactSnapshot } from '../fact-snapshot-store.js';

function mockPool({ failOn } = {}) {
  const calls = [];
  const client = {
    query: vi.fn(async (sql, params) => {
      const text = String(sql);
      calls.push({ sql: text, params });
      if (failOn && text.includes(failOn)) throw new Error('snapshot write failed');
      return { rows: [], rowCount: text.includes('DELETE') ? 1 : 0 };
    }),
    release: vi.fn(),
  };
  return { pool: { connect: vi.fn(async () => client) }, client, calls };
}

const metadata = {
  repo: 'cecelia',
  sourceRevision: 'abc123',
  scannerVersion: 'api-registry-v2',
};

describe('replaceFactSnapshot', () => {
  it('API 快照在同一事务中 upsert 当前事实并删除同 repo 消失的旧事实', async () => {
    const { pool, calls, client } = mockPool();

    const result = await replaceFactSnapshot(pool, 'api', {
      ...metadata,
      rows: [{ method: 'GET', path: '/health', file_path: 'server.js', line_number: 10, area: 'cecelia' }],
    });

    expect(calls[0].sql).toBe('BEGIN');
    const insert = calls.find((call) => call.sql.includes('INSERT INTO api_registry'));
    expect(insert.sql).toContain('repo, method, path');
    expect(insert.sql).toContain('source_revision');
    expect(insert.sql).toContain('scanner_version');
    expect(insert.sql).toContain('ON CONFLICT (repo, method, path)');
    expect(insert.sql).not.toMatch(/description\s*=/i);
    expect(insert.sql).not.toMatch(/request_schema\s*=/i);
    expect(insert.sql).not.toMatch(/response_schema\s*=/i);
    expect(insert.params).toEqual(expect.arrayContaining(['cecelia', 'abc123', 'api-registry-v2']));
    const deletion = calls.find((call) => call.sql.includes('DELETE FROM api_registry'));
    expect(deletion.params[0]).toBe('cecelia');
    expect(calls.at(-1).sql).toBe('COMMIT');
    expect(result).toEqual({ upserted: 1, deleted: 1 });
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('test 快照刷新只更新 scanner 事实列，保留生命周期 annotation', async () => {
    const { pool, calls } = mockPool();

    await replaceFactSnapshot(pool, 'test', {
      repo: 'cecelia',
      sourceRevision: 'def456',
      scannerVersion: 'test-registry-v2',
      rows: [{
        file_path: 'src/a.test.js', test_count: 2,
        covered_behaviors: ['a', 'b'], area: 'cecelia', test_type: 'unit',
      }],
    });

    const insert = calls.find((call) => call.sql.includes('INSERT INTO test_registry'));
    expect(insert.sql).toContain('ON CONFLICT (repo, file_path)');
    expect(insert.sql).not.toMatch(/status\s*=/i);
    expect(insert.sql).not.toMatch(/orphan_reason\s*=/i);
    expect(insert.sql).not.toMatch(/lifecycle_checked_at\s*=/i);
    expect(insert.sql).not.toMatch(/feature_id\s*=/i);
  });

  it('空 rows 是成功的空快照，会删除该 repo 全部旧事实', async () => {
    const { pool, calls } = mockPool();

    const result = await replaceFactSnapshot(pool, 'db_schema', {
      repo: 'cecelia', sourceRevision: '789abc', scannerVersion: 'db-schema-v2', rows: [],
    });

    expect(calls.map((call) => call.sql)).toEqual([
      'BEGIN',
      expect.stringContaining('DELETE FROM db_schema_registry WHERE repo = $1'),
      'COMMIT',
    ]);
    expect(result).toEqual({ upserted: 0, deleted: 1 });
  });

  it('任一步失败都会 ROLLBACK 并 rethrow，不提交半张快照', async () => {
    const { pool, calls, client } = mockPool({ failOn: 'DELETE FROM api_registry' });

    await expect(replaceFactSnapshot(pool, 'api', {
      ...metadata,
      rows: [{ method: 'GET', path: '/boom', file_path: 'boom.js', line_number: 1, area: 'cecelia' }],
    })).rejects.toThrow('snapshot write failed');

    expect(calls.at(-1).sql).toBe('ROLLBACK');
    expect(calls.some((call) => call.sql === 'COMMIT')).toBe(false);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('拒绝未知 kind 和空 metadata，不打开事务', async () => {
    const { pool } = mockPool();

    await expect(replaceFactSnapshot(pool, 'graph', { ...metadata, rows: [] }))
      .rejects.toThrow(/kind/i);
    await expect(replaceFactSnapshot(pool, 'api', { ...metadata, sourceRevision: '', rows: [] }))
      .rejects.toThrow(/sourceRevision/i);
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
