import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
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

  it.each(['api_registry', 'db_schema_registry', 'test_registry'])(
    '%s 的 repo 默认/存量归属为 cecelia，revision 与 scanner 使用 legacy 默认',
    (table) => {
      const tableBlock = upSql.match(new RegExp(`ALTER TABLE\\s+${table}([\\s\\S]*?);`, 'i'))?.[1] || '';
      expect(tableBlock).toMatch(/ADD COLUMN IF NOT EXISTS repo[\s\S]*DEFAULT 'cecelia'/i);
      expect(tableBlock).toMatch(/ADD COLUMN IF NOT EXISTS source_revision[\s\S]*DEFAULT 'legacy-unknown'/i);
      expect(tableBlock).toMatch(/ADD COLUMN IF NOT EXISTS scanner_version[\s\S]*DEFAULT 'legacy'/i);
      expect(upSql).toMatch(new RegExp(
        `UPDATE\\s+${table}\\s+SET\\s+repo\\s*=\\s*'cecelia'\\s+WHERE\\s+repo\\s*=\\s*'legacy-unknown'`,
        'i',
      ));
    },
  );

  it('重跑前先删除 legacy 与 cecelia 同 natural key 的冲突行', () => {
    expect(upSql).toMatch(/DELETE FROM api_registry[\s\S]+legacy\.repo = 'legacy-unknown'[\s\S]+owned\.repo = 'cecelia'/i);
    expect(upSql).toMatch(/DELETE FROM db_schema_registry[\s\S]+legacy\.repo = 'legacy-unknown'[\s\S]+owned\.repo = 'cecelia'/i);
    expect(upSql).toMatch(/DELETE FROM test_registry[\s\S]+legacy\.repo = 'legacy-unknown'[\s\S]+owned\.repo = 'cecelia'/i);
  });

  it('登记 schema 397', () => {
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

  afterAll(async () => {
    await pool.end();
  });

  it('四表 metadata 列均为 NOT NULL', async () => {
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
  });

  it.each(['api_registry', 'db_schema_registry', 'test_registry'])(
    '%s 的真实 metadata 默认值符合合同',
    async (table) => {
      const { rows } = await pool.query(
        `SELECT column_name, column_default
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1
            AND column_name = ANY($2)`,
        [table, ['repo', 'source_revision', 'scanner_version']],
      );
      const defaults = new Map(rows.map((row) => [row.column_name, row.column_default]));
      expect(defaults.get('repo')).toContain("'cecelia'");
      expect(defaults.get('source_revision')).toContain("'legacy-unknown'");
      expect(defaults.get('scanner_version')).toContain("'legacy'");
    },
  );

  it('重跑 migration 会把唯一 legacy marker 回填为 cecelia', async () => {
    const markerPath = `/__migration_397_legacy_marker_${process.pid}`;
    try {
      await pool.query('DELETE FROM api_registry WHERE method = $1 AND path = $2', ['GET', markerPath]);
      await pool.query(
        `INSERT INTO api_registry
          (repo, method, path, file_path, area, source_revision, scanner_version)
         VALUES ('legacy-unknown', 'GET', $1, 'migration-397.test.js', 'test', 'legacy-unknown', 'legacy')`,
        [markerPath],
      );

      await pool.query(upSql);

      const { rows } = await pool.query(
        'SELECT repo FROM api_registry WHERE method = $1 AND path = $2', ['GET', markerPath],
      );
      expect(rows).toEqual([{ repo: 'cecelia' }]);
    } finally {
      await pool.query('DELETE FROM api_registry WHERE method = $1 AND path = $2', ['GET', markerPath]);
    }
  });

  it('重跑 migration 遇到 legacy/cecelia 同键时保留 cecelia 行并删除 legacy 冲突', async () => {
    const markerPath = `/__migration_397_collision_marker_${process.pid}`;
    try {
      await pool.query('DELETE FROM api_registry WHERE method = $1 AND path = $2', ['POST', markerPath]);
      await pool.query(
        `INSERT INTO api_registry
          (repo, method, path, file_path, area, source_revision, scanner_version)
         VALUES
          ('legacy-unknown', 'POST', $1, 'legacy.js', 'test', 'legacy-unknown', 'legacy'),
          ('cecelia', 'POST', $1, 'owned.js', 'test', 'owned-revision', 'api-registry-v2')`,
        [markerPath],
      );

      await pool.query(upSql);

      const { rows } = await pool.query(
        `SELECT repo, file_path, source_revision FROM api_registry
          WHERE method = $1 AND path = $2`,
        ['POST', markerPath],
      );
      expect(rows).toEqual([{ repo: 'cecelia', file_path: 'owned.js', source_revision: 'owned-revision' }]);
    } finally {
      await pool.query('DELETE FROM api_registry WHERE method = $1 AND path = $2', ['POST', markerPath]);
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
