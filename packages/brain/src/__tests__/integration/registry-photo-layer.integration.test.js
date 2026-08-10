import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { listPhotoLayer } from '../../lib/registry-photo-layer.js';
import { replaceFactSnapshot } from '../../lib/fact-snapshot-store.js';

const connectionString = process.env.TEST_DATABASE_URL || 'postgresql://localhost/cecelia_test';
const databaseName = decodeURIComponent(new URL(connectionString).pathname.slice(1));
if (!/(_test|_scratch)$/.test(databaseName)) {
  throw new Error(`registry photo layer 集成测试拒绝连接非测试库: ${databaseName}`);
}

const pool = new pg.Pool({ connectionString, max: 3 });
const MARK = `itest-photo-layer-${process.pid}`;
const REPO_A = `${MARK}-a`;
const REPO_B = `${MARK}-b`;
const STALE_REPO = `${MARK}-stale`;
const LEGACY_REPO = `${MARK}-legacy`;
const EMPTY_REPO = `${MARK}-empty`;
const CONSISTENT_REPO = `${MARK}-consistent`;
const TEST_REPOS = [REPO_A, REPO_B, STALE_REPO, LEGACY_REPO, EMPTY_REPO, CONSISTENT_REPO];
const REVISION_A = 'a'.repeat(40);
const REVISION_B = 'b'.repeat(40);
const REVISION_STALE = 'c'.repeat(40);

function pauseAfterFactsRead(sourcePool, afterFactsRead) {
  let paused = false;
  const query = async (client, sql, params) => {
    const result = await client.query(sql, params);
    if (!paused && /FROM\s+api_registry/i.test(String(sql))) {
      paused = true;
      await afterFactsRead();
    }
    return result;
  };
  return {
    query: (sql, params) => query(sourcePool, sql, params),
    async connect() {
      const client = await sourcePool.connect();
      return {
        query: (sql, params) => query(client, sql, params),
        release: () => client.release(),
      };
    },
  };
}

