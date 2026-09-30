/**
 * Migration 493 价值流建模②（真 PostgreSQL）：areas 自引用树 / journeys.kind 生成列 /
 * value_streams·capabilities 视图 / 旧 capabilities 腾名 capabilities_legacy（pr_plans 外键跟着走，行数不变）。
 * 决策 3e867cad 第 1-3 张表，词表 f425e3fd；任务 ef3aeffa。
 * 每个用例独立 schema，只建迁移依赖的最小表并预置 391 那样的 value_streams 视图，不碰 public。
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationSql = fs.readFileSync(path.resolve(__dirname, '../../../migrations/493_vs_model_areas_kind.sql'), 'utf8');
const rollbackSql = fs.readFileSync(path.resolve(__dirname, '../../../migrations/rollback/493_vs_model_areas_kind.down.sql'), 'utf8');

if (!/_test$|_scratch$/.test(DB_DEFAULTS.database || '')) {
  throw new Error(`migration 493 integration test requires a test database, got ${DB_DEFAULTS.database}`);
}

const pool = new pg.Pool({ ...DB_DEFAULTS, max: 2 });
let client;
let schemaName;
const q = (identifier) => `"${identifier.replaceAll('"', '""')}"`;

async function createParentTables() {
  await client.query(`
    CREATE TABLE schema_version (version VARCHAR(10) PRIMARY KEY, description TEXT, applied_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE areas (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(200) NOT NULL);
    CREATE TABLE journeys (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(200) NOT NULL, parent_journey_id UUID);
    CREATE VIEW value_streams AS SELECT * FROM journeys;
    CREATE TABLE capabilities (id VARCHAR(60) PRIMARY KEY, name VARCHAR(200) NOT NULL, current_stage INTEGER DEFAULT 1 CHECK (current_stage BETWEEN 1 AND 4));
    CREATE TABLE pr_plans (id SERIAL PRIMARY KEY, capability_id VARCHAR(60) REFERENCES capabilities(id) ON DELETE SET NULL);
    INSERT INTO capabilities (id, name, current_stage) VALUES ('a','A',1),('b','B',2),('c','C',3);
    INSERT INTO pr_plans (capability_id) VALUES ('a'),('c');
  `);
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

async function relkind(name) {
  const r = await client.query(
    `SELECT c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = $2`,
    [schemaName, name]
  );
  return r.rows[0]?.relkind ?? null;
}

afterAll(async () => {
  await pool.end();
});

describe('migration 493 — 价值流建模②', () => {
  beforeEach(async () => {
    schemaName = `migration_493_${process.pid}_${randomUUID().replaceAll('-', '')}`;
    client = await pool.connect();
    await client.query(`CREATE SCHEMA ${q(schemaName)}`);
    await client.query(`SET search_path TO ${q(schemaName)}, public`);
    await createParentTables();
  });

  afterEach(async () => {
    await client.query(`DROP SCHEMA IF EXISTS ${q(schemaName)} CASCADE`);
    client.release();
  });

  it('重放幂等，写 schema_version 493；capabilities 变视图、旧表成 capabilities_legacy', async () => {
    await run(migrationSql);
    await run(migrationSql);
    const ver = await client.query(`SELECT version FROM schema_version WHERE version = '493'`);
    expect(ver.rowCount).toBe(1);
    expect(await relkind('capabilities_legacy')).toBe('r');
    expect(await relkind('capabilities')).toBe('v');
    expect(await relkind('value_streams')).toBe('v');
  });

  it('journeys.kind 由 parent_journey_id 派生：无父 value_stream、有父 capability；不能手写', async () => {
    await run(migrationSql);
    const vs = await client.query(`INSERT INTO journeys (name) VALUES ('智能获客') RETURNING id, kind`);
    expect(vs.rows[0].kind).toBe('value_stream');
    const cap = await client.query(
      `INSERT INTO journeys (name, parent_journey_id) VALUES ('关键词获客', $1) RETURNING kind`,
      [vs.rows[0].id]
    );
    expect(cap.rows[0].kind).toBe('capability');
    const moved = await client.query(`UPDATE journeys SET parent_journey_id = NULL WHERE name = '关键词获客' RETURNING kind`);
    expect(moved.rows[0].kind).toBe('value_stream');
    await expect(
      client.query(`INSERT INTO journeys (name, kind) VALUES ('x', 'capability')`)
    ).rejects.toThrow(/non-DEFAULT value into column "kind"/);
  });

  it('value_streams 只出无父行，capabilities 视图只出有父行', async () => {
    await run(migrationSql);
    const vs = await client.query(`INSERT INTO journeys (name) VALUES ('私域客服') RETURNING id`);
    for (const n of ['被动接待', '朋友圈发布', '经营汇报']) {
      await client.query(`INSERT INTO journeys (name, parent_journey_id) VALUES ($1, $2)`, [n, vs.rows[0].id]);
    }
    await client.query(`INSERT INTO journeys (name) VALUES ('智能获客')`);
    const a = await client.query(`SELECT count(*)::int AS n FROM value_streams`);
    const b = await client.query(`SELECT count(*)::int AS n FROM capabilities`);
    const all = await client.query(`SELECT count(*)::int AS n FROM journeys`);
    expect(a.rows[0].n).toBe(2);
    expect(b.rows[0].n).toBe(3);
    expect(all.rows[0].n).toBe(5);
    const names = await client.query(`SELECT name FROM capabilities ORDER BY name`);
    expect(names.rows.map((r) => r.name).sort()).toEqual(['朋友圈发布', '经营汇报', '被动接待'].sort());
  });

  it('旧 capabilities 腾名后一行不丢、CHECK 还在、pr_plans 外键跟着改指向 capabilities_legacy', async () => {
    const before = await client.query(`SELECT count(*)::int AS n FROM capabilities`);
    await run(migrationSql);
    const after = await client.query(`SELECT count(*)::int AS n FROM capabilities_legacy`);
    expect(before.rows[0].n).toBe(3);
    expect(after.rows[0].n).toBe(before.rows[0].n);
    const fk = await client.query(
      `SELECT confrelid::regclass::text AS target FROM pg_constraint
        WHERE contype = 'f'
          AND conrelid = (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                           WHERE c.relname = 'pr_plans' AND n.nspname = $1)`,
      [schemaName]
    );
    expect(fk.rows[0].target).toMatch(/capabilities_legacy$/);
    await expect(
      client.query(`INSERT INTO capabilities_legacy (id, name, current_stage) VALUES ('z','Z',9)`)
    ).rejects.toThrow(/current_stage/);
    const joined = await client.query(
      `SELECT count(*)::int AS n FROM pr_plans p JOIN capabilities_legacy c ON c.id = p.capability_id`
    );
    expect(joined.rows[0].n).toBe(2);
  });

  it('areas 自引用可插 Sub-Area，禁止自己当自己父亲，父删子的 parent 置空', async () => {
    await run(migrationSql);
    const top = await client.query(`INSERT INTO areas (name) VALUES ('ZenithJoy') RETURNING id`);
    const sub = await client.query(
      `INSERT INTO areas (name, parent_area_id) VALUES ('新媒体部门', $1) RETURNING id, parent_area_id`,
      [top.rows[0].id]
    );
    expect(sub.rows[0].parent_area_id).toBe(top.rows[0].id);
    await expect(
      client.query(`UPDATE areas SET parent_area_id = id WHERE id = $1`, [sub.rows[0].id])
    ).rejects.toThrow(/areas_parent_not_self/);
    await client.query(`DELETE FROM areas WHERE id = $1`, [top.rows[0].id]);
    const orphan = await client.query(`SELECT parent_area_id FROM areas WHERE id = $1`, [sub.rows[0].id]);
    expect(orphan.rowCount).toBe(1);
    expect(orphan.rows[0].parent_area_id).toBeNull();
  });

  it('回滚：视图还原为全表、旧表名还原、kind 与 parent_area_id 删除、schema_version 493 删除', async () => {
    await run(migrationSql);
    await run(rollbackSql);
    expect(await relkind('capabilities')).toBe('r');
    expect(await relkind('capabilities_legacy')).toBeNull();
    const cols = await client.query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = $1 AND column_name IN ('kind','parent_area_id')`,
      [schemaName]
    );
    expect(cols.rows).toEqual([]);
    await client.query(`INSERT INTO journeys (name) VALUES ('x')`);
    const vs = await client.query(`SELECT count(*)::int AS n FROM value_streams`);
    expect(vs.rows[0].n).toBe(1);
    const ver = await client.query(`SELECT version FROM schema_version WHERE version = '493'`);
    expect(ver.rowCount).toBe(0);
  });
});
