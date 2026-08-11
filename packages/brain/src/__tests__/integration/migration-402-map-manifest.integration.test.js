import { afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';

const testConnectionString = process.env.TEST_DATABASE_URL;
const databaseName = testConnectionString
  ? decodeURIComponent(new URL(testConnectionString).pathname.slice(1))
  : DB_DEFAULTS.database;
if (!/(_test|_scratch)$/.test(databaseName)) {
  throw new Error(`migration 402 integration test 拒绝连接非测试库: ${databaseName}`);
}
const pool = new pg.Pool(testConnectionString
  ? { connectionString: testConnectionString, max: 1 }
  : { ...DB_DEFAULTS, max: 1 });

afterAll(async () => {
  await pool.end();
});

describe('migration 402 — 真实 PostgreSQL schema', () => {
  it('真实表具有所需列、约束、active unique index 与 decision FK', async () => {
    const { rows: columns } = await pool.query(
      `SELECT column_name, is_nullable
         FROM information_schema.columns
        WHERE table_schema='public' AND table_name='map_manifest_versions'`,
    );
    expect(new Map(columns.map((row) => [row.column_name, row.is_nullable]))).toEqual(new Map([
      ['id', 'NO'], ['scope_key', 'NO'], ['version', 'NO'], ['source_decision_id', 'NO'],
      ['manifest', 'NO'], ['digest', 'NO'], ['status', 'NO'], ['created_at', 'NO'],
      ['activated_at', 'YES'],
    ]));

    const { rows: constraints } = await pool.query(
      `SELECT contype, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint WHERE conrelid='map_manifest_versions'::regclass`,
    );
    expect(constraints.some(({ contype, definition }) => contype === 'f' && /decisions\(id\)/i.test(definition))).toBe(true);
    expect(constraints.some(({ contype, definition }) => contype === 'u' && /scope_key, version/i.test(definition))).toBe(true);
    expect(constraints.some(({ contype, definition }) => contype === 'u' && /scope_key, digest/i.test(definition))).toBe(true);

    const { rows: indexes } = await pool.query(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname='public' AND tablename='map_manifest_versions'`,
    );
    expect(indexes.some(({ indexdef }) => /UNIQUE[\s\S]*\(scope_key\)[\s\S]*WHERE \(status = 'active'/i.test(indexdef))).toBe(true);
  });

  it('schema_version 包含 402', async () => {
    const { rows } = await pool.query("SELECT version FROM schema_version WHERE version='402'");
    expect(rows).toEqual([{ version: '402' }]);
  });
});
