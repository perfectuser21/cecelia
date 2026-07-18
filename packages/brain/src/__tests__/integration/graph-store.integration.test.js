import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';
import { replaceRepoEdges } from '../../lib/graph-store.js';

const pool = new pg.Pool({ ...DB_DEFAULTS, max: 3 });
const REPO = 'itest-graph-repo';

afterAll(async () => {
  await pool.query('DELETE FROM graph_edges WHERE repo = $1', [REPO]);
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
});
