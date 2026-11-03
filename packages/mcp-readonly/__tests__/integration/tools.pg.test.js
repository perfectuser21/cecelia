import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createMcpPgFixture } from '../helpers/mcp-pg-fixture.js';
import { query } from '../../src/db.js';
import { getMapSummary } from '../../src/tools/map-summary.js';
import { getSchemaVersion } from '../../src/tools/schema-and-deployment.js';

let fixture;
beforeAll(async () => { fixture = await createMcpPgFixture(); });
afterAll(async () => { await fixture?.close(); });

describe('真实PG只读工具结果，不能由固定fakeQuery行代替', () => {
  it('多个版本按数值取最新，忽略脏版本，不能SELECT常量或字典序MAX', async () => {
    await fixture.pool.query("INSERT INTO schema_version(version,description) VALUES ('9','nine'),('1000','latest'),('dirty','invalid')");
    expect(await getSchemaVersion(fixture.pool, query)).toEqual({ current_version: 1000 });
  });

  it('历史与当前两代projection同时存在时只统计当前代，禁止删除run_id过滤', async () => {
    const result = await getMapSummary(fixture.pool, query);
    expect(result).toEqual({ active_manifest_id: fixture.activeManifest, projection_status: 'active',
      node_counts: { value_stream: 1, capability: 1, crosscut: 1 } });
    const persisted = await fixture.pool.query('SELECT run_id, COUNT(*)::int AS count FROM map_projection_nodes GROUP BY run_id');
    expect(Object.fromEntries(persisted.rows.map(row => [row.run_id, row.count])))
      .toEqual({ [fixture.activeRun]: 3, [fixture.historicalRun]: 2 });
  });

  it('没有active projection时不把历史节点当当前状态，读工具不修改持久化数据', async () => {
    await fixture.pool.query("UPDATE map_projection_runs SET status='superseded' WHERE id=$1", [fixture.activeRun]);
    try {
      expect(await getMapSummary(fixture.pool, query)).toEqual({ active_manifest_id: fixture.activeManifest,
        projection_status: 'none', node_counts: {} });
      const persisted = await fixture.pool.query('SELECT COUNT(*)::int AS count FROM map_projection_nodes');
      expect(persisted.rows[0].count).toBe(5);
    } finally {
      await fixture.pool.query("UPDATE map_projection_runs SET status='active' WHERE id=$1", [fixture.activeRun]);
    }
  });
});
