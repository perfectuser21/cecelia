import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import pg from 'pg';

const upSql = readFileSync(new URL('../../migrations/402_map_manifest_versions.sql', import.meta.url), 'utf8');
const downSql = readFileSync(new URL('../../migrations/rollback/402_map_manifest_versions.down.sql', import.meta.url), 'utf8');

describe('migration 402 — immutable map manifest versions', () => {
  it('建立版本表、decision FK、digest/version 幂等键与状态约束', () => {
    expect(upSql).toMatch(/CREATE TABLE IF NOT EXISTS map_manifest_versions/i);
    expect(upSql).toMatch(/source_decision_id UUID NOT NULL REFERENCES decisions\s*\(id\)/i);
    expect(upSql).toMatch(/UNIQUE\s*\(scope_key,\s*version\)/i);
    expect(upSql).toMatch(/UNIQUE\s*\(scope_key,\s*digest\)/i);
    expect(upSql).toMatch(/CHECK\s*\(status IN \('draft', 'active', 'superseded', 'rejected'\)\)/i);
    expect(upSql).toMatch(/digest ~ '\^\[0-9a-f\]\{64\}\$'/i);
  });

  it('partial unique index 保证每 scope 最多一个 active', () => {
    expect(upSql).toMatch(/CREATE UNIQUE INDEX[\s\S]*ON map_manifest_versions\s*\(scope_key\)[\s\S]*WHERE status = 'active'/i);
  });

  it('immutable trigger 禁止更新完整版本字段，rollback 移除函数与表', () => {
    expect(upSql).toMatch(/BEFORE UPDATE ON map_manifest_versions/i);
    for (const column of ['scope_key', 'version', 'source_decision_id', 'manifest', 'digest', 'created_at']) {
      expect(upSql).toMatch(new RegExp(`NEW\\.${column}\\s+IS DISTINCT FROM\\s+OLD\\.${column}`, 'i'));
    }
    expect(downSql).toMatch(/DROP FUNCTION IF EXISTS reject_map_manifest_content_update/i);
    expect(downSql).toMatch(/DROP TABLE IF EXISTS map_manifest_versions/i);
  });

  it('登记 schema 402', () => {
    expect(upSql).toMatch(/VALUES\s*\(\s*'402'/i);
  });
});

describe('migration 402 — cecelia_test 实际 schema', () => {
  const connectionString = process.env.TEST_DATABASE_URL || 'postgresql://localhost/cecelia_test';
  const databaseName = decodeURIComponent(new URL(connectionString).pathname.slice(1));
  if (!/(_test|_scratch)$/.test(databaseName)) {
    throw new Error(`migration 402 test 拒绝连接非测试库: ${databaseName}`);
  }
  const pool = new pg.Pool({ connectionString, max: 1 });

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
    await pool.end();
  });
});
