import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import pg from 'pg';

const upSql = readFileSync(new URL('../../migrations/397_fact_snapshot_metadata.sql', import.meta.url), 'utf8');
const downSql = readFileSync(new URL('../../migrations/rollback/397_fact_snapshot_metadata.down.sql', import.meta.url), 'utf8');

describe('migration 397 — versioned fact snapshot metadata', () => {
  it.each(['api_registry', 'db_schema_registry', 'test_registry'])(
    '%s 增加 repo/source_revision/scanner_version 并建立 repo + scanned_at 索引',
    (table) => {
      expect(upSql).toMatch(new RegExp(`ALTER TABLE\\s+${table}`, 'i'));
      expect(upSql).toMatch(new RegExp(`ON\\s+${table}\\s*\\(repo,\\s*scanned_at`, 'i'));
    },
  );

  it('graph_edges 增加 source_revision/scanner_version 与 repo + scanned_at 索引', () => {
    expect(upSql).toMatch(/ALTER TABLE\s+graph_edges/i);
    expect(upSql).toMatch(/source_revision/i);
    expect(upSql).toMatch(/scanner_version/i);
    expect(upSql).toMatch(/ON\s+graph_edges\s*\(repo,\s*scanned_at/i);
  });

  it('三张 registry 唯一键升级为 repo + natural key', () => {
    expect(upSql).toMatch(/UNIQUE\s*\(repo,\s*method,\s*path\)/i);
    expect(upSql).toMatch(/UNIQUE\s*\(repo,\s*table_name\)/i);
    expect(upSql).toMatch(/UNIQUE\s*\(repo,\s*file_path\)/i);
  });

  it('存量 metadata 使用明确 legacy 默认值，并登记 schema 397', () => {
    expect(upSql).toContain("DEFAULT 'legacy-unknown'");
    expect(upSql).toContain("DEFAULT 'legacy'");
    expect(upSql).toMatch(/VALUES\s*\(\s*'397'/i);
  });

  it('rollback 在恢复旧唯一键前检测跨 repo 冲突，并撤销新增列与索引', () => {
    expect(downSql).toMatch(/RAISE EXCEPTION/i);
    expect(downSql).toMatch(/GROUP BY\s+method,\s*path/i);
    expect(downSql).toMatch(/GROUP BY\s+table_name/i);
    expect(downSql).toMatch(/GROUP BY\s+file_path/i);
    expect(downSql).toMatch(/DROP COLUMN IF EXISTS source_revision/i);
    expect(downSql).toMatch(/DROP COLUMN IF EXISTS scanner_version/i);
    expect(downSql).toMatch(/DROP COLUMN IF EXISTS repo/i);
  });
});

describe('migration 397 — cecelia_test 实际列与约束', () => {
  const connectionString = process.env.TEST_DATABASE_URL || 'postgresql://localhost/cecelia_test';
  const databaseName = decodeURIComponent(new URL(connectionString).pathname.slice(1));
  if (!/(_test|_scratch)$/.test(databaseName)) {
    throw new Error(`migration 397 测试拒绝连接非测试库: ${databaseName}`);
  }
  const pool = new pg.Pool({ connectionString, max: 1 });

  it('四表 metadata 列均为 NOT NULL', async () => {
    try {
      const { rows } = await pool.query(
        `SELECT table_name, column_name, is_nullable
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = ANY($1)
            AND column_name = ANY($2)`,
        [
          ['api_registry', 'db_schema_registry', 'test_registry', 'graph_edges'],
          ['repo', 'source_revision', 'scanner_version', 'scanned_at'],
        ],
      );
      const actual = new Map(rows.map((row) => [`${row.table_name}.${row.column_name}`, row.is_nullable]));
      for (const table of ['api_registry', 'db_schema_registry', 'test_registry', 'graph_edges']) {
        for (const column of ['repo', 'source_revision', 'scanner_version', 'scanned_at']) {
          expect(actual.get(`${table}.${column}`)).toBe('NO');
        }
      }
    } finally {
      await pool.end();
    }
  });
});

describe('scanner snapshot contract', () => {
  const api = readFileSync(new URL('../../../../scripts/scan/scan-api-registry.js', import.meta.url), 'utf8');
  const db = readFileSync(new URL('../../../../scripts/scan/scan-db-schema.js', import.meta.url), 'utf8');
  const test = readFileSync(new URL('../../../../scripts/scan/scan-test-registry.js', import.meta.url), 'utf8');
  const graph = readFileSync(new URL('../../../../scripts/scan/scan-graph.mjs', import.meta.url), 'utf8');

  it.each([
    [api, 'api-registry-v2'],
    [db, 'db-schema-v2'],
    [test, 'test-registry-v2'],
    [graph, 'graph-v3'],
  ])('scanner 在写库合同中携带 git revision 与固定 scanner version', (source, scannerVersion) => {
    expect(source).toMatch(/rev-parse['"`,\s]+HEAD/);
    expect(source).toContain(scannerVersion);
  });

  it('三张 registry scanner 统一调用 replaceFactSnapshot，repo 固定 cecelia', () => {
    for (const source of [api, db, test]) {
      expect(source).toContain('replaceFactSnapshot');
      expect(source).toMatch(/repo:\s*['"]cecelia['"]/);
    }
  });

  it('graph dependency-cruiser 失败不会继续写 partial snapshot', () => {
    expect(graph).not.toMatch(/dependency-cruiser 失败:[^\n]+跳过 import 边/);
    expect(graph).toMatch(/replaceRepoEdges\([\s\S]+sourceRevision[\s\S]+scannerVersion/);
  });
});