beforeAll(async () => {
  await pool.query('DELETE FROM api_registry WHERE repo = ANY($1)', [TEST_REPOS]);
  await pool.query(
    `INSERT INTO api_registry
       (repo, method, path, file_path, line_number, area, scanned_at, source_revision, scanner_version)
     VALUES
       ($1, 'GET', '/itest/a-1', $5, 1, 'test', NOW() - interval '14 minutes', $10, 'api-registry-v2'),
       ($1, 'POST', '/itest/a-2', $6, 2, 'test', NOW() - interval '14 minutes', $10, 'api-registry-v2'),
       ($2, 'GET', '/itest/b', $7, 3, 'test', NOW(), $11, 'api-registry-v2'),
       ($3, 'GET', '/itest/stale', $8, 4, 'test', NOW() - interval '16 minutes', $12, 'api-registry-v2'),
       ($4, 'GET', '/itest/legacy', $9, 5, 'test', NOW(), 'legacy-unknown', 'legacy')`,
    [
      REPO_A, REPO_B, STALE_REPO, LEGACY_REPO,
      `${MARK}/a-1.js`, `${MARK}/a-2.js`, `${MARK}/b.js`, `${MARK}/stale.js`, `${MARK}/legacy.js`,
      REVISION_A, REVISION_B, REVISION_STALE,
    ],
  );
  await pool.query(
    `INSERT INTO fact_snapshot_headers
       (kind, repo, source_revision, scanner_version, scanned_at, row_count)
     VALUES
       ('api', $1, $5, 'api-registry-v2', NOW() - interval '14 minutes', 2),
       ('api', $2, $6, 'api-registry-v2', NOW(), 1),
       ('api', $3, $7, 'api-registry-v2', NOW() - interval '16 minutes', 1),
       ('api', $4, 'legacy-unknown', 'legacy', NOW(), 1)
     ON CONFLICT (kind, repo) DO UPDATE SET
       source_revision = EXCLUDED.source_revision,
       scanner_version = EXCLUDED.scanner_version,
       scanned_at = EXCLUDED.scanned_at,
       row_count = EXCLUDED.row_count`,
    [REPO_A, REPO_B, STALE_REPO, LEGACY_REPO, REVISION_A, REVISION_B, REVISION_STALE],
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM api_registry WHERE repo = ANY($1)', [TEST_REPOS]);
  await pool.query('DELETE FROM fact_snapshot_headers WHERE repo = ANY($1)', [TEST_REPOS]);
  await pool.end();
});

describe('照相层真库查询', () => {
  it('items 与 latest metadata 严格按 repo，较新的 repo-B 不掩盖 repo-A', async () => {
    const r = await listPhotoLayer(pool, 'api', { repo: REPO_A, search: MARK });
    expect(r.items.length).toBe(2);
    expect(r.items.every((item) => item.repo === REPO_A)).toBe(true);
    expect(r.items.every((item) => item.source_revision === REVISION_A)).toBe(true);
    expect(r).toMatchObject({
      repo: REPO_A, source_revision: REVISION_A, scanner_version: 'api-registry-v2',
    });
    expect(r.freshness).toMatchObject({
      repo: REPO_A, status: 'fresh', reason_code: null,
      source_revision: REVISION_A, scanner_version: 'api-registry-v2',
    });
    expect(r.freshness.last_success_at).toBeTruthy();
  });

  it('db_schema 真表可查(至少含本库真实表)', async () => {
    const r = await listPhotoLayer(pool, 'db_schema', { repo: 'cecelia', limit: 5 });
    expect(Array.isArray(r.items)).toBe(true);
    expect(r.freshness).toHaveProperty('latest_scan');
  });

  it('16min snapshot 与 legacy revision 都 fail-closed 且 reason_code 可区分', async () => {
    const stale = await listPhotoLayer(pool, 'api', { repo: STALE_REPO });
    expect(stale.freshness).toMatchObject({ status: 'unknown', reason_code: 'snapshot_stale' });

    const legacy = await listPhotoLayer(pool, 'api', { repo: LEGACY_REPO });
    expect(legacy.freshness).toMatchObject({ status: 'unknown', reason_code: 'source_revision_legacy' });
  });

  it('空事实快照仍由 header 表示一次 fresh 成功扫描，row_count=0', async () => {
    await replaceFactSnapshot(pool, 'api', {
      repo: EMPTY_REPO, sourceRevision: REVISION_A, scannerVersion: 'api-registry-v2', rows: [],
    });
    const result = await listPhotoLayer(pool, 'api', { repo: EMPTY_REPO });
    expect(result.items).toEqual([]);
    expect(result).toMatchObject({ repo: EMPTY_REPO, row_count: 0 });
    expect(result.freshness).toMatchObject({
      repo: EMPTY_REPO, status: 'fresh', stale: false, row_count: 0,
      source_revision: REVISION_A, scanner_version: 'api-registry-v2',
    });
  });

  it('并发提交新快照时 items 与 header 仍来自同一 REPEATABLE READ revision', async () => {
    await replaceFactSnapshot(pool, 'api', {
      repo: CONSISTENT_REPO, sourceRevision: REVISION_A, scannerVersion: 'api-registry-v2',
      rows: [{ method: 'GET', path: '/snapshot-a', file_path: 'a.js', line_number: 1, area: 'test' }],
    });
    const writerPool = new pg.Pool({ connectionString, max: 1 });
    const readerPool = new pg.Pool({ connectionString, max: 1 });
    try {
      const interleavingPool = pauseAfterFactsRead(readerPool, () => replaceFactSnapshot(writerPool, 'api', {
        repo: CONSISTENT_REPO, sourceRevision: REVISION_B, scannerVersion: 'api-registry-v2',
        rows: [{ method: 'GET', path: '/snapshot-b', file_path: 'b.js', line_number: 1, area: 'test' }],
      }));
      const result = await listPhotoLayer(interleavingPool, 'api', { repo: CONSISTENT_REPO });
      expect(result.items.map((item) => item.name)).toEqual(['GET /snapshot-a']);
      expect(result.items[0].source_revision).toBe(REVISION_A);
      expect(result.freshness.source_revision).toBe(REVISION_A);
      expect(result.row_count).toBe(1);
    } finally {
      await Promise.all([writerPool.end(), readerPool.end()]);
    }
  });
});
