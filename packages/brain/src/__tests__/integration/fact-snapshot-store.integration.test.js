import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { replaceFactSnapshot } from '../../lib/fact-snapshot-store.js';

const connectionString = process.env.TEST_DATABASE_URL || 'postgresql://localhost/cecelia_test';
const databaseName = decodeURIComponent(new URL(connectionString).pathname.slice(1));
if (!/(_test|_scratch)$/.test(databaseName)) {
  throw new Error(`fact snapshot 集成测试拒绝连接非测试库: ${databaseName}`);
}

const pool = new pg.Pool({ connectionString, max: 2 });
const REPO = `fact-snapshot-itest-${process.pid}`;
const CONCURRENT_REPO = `${REPO}-concurrent`;

function synchronizeTransactionBegins(...pools) {
  let begun = 0;
  let releaseBarrier;
  const barrier = new Promise((resolve) => { releaseBarrier = resolve; });

  return pools.map((sourcePool) => ({
    async connect() {
      const client = await sourcePool.connect();
      return {
        async query(sql, params) {
          const result = await client.query(sql, params);
          if (sql === 'BEGIN') {
            begun += 1;
            if (begun === pools.length) releaseBarrier();
            await barrier;
          }
          return result;
        },
        release() { client.release(); },
      };
    },
  }));
}

beforeAll(async () => {
  await pool.query('DELETE FROM api_registry WHERE repo = $1', [REPO]);
  await pool.query('DELETE FROM api_registry WHERE repo = $1', [CONCURRENT_REPO]);
  await pool.query('DELETE FROM test_registry WHERE repo = $1', [REPO]);
  await pool.query('DELETE FROM fact_snapshot_headers WHERE repo = ANY($1)', [[REPO, CONCURRENT_REPO]]);
});

afterAll(async () => {
  await pool.query('DELETE FROM api_registry WHERE repo = $1', [REPO]);
  await pool.query('DELETE FROM api_registry WHERE repo = $1', [CONCURRENT_REPO]);
  await pool.query('DELETE FROM test_registry WHERE repo = $1', [REPO]);
  await pool.query('DELETE FROM fact_snapshot_headers WHERE repo = ANY($1)', [[REPO, CONCURRENT_REPO]]);
  await pool.end();
});

