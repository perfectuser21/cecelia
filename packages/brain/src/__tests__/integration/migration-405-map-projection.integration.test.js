import { afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';

const testConnectionString = process.env.TEST_DATABASE_URL;
const databaseName = testConnectionString
  ? decodeURIComponent(new URL(testConnectionString).pathname.slice(1))
  : DB_DEFAULTS.database;
if (!/(_test|_scratch)$/.test(databaseName)) {
  throw new Error(`migration 405 integration test 拒绝连接非测试库: ${databaseName}`);
}
const pool = new pg.Pool(testConnectionString
  ? { connectionString: testConnectionString, max: 1 }
  : { ...DB_DEFAULTS, max: 1 });

afterAll(async () => {
  await pool.end();
});

describe('migration 405 — 真实 PostgreSQL projection schema', () => {
  it('三张表存在且列合同完整', async () => {
    const expectedColumns = new Map([
      ['map_projection_runs', [
        'id', 'scope_key', 'manifest_version_id', 'manifest_digest', 'fact_revisions',
        'projector_version', 'projection_digest', 'status', 'error', 'created_at', 'activated_at',
      ]],
      ['map_projection_nodes', [
        'run_id', 'node_id', 'node_type', 'node_key', 'name', 'source_refs', 'attributes',
      ]],
      ['map_projection_edges', [
        'run_id', 'edge_id', 'edge_type', 'edge_key', 'from_node_id', 'to_node_id',
        'source_refs', 'attributes',
      ]],
    ]);

    const { rows } = await pool.query(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema='public' AND table_name = ANY($1::text[])
        ORDER BY ordinal_position`,
      [[...expectedColumns.keys()]],
    );
    const actual = new Map([...expectedColumns.keys()].map((table) => [
      table,
      rows.filter((row) => row.table_name === table).map((row) => row.column_name),
    ]));
    expect(actual).toEqual(expectedColumns);
  });

  it('边的两端都通过同一 run 的 composite FK 指向节点', async () => {
    const { rows } = await pool.query(
      `SELECT conname, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conrelid = to_regclass('public.map_projection_edges')`,
    );
    const nodeReferences = rows.filter(({ definition }) => (
      /FOREIGN KEY \(run_id, (?:from|to)_node_id\) REFERENCES map_projection_nodes\(run_id, node_id\)/i
        .test(definition)
    ));
    expect(nodeReferences).toHaveLength(2);
  });

  it('每 scope 最多一个 active run', async () => {
    const { rows } = await pool.query(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname='public' AND tablename='map_projection_runs'`,
    );
    expect(rows.some(({ indexdef }) => (
      /UNIQUE[\s\S]*\(scope_key\)[\s\S]*WHERE \(status = 'active'/i.test(indexdef)
    ))).toBe(true);
  });

  it('schema_version 包含 405', async () => {
    const { rows } = await pool.query("SELECT version FROM schema_version WHERE version='405'");
    expect(rows).toEqual([{ version: '405' }]);
  });
});
