/**
 * Migration 496 价值流建模⑤（真 PostgreSQL）：step_probes 挂点 target_type/target_id 回填 +
 * coll_rescan_rate 改挂 step / journey_step_links 三级格子（cell_level/step_id_ref/enabler_id）+
 * 按 steps/enablers 生成 step:<key>、enabler:<key> 格子 / 幂等 / 回滚 / golden_path 只标注不动。
 * 决策 3e867cad 第 11/13 张表、f425e3fd；任务 741cdf5a。
 * 每个用例独立 schema，只建迁移依赖的最小表（形状照生产），不碰 public。
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationSql = fs.readFileSync(path.resolve(__dirname, '../../../migrations/496_probe_targets_cells_levels.sql'), 'utf8');
const rollbackSql = fs.readFileSync(path.resolve(__dirname, '../../../migrations/rollback/496_probe_targets_cells_levels.down.sql'), 'utf8');

if (!/_test$|_scratch$/.test(DB_DEFAULTS.database || '')) {
  throw new Error(`migration 496 integration test requires a test database, got ${DB_DEFAULTS.database}`);
}

const VS = 'afa6abca-53c0-4815-8594-b7fb81ca547f';
const OTHER_JOURNEY = 'b2000000-0000-4000-8000-000000000001';
const ACTIVITIES = ['preflight', 'discovery', 'qualification', 'collection', 'scoring', 'delivery', 'outreach', 'cleanup'];
const STEP_KEYS = [
  ['collection', 'keyword_acquisition.collection.open_card'],
  ['collection', 'keyword_acquisition.collection.read_profile'],
  ['collection', 'keyword_acquisition.collection.return_to_results'],
  ['preflight', 'keyword_acquisition.preflight.unlock_phone'],
  ['delivery', 'keyword_acquisition.delivery.write_leads'],
];
const RESCAN_STEP = 'keyword_acquisition.collection.return_to_results';

const pool = new pg.Pool({ ...DB_DEFAULTS, max: 2 });
let client;
let schemaName;
const q = (identifier) => `"${identifier.replaceAll('"', '""')}"`;
const HEX = 'a'.repeat(64);

async function createParentTables() {
  await client.query(`
    CREATE TABLE schema_version (version VARCHAR(10) PRIMARY KEY, description TEXT, applied_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE journeys (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(200) NOT NULL);
    CREATE TABLE journey_steps (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), journey_id UUID REFERENCES journeys(id), name VARCHAR(200) NOT NULL,
      step_number INTEGER, status VARCHAR(50), backbone_version TEXT, capability_key TEXT, activity_key TEXT
    );
    CREATE TABLE journey_step_links (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      notion_id VARCHAR(100) UNIQUE,
      journey_id UUID NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
      step_id UUID NOT NULL REFERENCES journey_steps(id) ON DELETE CASCADE,
      step_order INT NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','done','skipped')),
      notion_synced_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      feature_id UUID, cell_kind TEXT, cell_status TEXT DEFAULT 'gray' CHECK (cell_status IN ('gray','red','pending','green')),
      assertion_ref TEXT, na_reason TEXT, cell_key VARCHAR(200), assertion_revision INT DEFAULT 0,
      notion_digest TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX uq_jsl_cell ON journey_step_links (step_id, cell_kind, cell_key) WHERE cell_kind IS NOT NULL;
    CREATE TABLE steps (
      id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
      activity_id uuid NOT NULL REFERENCES journey_steps(id) ON DELETE CASCADE,
      step_order int NOT NULL, key text NOT NULL UNIQUE, activity_key text NOT NULL, mode text NOT NULL DEFAULT 'code',
      readback jsonb, contract jsonb, source_sha256 text, active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE enablers (
      id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, key text NOT NULL UNIQUE, name text NOT NULL, kind text NOT NULL,
      impl_ref text, owner text, description text, active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE enabler_calls (
      id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, caller_type text NOT NULL, caller_id uuid NOT NULL,
      enabler_id uuid NOT NULL REFERENCES enablers(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT enabler_calls_unique UNIQUE (caller_type, caller_id, enabler_id)
    );
    CREATE TABLE step_probes (
      id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, probe_key text NOT NULL UNIQUE, workflow text NOT NULL, stage text NOT NULL,
      journey_step_link_id uuid REFERENCES journey_step_links(id) ON DELETE SET NULL,
      spec jsonb NOT NULL, spec_hash text NOT NULL, source_path text, severity text NOT NULL, active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), source_sha256 text
    );
    CREATE TABLE golden_path (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
    CREATE TABLE golden_paths (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
    CREATE TABLE golden_path_contract_versions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
    INSERT INTO golden_path (name) VALUES ('keep-me');
    INSERT INTO journeys (id, name) VALUES ('${VS}', '客户智能获客路径'), ('${OTHER_JOURNEY}', '别的路径');
    INSERT INTO enablers (key, name, kind) VALUES ('return_to_results', '归位', 'code'), ('device_lock', '设备锁', 'code'), ('orphan_enabler', '没人调用', 'code');
  `);
  const actId = {};
  for (let i = 0; i < ACTIVITIES.length; i++) {
    const r = await client.query(
      `INSERT INTO journey_steps (journey_id, name, step_number, status, backbone_version, capability_key, activity_key)
       VALUES ($1, $2, $3, 'active', '3.0', 'keyword_acquisition', $2) RETURNING id`, [VS, ACTIVITIES[i], i + 1]);
    actId[ACTIVITIES[i]] = r.rows[0].id;
    await client.query(
      `INSERT INTO journey_step_links (journey_id, step_id, step_order, cell_kind, cell_key, cell_status, status, notion_synced_at)
       VALUES ($1, $2, $3, 'element', $4, 'gray', 'planned', NOW())`, [VS, actId[ACTIVITIES[i]], i + 1, `stage:${ACTIVITIES[i]}`]);
  }
  for (let i = 0; i < STEP_KEYS.length; i++) {
    const [act, key] = STEP_KEYS[i];
    await client.query(`INSERT INTO steps (activity_id, step_order, key, activity_key) VALUES ($1, $2, $3, $4)`, [actId[act], i + 1, key, act]);
  }
  const other = await client.query(
    `INSERT INTO journey_steps (journey_id, name, step_number, status, activity_key) VALUES ($1, 'x', 1, 'active', 'x') RETURNING id`, [OTHER_JOURNEY]);
  await client.query(`INSERT INTO steps (activity_id, step_order, key, activity_key) VALUES ($1, 1, 'other.x.step', 'x')`, [other.rows[0].id]);
  await client.query(`
    INSERT INTO enabler_calls (caller_type, caller_id, enabler_id)
    SELECT 'activity', $1, id FROM enablers WHERE key = 'return_to_results';
    INSERT INTO enabler_calls (caller_type, caller_id, enabler_id)
    SELECT 'activity', $2, id FROM enablers WHERE key = 'device_lock';
    INSERT INTO enabler_calls (caller_type, caller_id, enabler_id)
    SELECT 'activity', $3, id FROM enablers WHERE key = 'device_lock';
  `, [actId.collection, actId.cleanup, actId.preflight]);
  const cell = async (k) => (await client.query(`SELECT id FROM journey_step_links WHERE cell_key = $1`, [`stage:${k}`])).rows[0].id;
  const probe = (key, stage, link) => client.query(
    `INSERT INTO step_probes (probe_key, workflow, stage, journey_step_link_id, spec, spec_hash, severity)
     VALUES ($1, 'social-keyword-leadgen', $2, $3, '{}'::jsonb, $4, 'warn')`, [key, stage, link, HEX]);
  await probe('coll_rescan_rate', 'collection', await cell('collection'));
  await probe('coll_only_matched', 'collection', await cell('collection'));
  await probe('pf_lock_acquired', 'preflight', await cell('preflight'));
  await probe('unbound_probe', 'scoring', null);
  return actId;
}

async function run(sql) {
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

async function columns(table) {
  const r = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
    [schemaName, table],
  );
  return r.rows.map((x) => x.column_name);
}

const probeTargets = async () => (await client.query(
  `SELECT probe_key, target_type, target_id, journey_step_link_id FROM step_probes ORDER BY probe_key`)).rows;
const cellsOf = async (level) => (await client.query(
  `SELECT cell_key, cell_kind, cell_status, cell_level, step_id, step_id_ref, enabler_id, status
     FROM journey_step_links WHERE journey_id = $1 AND cell_level = $2 ORDER BY cell_key`, [VS, level])).rows;

afterAll(async () => {
  await pool.end();
});

describe('migration 496 — 价值流建模⑤', () => {
  let actId;
  beforeEach(async () => {
    schemaName = `migration_496_${process.pid}_${randomUUID().replaceAll('-', '')}`;
    client = await pool.connect();
    await client.query(`CREATE SCHEMA ${q(schemaName)}`);
    await client.query(`SET search_path TO ${q(schemaName)}, public`);
    actId = await createParentTables();
  });

  afterEach(async () => {
    await client.query(`DROP SCHEMA IF EXISTS ${q(schemaName)} CASCADE`);
    client.release();
  });

  it('重放幂等：schema_version 496 只登一次，格子数不翻倍', async () => {
    await run(migrationSql);
    const first = (await client.query(`SELECT count(*)::int AS n FROM journey_step_links WHERE journey_id = $1`, [VS])).rows[0].n;
    await run(migrationSql);
    expect((await client.query(`SELECT 1 FROM schema_version WHERE version = '496'`)).rowCount).toBe(1);
    const second = (await client.query(`SELECT count(*)::int AS n FROM journey_step_links WHERE journey_id = $1`, [VS])).rows[0].n;
    expect(second).toBe(first);
    expect(first).toBe(ACTIVITIES.length + STEP_KEYS.length + 2);
  });

  it('探针挂点回填：有格子的探针 target_type=activity、target_id=格子的 step_id；coll_rescan_rate 改挂 step；无格子的保持 NULL', async () => {
    await run(migrationSql);
    expect(await columns('step_probes')).toEqual(expect.arrayContaining(['journey_step_link_id', 'target_type', 'target_id']));
    const rows = await probeTargets();
    const stepId = (await client.query(`SELECT id FROM steps WHERE key = $1`, [RESCAN_STEP])).rows[0].id;
    expect(rows.find((r) => r.probe_key === 'coll_rescan_rate')).toMatchObject({ target_type: 'step', target_id: stepId });
    expect(rows.find((r) => r.probe_key === 'coll_only_matched')).toMatchObject({ target_type: 'activity', target_id: actId.collection });
    expect(rows.find((r) => r.probe_key === 'pf_lock_acquired')).toMatchObject({ target_type: 'activity', target_id: actId.preflight });
    expect(rows.find((r) => r.probe_key === 'unbound_probe')).toMatchObject({ target_type: null, target_id: null });
    // journey_step_link_id 保留（活动格照绑，翻色仍活动级）
    expect(rows.filter((r) => r.journey_step_link_id).length).toBe(3);
    await expect(client.query(`UPDATE step_probes SET target_type = 'workflow' WHERE probe_key = 'unbound_probe'`)).rejects.toThrow(/check/i);
  });

  it('step 级格子：journey 下每个 step 一格 step:<key>（gray/element/step_id=所属活动/step_id_ref=步骤），别的 journey 不生成', async () => {
    await run(migrationSql);
    const cells = await cellsOf('step');
    expect(cells.map((c) => c.cell_key).sort()).toEqual(STEP_KEYS.map(([, k]) => `step:${k}`).sort());
    const rescan = cells.find((c) => c.cell_key === `step:${RESCAN_STEP}`);
    const stepRow = (await client.query(`SELECT id, activity_id FROM steps WHERE key = $1`, [RESCAN_STEP])).rows[0];
    expect(rescan).toMatchObject({ cell_kind: 'element', cell_status: 'gray', status: 'planned', step_id: stepRow.activity_id, step_id_ref: stepRow.id, enabler_id: null });
    expect((await client.query(`SELECT 1 FROM journey_step_links WHERE cell_key = 'step:other.x.step'`)).rowCount).toBe(0);
    // 既有活动格不动
    const acts = await cellsOf('activity');
    expect(acts.map((c) => c.cell_key)).toEqual(ACTIVITIES.map((a) => `stage:${a}`).sort());
    expect(acts.every((c) => c.step_id_ref === null && c.enabler_id === null)).toBe(true);
  });

  it('enabler 级格子：每个被调用的 enabler 一格 enabler:<key>，挂在最早调用它的活动上；没人调用的不生成', async () => {
    await run(migrationSql);
    const cells = await cellsOf('enabler');
    expect(cells.map((c) => c.cell_key)).toEqual(['enabler:device_lock', 'enabler:return_to_results']);
    const ids = Object.fromEntries((await client.query(`SELECT key, id FROM enablers`)).rows.map((r) => [r.key, r.id]));
    expect(cells.find((c) => c.cell_key === 'enabler:device_lock')).toMatchObject({ step_id: actId.preflight, enabler_id: ids.device_lock, cell_status: 'gray', step_id_ref: null });
    expect(cells.find((c) => c.cell_key === 'enabler:return_to_results')).toMatchObject({ step_id: actId.collection, enabler_id: ids.return_to_results });
  });

  it('重放不覆盖已翻色：step 格手动 green 后再跑迁移仍 green', async () => {
    await run(migrationSql);
    await client.query(`UPDATE journey_step_links SET cell_status = 'green' WHERE cell_key = $1`, [`step:${RESCAN_STEP}`]);
    await run(migrationSql);
    const r = await client.query(`SELECT cell_status FROM journey_step_links WHERE cell_key = $1`, [`step:${RESCAN_STEP}`]);
    expect(r.rows[0].cell_status).toBe('green');
  });

  it('golden_path*：不 DROP 不 RENAME，行数原样，只挂退役注释；表不存在时迁移也不炸', async () => {
    await run(migrationSql);
    expect((await client.query(`SELECT count(*)::int AS n FROM golden_path`)).rows[0].n).toBe(1);
    const c = await client.query(`SELECT obj_description(to_regclass($1), 'pg_class') AS c`, [`${schemaName}.golden_path`]);
    expect(c.rows[0].c).toMatch(/退役/);
    await client.query(`DROP TABLE golden_path, golden_paths, golden_path_contract_versions`);
    await client.query(`DELETE FROM schema_version WHERE version = '496'`);
    await expect(run(migrationSql)).resolves.toBeUndefined();
  });

  it('回滚：删 step/enabler 格子、删三列 + 两列，活动格与探针绑定保留，schema_version 496 移除；再应用可复现', async () => {
    await run(migrationSql);
    await run(rollbackSql);
    expect(await columns('journey_step_links')).not.toEqual(expect.arrayContaining(['cell_level']));
    expect(await columns('journey_step_links')).not.toEqual(expect.arrayContaining(['step_id_ref']));
    expect(await columns('journey_step_links')).not.toEqual(expect.arrayContaining(['enabler_id']));
    expect(await columns('step_probes')).not.toEqual(expect.arrayContaining(['target_type']));
    expect((await client.query(`SELECT count(*)::int AS n FROM journey_step_links WHERE journey_id = $1`, [VS])).rows[0].n).toBe(ACTIVITIES.length);
    expect((await client.query(`SELECT count(*)::int AS n FROM step_probes WHERE journey_step_link_id IS NOT NULL`)).rows[0].n).toBe(3);
    expect((await client.query(`SELECT 1 FROM schema_version WHERE version = '496'`)).rowCount).toBe(0);
    await run(migrationSql);
    expect((await cellsOf('step')).length).toBe(STEP_KEYS.length);
  });
});