describe('replaceFactSnapshot 真库合同', () => {
  it('第二张 API 快照会删除旧事实，并保留同键人工 annotation', async () => {
    await replaceFactSnapshot(pool, 'api', {
      repo: REPO, sourceRevision: 'rev-1', scannerVersion: 'api-registry-v2',
      rows: [
        { method: 'GET', path: '/kept', file_path: 'old.js', line_number: 1, area: 'old' },
        { method: 'POST', path: '/removed', file_path: 'removed.js', line_number: 2, area: 'old' },
      ],
    });
    await pool.query(
      `UPDATE api_registry
          SET description = 'human note', request_schema = '{"type":"object"}', response_schema = '{"ok":true}'
        WHERE repo = $1 AND method = 'GET' AND path = '/kept'`,
      [REPO],
    );

    await replaceFactSnapshot(pool, 'api', {
      repo: REPO, sourceRevision: 'rev-2', scannerVersion: 'api-registry-v2',
      rows: [{ method: 'GET', path: '/kept', file_path: 'new.js', line_number: 9, area: 'new' }],
    });

    const { rows } = await pool.query(
      `SELECT method, path, file_path, description, request_schema, response_schema,
              source_revision, scanner_version, scanned_at
         FROM api_registry WHERE repo = $1`,
      [REPO],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      method: 'GET', path: '/kept', file_path: 'new.js', description: 'human note',
      request_schema: { type: 'object' }, response_schema: { ok: true },
      source_revision: 'rev-2', scanner_version: 'api-registry-v2',
    });
    expect(rows[0].scanned_at).toBeInstanceOf(Date);
    const header = await pool.query(
      'SELECT source_revision, scanner_version, row_count FROM fact_snapshot_headers WHERE kind = $1 AND repo = $2',
      ['api', REPO],
    );
    expect(header.rows).toEqual([{
      source_revision: 'rev-2', scanner_version: 'api-registry-v2', row_count: 1,
    }]);
  });

  it('同路径 test 刷新保留生命周期 annotation，空快照随后清空该 repo', async () => {
    const featureId = '11111111-1111-4111-8111-111111111111';
    await replaceFactSnapshot(pool, 'test', {
      repo: REPO, sourceRevision: 'rev-1', scannerVersion: 'test-registry-v2',
      rows: [{ file_path: 'a.test.js', test_count: 1, covered_behaviors: ['old'], area: 'old', test_type: 'unit' }],
    });
    await pool.query(
      `UPDATE test_registry SET status = 'orphan', orphan_reason = 'feature_deleted',
              lifecycle_checked_at = NOW(), feature_id = $2
        WHERE repo = $1 AND file_path = 'a.test.js'`,
      [REPO, featureId],
    );
    await replaceFactSnapshot(pool, 'test', {
      repo: REPO, sourceRevision: 'rev-2', scannerVersion: 'test-registry-v2',
      rows: [{ file_path: 'a.test.js', test_count: 3, covered_behaviors: ['new'], area: 'new', test_type: 'integration' }],
    });

    const { rows } = await pool.query(
      `SELECT status, orphan_reason, lifecycle_checked_at, feature_id, test_count, source_revision
         FROM test_registry WHERE repo = $1`,
      [REPO],
    );
    expect(rows[0]).toMatchObject({
      status: 'orphan', orphan_reason: 'feature_deleted', feature_id: featureId,
      test_count: 3, source_revision: 'rev-2',
    });
    expect(rows[0].lifecycle_checked_at).toBeInstanceOf(Date);

    await replaceFactSnapshot(pool, 'test', {
      repo: REPO, sourceRevision: 'rev-3', scannerVersion: 'test-registry-v2', rows: [],
    });
    const count = await pool.query('SELECT count(*)::int AS count FROM test_registry WHERE repo = $1', [REPO]);
    expect(count.rows[0].count).toBe(0);
  });

  it('失败快照回滚后上一张 API 快照完整保留', async () => {
    await replaceFactSnapshot(pool, 'api', {
      repo: REPO, sourceRevision: 'stable-rev', scannerVersion: 'api-registry-v2',
      rows: [{ method: 'GET', path: '/stable', file_path: 'stable.js', line_number: 1, area: 'stable' }],
    });

    await expect(replaceFactSnapshot(pool, 'api', {
      repo: REPO, sourceRevision: 'bad-rev', scannerVersion: 'api-registry-v2',
      rows: [{ method: 'INVALID', path: '/bad', file_path: 'bad.js', line_number: 1, area: 'bad' }],
    })).rejects.toThrow();

    const { rows } = await pool.query(
      'SELECT method, path, source_revision FROM api_registry WHERE repo = $1', [REPO],
    );
    expect(rows).toEqual([{ method: 'GET', path: '/stable', source_revision: 'stable-rev' }]);
    const header = await pool.query(
      'SELECT source_revision, row_count FROM fact_snapshot_headers WHERE kind = $1 AND repo = $2',
      ['api', REPO],
    );
    expect(header.rows).toEqual([{ source_revision: 'stable-rev', row_count: 1 }]);
  });

  it('双连接并发替换同 repo 时最终事实严格等于完整 A 或完整 B', async () => {
    const leftPool = new pg.Pool({ connectionString, max: 1 });
    const rightPool = new pg.Pool({ connectionString, max: 1 });
    const [left, right] = synchronizeTransactionBegins(leftPool, rightPool);
    const pathsA = ['/concurrent/a-1', '/concurrent/a-2', '/concurrent/a-3'];
    const pathsB = ['/concurrent/b-1', '/concurrent/b-2', '/concurrent/b-3'];
    const snapshot = (revision, paths) => ({
      repo: CONCURRENT_REPO,
      sourceRevision: revision,
      scannerVersion: 'api-registry-v2',
      rows: paths.map((path, index) => ({
        method: 'GET', path, file_path: `${revision}-${index}.js`, line_number: index + 1, area: 'test',
      })),
    });

    try {
      await Promise.all([
        replaceFactSnapshot(left, 'api', snapshot('revision-a', pathsA)),
        replaceFactSnapshot(right, 'api', snapshot('revision-b', pathsB)),
      ]);

      const { rows } = await pool.query(
        'SELECT path FROM api_registry WHERE repo = $1 ORDER BY path', [CONCURRENT_REPO],
      );
      const finalPaths = rows.map(({ path }) => path);
      expect([pathsA, pathsB]).toContainEqual(finalPaths);
      const { rows: headers } = await pool.query(
        'SELECT source_revision, row_count FROM fact_snapshot_headers WHERE kind = $1 AND repo = $2',
        ['api', CONCURRENT_REPO],
      );
      const expectedRevision = finalPaths[0].includes('/a-') ? 'revision-a' : 'revision-b';
      expect(headers).toEqual([{ source_revision: expectedRevision, row_count: 3 }]);
    } finally {
      await pool.query('DELETE FROM api_registry WHERE repo = $1', [CONCURRENT_REPO]);
      await Promise.all([leftPool.end(), rightPool.end()]);
    }
  });
});
