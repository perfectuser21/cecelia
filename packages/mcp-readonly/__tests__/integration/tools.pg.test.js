import { randomUUID } from 'node:crypto';
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
    expect(await getSchemaVersion(fixture.readonlyPool, query)).toEqual({ current_version: 1000 });
  });

  it('历史与当前两代projection同时存在时只统计当前代，禁止删除run_id过滤', async () => {
    const result = await getMapSummary(fixture.readonlyPool, query, { scope: 'mcp-fixture' });
    expect(result).toEqual({ scope_key: 'mcp-fixture', active_run_id: fixture.activeRun, active_manifest_id: fixture.activeManifest, projection_status: 'active',
      node_counts: { value_stream: 1, capability: 1, crosscut: 1 } });
    const persisted = await fixture.pool.query('SELECT run_id, COUNT(*)::int AS count FROM map_projection_nodes GROUP BY run_id');
    expect(Object.fromEntries(persisted.rows.map(row => [row.run_id, row.count])))
      .toEqual({ [fixture.activeRun]: 3, [fixture.historicalRun]: 2 });
  });

  it('没有active projection时不把历史节点当当前状态，读工具不修改持久化数据', async () => {
    await fixture.pool.query("UPDATE map_projection_runs SET status='superseded' WHERE id=$1", [fixture.activeRun]);
    try {
      expect(await getMapSummary(fixture.readonlyPool, query, { scope: 'mcp-fixture' })).toEqual({ scope_key: 'mcp-fixture', active_run_id: null, active_manifest_id: fixture.activeManifest,
        projection_status: 'none', node_counts: {}, no_active_run: true });
      const persisted = await fixture.pool.query('SELECT COUNT(*)::int AS count FROM map_projection_nodes');
      expect(persisted.rows[0].count).toBe(5);
    } finally {
      await fixture.pool.query("UPDATE map_projection_runs SET status='active' WHERE id=$1", [fixture.activeRun]);
    }
  });
});


async function manifest(scope, digest) {
  const id = randomUUID();
  await fixture.pool.query(`INSERT INTO map_manifest_versions
    (id,scope_key,version,source_decision_id,manifest,digest,status,activated_at)
    SELECT $1,$2,2,source_decision_id,$3,$4,'active',NOW()
    FROM map_manifest_versions WHERE id=$5`,
    [id, scope, JSON.stringify({ schema_version: 1, scope_key: scope }), digest, fixture.activeManifest]);
  return id;
}
it('更晚激活的另一个scope不能污染当前manifest/run及节点数量', async () => {
  const digest = 'b'.repeat(64), id = await manifest('other-company', digest), run = randomUUID();
  await fixture.pool.query(`INSERT INTO map_projection_runs
    (id,scope_key,manifest_version_id,manifest_digest,fact_revisions,projector_version,projection_digest,status,activated_at)
    VALUES ($1,'other-company',$2,$3,'{}','scope-negative',$3,'active',NOW())`, [run, id, digest]);
  const own = await getMapSummary(fixture.readonlyPool, query, { scope: 'mcp-fixture' });
  expect(own).toMatchObject({ active_manifest_id: fixture.activeManifest, active_run_id: fixture.activeRun,
    node_counts: { value_stream: 1, capability: 1, crosscut: 1 } });
  expect(await getMapSummary(fixture.readonlyPool, query, { scope: 'other-company' })).toMatchObject({ active_manifest_id: id, active_run_id: run, node_counts: {} });
});
it('当前manifest身份与digest改变时不能串用旧active run', async () => {
  await fixture.pool.query("UPDATE map_manifest_versions SET status='superseded' WHERE id=$1", [fixture.activeManifest]);
  const id = await manifest('mcp-fixture', 'c'.repeat(64));
  try {
    expect(await getMapSummary(fixture.readonlyPool, query, { scope: 'mcp-fixture' })).toEqual({
      scope_key: 'mcp-fixture', active_manifest_id: id, active_run_id: null,
      projection_status: 'none', node_counts: {}, no_active_run: true,
    });
    const persisted = await fixture.pool.query('SELECT status FROM map_projection_runs WHERE id=$1', [fixture.activeRun]);
    expect(persisted.rows[0].status).toBe('active');
  } finally {
    await fixture.pool.query('DELETE FROM map_manifest_versions WHERE id=$1', [id]);
    await fixture.pool.query("UPDATE map_manifest_versions SET status='active' WHERE id=$1", [fixture.activeManifest]);
  }
});
