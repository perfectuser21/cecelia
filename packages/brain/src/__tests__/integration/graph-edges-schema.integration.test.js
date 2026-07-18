import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';

const pool = new pg.Pool({ ...DB_DEFAULTS, max: 3 });
afterAll(() => pool.end());

describe('graph_edges 表结构(migration 351)', () => {
  it('表存在且列齐全', async () => {
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='graph_edges' ORDER BY ordinal_position`
    );
    const cols = rows.map((r) => r.column_name);
    for (const c of ['repo', 'src_path', 'dst_path', 'edge_type', 'detail', 'scanned_at']) {
      expect(cols).toContain(c);
    }
  });

  it('edge_type CHECK 拒绝非法值', async () => {
    await expect(
      pool.query(`INSERT INTO graph_edges (repo, src_path, dst_path, edge_type) VALUES ('itest', 'a', 'b', 'bogus')`)
    ).rejects.toThrow();
  });
});
