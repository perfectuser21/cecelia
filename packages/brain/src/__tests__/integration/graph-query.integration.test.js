/**
 * graph-query 真库链路 Integration Test（刀A2 Task 4）
 *
 * 覆盖：graph_edges 真库边 → buildAdjacency → reachable(rev BFS) → isTestPath 识别。
 * 只插 itest-gq/ 前缀边，严禁碰 journey_features。
 * spec: docs/superpowers/specs/2026-07-18-graph-query-api-design.md
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';
import { buildAdjacency, reachable, isTestPath } from '../../lib/graph-query.js';

const pool = new pg.Pool({ ...DB_DEFAULTS, max: 3 });
const PFX = 'itest-gq/';

beforeAll(async () => {
  await pool.query(`DELETE FROM graph_edges WHERE src_path LIKE $1 OR dst_path LIKE $1`, [`${PFX}%`]);
  await pool.query(
    `INSERT INTO graph_edges (repo, src_path, dst_path, edge_type) VALUES
     ('cecelia', '${PFX}a.js', '${PFX}b.js', 'import'),
     ('cecelia', '${PFX}__tests__/t.test.js', '${PFX}b.js', 'import')`);
});

afterAll(async () => {
  await pool.query(`DELETE FROM graph_edges WHERE src_path LIKE $1 OR dst_path LIKE $1`, [`${PFX}%`]);
  await pool.end();
});

describe('graph-query 真库链路', () => {
  it('真库边 → 邻接 → rev BFS → 测试文件识别', async () => {
    const { rows } = await pool.query(
      `SELECT src_path, dst_path, edge_type FROM graph_edges WHERE src_path LIKE $1 OR dst_path LIKE $1`,
      [`${PFX}%`]);
    expect(rows.length).toBe(2);
    const adj = buildAdjacency(rows);
    const reached = reachable(adj, [`${PFX}b.js`], { dir: 'rev', maxDepth: 5 });
    expect(reached.has(`${PFX}a.js`)).toBe(true);
    expect([...reached].filter(isTestPath)).toEqual([`${PFX}__tests__/t.test.js`]);
  });
});
