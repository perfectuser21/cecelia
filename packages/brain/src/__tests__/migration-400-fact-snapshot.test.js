import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const upSql = readFileSync(new URL('../../migrations/400_fact_snapshot_metadata.sql', import.meta.url), 'utf8');
const downSql = readFileSync(new URL('../../migrations/rollback/400_fact_snapshot_metadata.down.sql', import.meta.url), 'utf8');

describe('migration 400 — versioned fact snapshot metadata', () => {
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

  it('登记 schema 400', () => {
    expect(upSql).toMatch(/VALUES\s*\(\s*'400'/i);
  });

  it('建立通用 snapshot header，并从四张事实表按 repo 最新事实回填', () => {
    expect(upSql).toMatch(/CREATE TABLE IF NOT EXISTS fact_snapshot_headers/i);
    expect(upSql).toMatch(/PRIMARY KEY\s*\(kind,\s*repo\)/i);
    expect(upSql).toMatch(/CHECK\s*\(kind\s+IN\s*\('api',\s*'db_schema',\s*'test',\s*'graph'\)\)/i);
    expect(upSql).toMatch(/row_count\s+INTEGER\s+NOT NULL[\s\S]*CHECK\s*\(row_count\s*>=\s*0\)/i);
    for (const [kind, table] of [
      ['api', 'api_registry'], ['db_schema', 'db_schema_registry'],
      ['test', 'test_registry'], ['graph', 'graph_edges'],
    ]) {
      expect(upSql).toMatch(new RegExp(
        `INSERT INTO fact_snapshot_headers[\\s\\S]+['"]${kind}['"][\\s\\S]+FROM\\s+${table}`,
        'i',
      ));
    }
    expect(downSql).toMatch(/DROP TABLE IF EXISTS fact_snapshot_headers/i);
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

describe('migration 400 — cecelia_test 实际列与约束', () => {
  const connectionString = process.env.TEST_DATABASE_URL || 'postgresql://localhost/cecelia_test';
  const databaseName = decodeURIComponent(new URL(connectionString).pathname.slice(1));
  if (!/(_test|_scratch)$/.test(databaseName)) {
    throw new Error(`migration 400 测试拒绝连接非测试库: ${databaseName}`);
  }
  const pool = new pg.Pool({ connectionString, max: 1 });
  let headerBeforeMarkerTests;

  async function readCeceliaApiHeader() {
    const { rows } = await pool.query(
      `SELECT kind, repo, source_revision, scanner_version, scanned_at, row_count
         FROM fact_snapshot_headers WHERE kind = 'api' AND repo = 'cecelia'`,
    );
    return rows;
  }

  async function restoreCeceliaApiHeader(originalRows) {
    if (originalRows.length === 0) {
      await pool.query(
        `DELETE FROM fact_snapshot_headers WHERE kind = 'api' AND repo = 'cecelia'`,
      );
      return;
    }
    const original = originalRows[0];
    await pool.query(
      `INSERT INTO fact_snapshot_headers
        (kind, repo, source_revision, scanner_version, scanned_at, row_count)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (kind, repo) DO UPDATE SET
         source_revision = EXCLUDED.source_revision,
         scanner_version = EXCLUDED.scanner_version,
         scanned_at = EXCLUDED.scanned_at,
         row_count = EXCLUDED.row_count`,
      [
        original.kind, original.repo, original.source_revision,
        original.scanner_version, original.scanned_at, original.row_count,
      ],
    );
  }

  beforeAll(async () => {
    headerBeforeMarkerTests = await readCeceliaApiHeader();
  });

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

  it('fact_snapshot_headers 具有通用 kind/repo 主键与 metadata/row_count 列', async () => {
    const { rows: columns } = await pool.query(
      `SELECT column_name, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'fact_snapshot_headers'`,
    );
    expect(new Map(columns.map((row) => [row.column_name, row.is_nullable]))).toEqual(new Map([
      ['kind', 'NO'], ['repo', 'NO'], ['source_revision', 'NO'],
      ['scanner_version', 'NO'], ['scanned_at', 'NO'], ['row_count', 'NO'],
    ]));
    const { rows: pk } = await pool.query(
      `SELECT array_agg(a.attname::text ORDER BY u.ordinality) AS columns
         FROM pg_constraint c
         JOIN LATERAL unnest(c.conkey) WITH ORDINALITY u(attnum, ordinality) ON true
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.attnum
        WHERE c.conrelid = 'fact_snapshot_headers'::regclass AND c.contype = 'p'
        GROUP BY c.oid`,
    );
    expect(pk[0]?.columns).toEqual(['kind', 'repo']);
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
    const originalHeader = await readCeceliaApiHeader();
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
      await restoreCeceliaApiHeader(originalHeader);
    }
  });

  it('重跑 migration 遇到 legacy/cecelia 同键时保留 cecelia 行并删除 legacy 冲突', async () => {
    const markerPath = `/__migration_397_collision_marker_${process.pid}`;
    const originalHeader = await readCeceliaApiHeader();
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
      await restoreCeceliaApiHeader(originalHeader);
    }
  });

  it('migration marker 测试结束后 api|cecelia header 与运行前完全一致', async () => {
    expect(await readCeceliaApiHeader()).toEqual(headerBeforeMarkerTests);
  });
});

describe('scanner snapshot contract', () => {
  const api = readFileSync(new URL('../../../../scripts/scan/scan-api-registry.js', import.meta.url), 'utf8');
  const db = readFileSync(new URL('../../../../scripts/scan/scan-db-schema.js', import.meta.url), 'utf8');
  const test = readFileSync(new URL('../../../../scripts/scan/scan-test-registry.js', import.meta.url), 'utf8');
  const graph = readFileSync(new URL('../../../../scripts/scan/scan-graph.mjs', import.meta.url), 'utf8');
  const gitRevision = readFileSync(new URL('../lib/git-revision.js', import.meta.url), 'utf8');

  it.each([
    [api, 'api-registry-v2'],
    [db, 'db-schema-v2'],
    [test, 'test-registry-v2'],
    [graph, 'graph-v3'],
  ])('scanner 在写库合同中携带 git revision 与固定 scanner version', (source, scannerVersion) => {
    expect(source).toContain('readGitRevision');
    expect(source).toContain(scannerVersion);
  });

  it('四个 scanner 共用的 revision helper 统一执行 git -C root rev-parse HEAD', () => {
    expect(gitRevision).toMatch(/['"]git['"][\s\S]+['"]-C['"][\s\S]+['"]rev-parse['"][\s\S]+['"]HEAD['"]/);
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
