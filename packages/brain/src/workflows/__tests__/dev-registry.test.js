import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import pg from 'pg';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { privatePgConfig, verifyPrivatePg } from '../../../../../scripts/ci/private-pg-contract.mjs';

const pool = new pg.Pool(privatePgConfig());
const root = fileURLToPath(new URL('../../../../../', import.meta.url));
let fixture;
const repo = 'manual-backend-fixture';
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 60000, ...opts });
const scan = name => run(process.execPath, [resolve(root, `scripts/scan/scan-${name}.js`)], {
  cwd: fixture,
  env: { ...process.env, SCAN_REPO_ROOT: fixture, SCAN_REPO_NAME: repo, SCAN_API_DIRS: 'src', SOURCE_DATABASE_URL: process.env.TEST_DATABASE_URL },
});
beforeAll(async () => {
  await verifyPrivatePg(pool);
  fixture = mkdtempSync(join(tmpdir(), 'dev-registry-fixture-'));
  mkdirSync(join(fixture, 'src'));
  writeFileSync(join(fixture, 'src/api.js'), "router.get('/owned-fixture', handler);\n");
  writeFileSync(join(fixture, 'src/api.test.js'), "it('fixture behavior', () => {});\n");
  run('git', ['init', '-b', 'cp-fixture'], { cwd: fixture });
  run('git', ['add', '.'], { cwd: fixture });
  run('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'test: fixture'], { cwd: fixture });
});
afterAll(async () => {
  for (const table of ['api_registry', 'db_schema_registry', 'test_registry', 'fact_snapshot_headers']) {
    await pool.query(`DELETE FROM ${table} WHERE repo=$1`, [repo]);
  }
  await pool.end();
  if (fixture) rmSync(fixture, { recursive: true, force: true });
});

describe('dev-registry 当前真表及兼容视图', () => {
  it.each(['value_streams', 'capabilities', 'activities', 'workflow_activity_refs', 'journey_features', 'api_registry', 'db_schema_registry', 'test_registry', 'issues'])('%s 是现役基表', async table => {
    expect((await pool.query("SELECT table_type FROM information_schema.tables WHERE table_schema='public' AND table_name=$1", [table])).rows).toEqual([{ table_type: 'BASE TABLE' }]);
  });
  it('journeys 只作兼容视图，Activity位置由流程引用承载', async () => {
    expect((await pool.query("SELECT table_type FROM information_schema.tables WHERE table_schema='public' AND table_name='journeys'")).rows).toEqual([{ table_type: 'VIEW' }]);
    expect((await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='activities' AND column_name IN ('journey_id','step_number')")).rows).toHaveLength(0);
    const { rows } = await pool.query("SELECT indexdef FROM pg_indexes WHERE tablename='workflow_activity_refs' AND indexname='workflow_activity_refs_active_sequence'");
    expect(rows[0].indexdef).toContain('(workflow_id, sequence_no) WHERE active');
  });
  it.each([
    ["INSERT INTO value_streams(name,journey_type) VALUES ('invalid','invalid_type')", '23514'],
    ["INSERT INTO journey_features(name,thickness) VALUES ('invalid','super_thick')", '23514'],
    ["INSERT INTO issues(title,priority) VALUES ('invalid','P9')", '23514'],
  ])('真实CHECK拒绝非法值而非缺表/缺列：%s', async (sql, code) => {
    await expect(pool.query(sql)).rejects.toMatchObject({ code });
  });
});

describe('dev-registry 实际扫描器与本地Git源', () => {
  it('API扫描写入来源版本并移除同仓陈旧路径', async () => {
    scan('api-registry');
    const revision = run('git', ['rev-parse', 'HEAD'], { cwd: fixture }).trim();
    const rows = (await pool.query('SELECT method,path,file_path,source_revision,scanner_version FROM api_registry WHERE repo=$1', [repo])).rows;
    expect(rows).toEqual([{ method: 'GET', path: '/owned-fixture', file_path: 'src/api.js', source_revision: revision, scanner_version: 'api-registry-v2' }]);
    writeFileSync(join(fixture, 'src/api.js'), "router.post('/replacement', handler);\n");
    run('git', ['add', '.'], { cwd: fixture });
    run('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'test: replace fixture route'], { cwd: fixture });
    scan('api-registry');
    expect((await pool.query('SELECT method,path FROM api_registry WHERE repo=$1', [repo])).rows).toEqual([{ method: 'POST', path: '/replacement' }]);
  });
  it('DB扫描读真实tasks字段、主键及索引；重复扫描不重复建账', async () => {
    scan('db-schema');
    scan('db-schema');
    const { rows } = await pool.query("SELECT columns,indexes,source_revision FROM db_schema_registry WHERE repo=$1 AND table_name='tasks'", [repo]);
    expect(rows).toHaveLength(1);
    expect(rows[0].columns).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'id', primary_key: true }), expect.objectContaining({ name: 'status' })]));
    expect(rows[0].indexes.length).toBeGreaterThan(0);
    expect(rows[0].source_revision).toBe(run('git', ['rev-parse', 'HEAD'], { cwd: fixture }).trim());
  });
  it('测试扫描真实fixture行为名，不要求机器已装skill或Notion存量', async () => {
    scan('test-registry');
    expect((await pool.query('SELECT file_path,test_count,covered_behaviors,test_type FROM test_registry WHERE repo=$1', [repo])).rows).toEqual([
      { file_path: 'src/api.test.js', test_count: 1, covered_behaviors: ['fixture behavior'], test_type: 'unit' },
    ]);
    const snapshots = (await pool.query('SELECT kind,row_count FROM fact_snapshot_headers WHERE repo=$1 ORDER BY kind', [repo])).rows;
    expect(snapshots.map(row => row.kind)).toEqual(['api', 'db_schema', 'test']);
    expect(snapshots.every(row => row.row_count > 0)).toBe(true);
  });
});
