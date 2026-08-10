import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';
import { replaceRepoEdges } from '../../lib/graph-store.js';

const connectionString = process.env.TEST_DATABASE_URL || 'postgresql://localhost/cecelia_test';
const databaseName = decodeURIComponent(new URL(connectionString).pathname.slice(1));
if (!/(_test|_scratch)$/.test(databaseName)) {
  throw new Error(`graph store 集成测试拒绝连接非测试库: ${databaseName}`);
}

const pool = new pg.Pool({ connectionString, max: 3 });
const REPO = 'itest-graph-repo';
const CONCURRENT_REPO = `itest-graph-concurrent-${process.pid}`;

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
    } finally {
      await pool.query('DELETE FROM graph_edges WHERE repo = $1', [CONCURRENT_REPO]);
      await Promise.all([leftPool.end(), rightPool.end()]);
    }
  });
});
