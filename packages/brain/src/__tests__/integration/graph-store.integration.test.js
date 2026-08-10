import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';
import { replaceRepoEdges } from '../../lib/graph-store.js';
import { loadGraphContext } from '../../routes/graph.js';
import { resolveTestDatabaseUrl } from '../../../tests/helpers/test-database-url.js';

const connectionString = resolveTestDatabaseUrl();
const pool = new pg.Pool({ connectionString, max: 3 });
const REPO = 'itest-graph-repo';
const CONCURRENT_REPO = `itest-graph-concurrent-${process.pid}`;
const EMPTY_REPO = `itest-graph-empty-${process.pid}`;
const CONSISTENT_REPO = `itest-graph-consistent-${process.pid}`;
const REVISION_A = 'd'.repeat(40);
const REVISION_B = 'e'.repeat(40);

function pauseAfterEdgesRead(sourcePool, afterEdgesRead) {
  let paused = false;
  const query = async (client, sql, params) => {
    const result = await client.query(sql, params);
    if (!paused && /FROM\s+graph_edges/i.test(String(sql)) && /src_path/i.test(String(sql))) {
      paused = true;
      await afterEdgesRead();
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

afterAll(async () => {
  await pool.query('DELETE FROM graph_edges WHERE repo = $1', [REPO]);
  await pool.query('DELETE FROM graph_edges WHERE repo = $1', [CONCURRENT_REPO]);
  await pool.query('DELETE FROM graph_edges WHERE repo = ANY($1)', [[EMPTY_REPO, CONSISTENT_REPO]]);
  await pool.query('DELETE FROM fact_snapshot_headers WHERE kind = $1 AND repo = ANY($2)', [
    'graph', [REPO, CONCURRENT_REPO, EMPTY_REPO, CONSISTENT_REPO],
  ]);
  await pool.end();
});

describe('replaceRepoEdges 真库全量替换', () => {
  it('第二批写入后第一批消失,只剩第二批', async () => {
    await replaceRepoEdges(pool, REPO, [
      { src_path: 'old/a.js', dst_path: 'old/b.js', edge_type: 'import', detail: {} },
    ]);
    await replaceRepoEdges(pool, REPO, [
      { src_path: 'new/x.js', dst_path: 'cmd:git', edge_type: 'spawn', detail: { line: 1, via: 'spawn' } },
      { src_path: 'new/x.js', dst_path: '/api/brain/tasks', edge_type: 'http', detail: { line: 2 } },
    ]);
    const { rows } = await pool.query('SELECT src_path, edge_type FROM graph_edges WHERE repo = $1 ORDER BY src_path', [REPO]);
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.src_path.startsWith('new/'))).toBe(true);
  });

  it('空边快照仍写入 fresh header，graph context 返回 row_count=0', async () => {
    await replaceRepoEdges(pool, EMPTY_REPO, [], {
      sourceRevision: REVISION_A, scannerVersion: 'graph-v3',
    });
    const context = await loadGraphContext(EMPTY_REPO, pool);
    expect([...context.nodeSet]).toEqual([]);
    expect(context.freshness).toMatchObject({
      repo: EMPTY_REPO, status: 'fresh', stale: false, row_count: 0,
      source_revision: REVISION_A, scanner_version: 'graph-v3',
    });
  });

  it('并发提交新图时 edges/features/header 来自同一 REPEATABLE READ revision', async () => {
    await replaceRepoEdges(pool, CONSISTENT_REPO, [
      { src_path: 'snapshot-a.js', dst_path: 'target-a.js', edge_type: 'import', detail: {} },
    ], { sourceRevision: REVISION_A, scannerVersion: 'graph-v3' });
    const writerPool = new pg.Pool({ connectionString, max: 1 });
    const readerPool = new pg.Pool({ connectionString, max: 1 });
    let writerRan = false;
    try {
      const interleavingPool = pauseAfterEdgesRead(readerPool, async () => {
        writerRan = true;
        await replaceRepoEdges(writerPool, CONSISTENT_REPO, [
          { src_path: 'snapshot-b.js', dst_path: 'target-b.js', edge_type: 'import', detail: {} },
        ], { sourceRevision: REVISION_B, scannerVersion: 'graph-v3' });
      });
      const context = await loadGraphContext(CONSISTENT_REPO, interleavingPool);
      expect(writerRan).toBe(true);
      expect(context.nodeSet.has('snapshot-a.js')).toBe(true);
      expect(context.nodeSet.has('snapshot-b.js')).toBe(false);
      expect(context.freshness.source_revision).toBe(REVISION_A);
      expect(context.freshness.row_count).toBe(1);
    } finally {
      await Promise.all([writerPool.end(), readerPool.end()]);
    }
  });

  it('双连接并发替换同 repo 时最终边严格等于完整 A 或完整 B', async () => {
    const leftPool = new pg.Pool({ connectionString, max: 1 });
    const rightPool = new pg.Pool({ connectionString, max: 1 });
    const [left, right] = synchronizeTransactionBegins(leftPool, rightPool);
    const edgesA = ['a/1.js', 'a/2.js', 'a/3.js'].map((src_path) => ({
      src_path, dst_path: 'a/target.js', edge_type: 'import', detail: { snapshot: 'a' },
    }));
    const edgesB = ['b/1.js', 'b/2.js', 'b/3.js'].map((src_path) => ({
      src_path, dst_path: 'b/target.js', edge_type: 'import', detail: { snapshot: 'b' },
    }));
    const pathsA = edgesA.map(({ src_path }) => src_path);
    const pathsB = edgesB.map(({ src_path }) => src_path);

    try {
      await Promise.all([
        replaceRepoEdges(left, CONCURRENT_REPO, edgesA, {
          sourceRevision: 'revision-a', scannerVersion: 'graph-v3',
        }),
        replaceRepoEdges(right, CONCURRENT_REPO, edgesB, {
          sourceRevision: 'revision-b', scannerVersion: 'graph-v3',
        }),
      ]);

      const { rows } = await pool.query(
        'SELECT src_path FROM graph_edges WHERE repo = $1 ORDER BY src_path', [CONCURRENT_REPO],
      );
      const finalPaths = rows.map(({ src_path }) => src_path);
      expect([pathsA, pathsB]).toContainEqual(finalPaths);
      const { rows: headers } = await pool.query(
        'SELECT source_revision, row_count FROM fact_snapshot_headers WHERE kind = $1 AND repo = $2',
        ['graph', CONCURRENT_REPO],
      );
      const expectedRevision = finalPaths[0].startsWith('a/') ? 'revision-a' : 'revision-b';
      expect(headers).toEqual([{ source_revision: expectedRevision, row_count: 3 }]);
    } finally {
      await pool.query('DELETE FROM graph_edges WHERE repo = $1', [CONCURRENT_REPO]);
      await Promise.all([leftPool.end(), rightPool.end()]);
    }
  });
});
