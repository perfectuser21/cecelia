/**
 * Migration 494 价值流建模③（真 PostgreSQL）：workflows 表 + capability 守卫触发器 /
 * journey_steps.workflow_id·executor_kind·enabler_id / backbone_activities 视图新列 /
 * ops_workflows.workflow_id / 智能获客回填（2 capability + 2 workflow + 8 activity）/ 回滚。
 * 决策 3e867cad 第 4-5 张表、752b7166；任务 ce41cd59。
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
const migrationSql = fs.readFileSync(path.resolve(__dirname, '../../../migrations/494_vs_model_workflows.sql'), 'utf8');
const rollbackSql = fs.readFileSync(path.resolve(__dirname, '../../../migrations/rollback/494_vs_model_workflows.down.sql'), 'utf8');

if (!/_test$|_scratch$/.test(DB_DEFAULTS.database || '')) {
  throw new Error(`migration 494 integration test requires a test database, got ${DB_DEFAULTS.database}`);
}

const VS = 'afa6abca-53c0-4815-8594-b7fb81ca547f';
const ACTIVITIES = [
  ['preflight', '预检'], ['discovery', '发现'], ['qualification', '判定'], ['collection', '采集'],
  ['scoring', '评分'], ['delivery', '配送'], ['outreach', '触达'], ['cleanup', '归位'],
];

const pool = new pg.Pool({ ...DB_DEFAULTS, max: 2 });
let client;
let schemaName;
const q = (identifier) => `"${identifier.replaceAll('"', '""')}"`;

async function createParentTables() {
  await client.query(`
    CREATE TABLE schema_version (version VARCHAR(10) PRIMARY KEY, description TEXT, applied_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE areas (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(200) NOT NULL);
    CREATE TABLE journeys (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(200) NOT NULL, parent_journey_id UUID REFERENCES journeys(id),
      description TEXT, journey_type VARCHAR(50), maturity VARCHAR(50), status VARCHAR(50), area_id UUID REFERENCES areas(id)
    );
    CREATE TABLE journey_steps (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), notion_id VARCHAR(100), journey_id UUID REFERENCES journeys(id),
      name VARCHAR(200) NOT NULL, description TEXT, step_number INTEGER, status VARCHAR(50),
      notion_synced_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
      promise TEXT, backbone_version TEXT, capability_key TEXT, activity_key TEXT
    );
    CREATE VIEW backbone_activities AS SELECT id, notion_id, journey_id, name, description, step_number, status,
      notion_synced_at, created_at, updated_at, promise, backbone_version FROM journey_steps;
    CREATE TABLE enablers (
      id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, key text NOT NULL UNIQUE, name text NOT NULL, kind text NOT NULL,
      impl_ref text, owner text, description text, active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT enablers_kind_check CHECK (kind IN ('code', 'agent'))
    );
    CREATE TABLE enabler_calls (
      id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, caller_type text NOT NULL, caller_id uuid NOT NULL,
      enabler_id uuid NOT NULL REFERENCES enablers(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT enabler_calls_caller_type_check CHECK (caller_type IN ('activity', 'step')),
      CONSTRAINT enabler_calls_unique UNIQUE (caller_type, caller_id, enabler_id)
    );
    CREATE TABLE ops_workflows (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), wf_id TEXT, name TEXT);
    INSERT INTO journeys (id, name, journey_type, maturity, status) VALUES ('${VS}', '客户智能获客路径', 'user_facing', 'skeleton', 'active');
    INSERT INTO enablers (key, name, kind) VALUES ('return_to_results', '归位', 'code');
  `);
  for (let i = 0; i < ACTIVITIES.length; i++) {
    const [activityKey, name] = ACTIVITIES[i];
    await client.query(
      `INSERT INTO journey_steps (journey_id, name, step_number, status, backbone_version, capability_key, activity_key)
       VALUES ($1, $2, $3, 'active', '3.0', 'keyword_acquisition', $4)`,
      [VS, name, i + 1, activityKey],
    );
  }
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

afterAll(async () => {
  await pool.end();
});

describe('migration 494 — 价值流建模③', () => {
  beforeEach(async () => {
    schemaName = `migration_494_${process.pid}_${randomUUID().replaceAll('-', '')}`;
    client = await pool.connect();
    await client.query(`CREATE SCHEMA ${q(schemaName)}`);
    await client.query(`SET search_path TO ${q(schemaName)}, public`);
    await createParentTables();
  });

  afterEach(async () => {
    await client.query(`DROP SCHEMA IF EXISTS ${q(schemaName)} CASCADE`);
    client.release();
  });

  it('重放幂等：写 schema_version 494，2 capability + 2 workflow 只种一次', async () => {
    await run(migrationSql);
    await run(migrationSql);
    expect((await client.query(`SELECT 1 FROM schema_version WHERE version = '494'`)).rowCount).toBe(1);
    const caps = await client.query(`SELECT name FROM journeys WHERE parent_journey_id = $1 ORDER BY name`, [VS]);
    expect(caps.rows.map((r) => r.name)).toEqual(['关键词获客', '对标获客']);
    const wfs = await client.query(`SELECT key, channel, status FROM workflows ORDER BY key`);
    expect(wfs.rows).toEqual([
      { key: 'douyin_benchmark_leadgen', channel: 'douyin', status: 'active' },
      { key: 'douyin_keyword_leadgen', channel: 'douyin', status: 'active' },
    ]);
  });

  it('8 个 activity 全挂抖音·关键词获客；executor_kind 6 code / 2 agent；preflight/cleanup 带 enabler_id=device_lock', async () => {
    await run(migrationSql);
    const acts = await client.query(
      `SELECT js.activity_key, w.key AS wf_key, js.executor_kind, e.key AS enabler_key
         FROM journey_steps js LEFT JOIN workflows w ON w.id = js.workflow_id LEFT JOIN enablers e ON e.id = js.enabler_id
        WHERE js.journey_id = $1 ORDER BY js.step_number`, [VS]);
    expect(acts.rowCount).toBe(8);
    expect(acts.rows.every((r) => r.wf_key === 'douyin_keyword_leadgen')).toBe(true);
    const kinds = acts.rows.map((r) => r.executor_kind);
    expect(kinds.filter((k) => k === 'code').length).toBe(6);
    expect(kinds.filter((k) => k === 'agent').length).toBe(2);
    expect(acts.rows.find((r) => r.activity_key === 'qualification').executor_kind).toBe('agent');
    expect(acts.rows.find((r) => r.activity_key === 'scoring').executor_kind).toBe('agent');
    expect(acts.rows.find((r) => r.activity_key === 'preflight').enabler_key).toBe('device_lock');
    expect(acts.rows.find((r) => r.activity_key === 'cleanup').enabler_key).toBe('device_lock');
    expect(acts.rows.find((r) => r.activity_key === 'collection').enabler_key).toBeNull();
    const calls = await client.query(
      `SELECT js.activity_key, e.key FROM enabler_calls ec JOIN enablers e ON e.id = ec.enabler_id
         JOIN journey_steps js ON js.id = ec.caller_id WHERE ec.caller_type = 'activity' ORDER BY js.step_number, e.key`);
    expect(calls.rows).toEqual([
      { activity_key: 'preflight', key: 'account_selfcheck' },
      { activity_key: 'preflight', key: 'device_lock' },
      { activity_key: 'cleanup', key: 'device_lock' },
    ]);
  });

  it('守卫：capability_id 指向无父 journey（价值流）被触发器拒绝；指向有父的通过；executor_kind 非法值被拒', async () => {
    await run(migrationSql);
    await expect(client.query(
      `INSERT INTO workflows (capability_id, key, name, channel) VALUES ($1, 'bad_wf', '坏', 'douyin')`, [VS],
    )).rejects.toThrow(/must reference a capability/);
    const cap = await client.query(`SELECT id FROM journeys WHERE parent_journey_id = $1 AND name = '关键词获客'`, [VS]);
    await client.query(
      `INSERT INTO workflows (capability_id, key, name, channel) VALUES ($1, 'xiaohongshu_keyword_leadgen', '小红书·关键词获客', 'xiaohongshu')`,
      [cap.rows[0].id],
    );
    expect((await client.query(`SELECT count(*)::int AS n FROM workflows`)).rows[0].n).toBe(3);
    await expect(client.query(
      `UPDATE journey_steps SET executor_kind = 'robot' WHERE activity_key = 'preflight'`,
    )).rejects.toThrow(/executor_kind/);
  });

  it('backbone_activities 视图带出新列；ops_workflows 加 workflow_id；不删 journey_id', async () => {
    await run(migrationSql);
    const viewCols = await columns('backbone_activities');
    for (const c of ['journey_id', 'capability_key', 'activity_key', 'workflow_id', 'executor_kind', 'enabler_id']) {
      expect(viewCols, `视图缺 ${c}`).toContain(c);
    }
    expect(await columns('ops_workflows')).toContain('workflow_id');
    const v = await client.query(`SELECT activity_key, executor_kind FROM backbone_activities WHERE journey_id = $1 AND activity_key = 'scoring'`, [VS]);
    expect(v.rows[0].executor_kind).toBe('agent');
  });

  it('回滚：表/列/触发器/种子全部还原，视图回到 12 列，journey_steps 8 行仍在；再迁一次又能种回', async () => {
    await run(migrationSql);
    await run(rollbackSql);
    expect((await client.query(`SELECT to_regclass($1) AS r`, [`${schemaName}.workflows`])).rows[0].r).toBeNull();
    const cols = await columns('journey_steps');
    expect(cols).not.toContain('workflow_id');
    expect(cols).not.toContain('executor_kind');
    expect(cols).not.toContain('enabler_id');
    expect(await columns('backbone_activities')).toHaveLength(12);
    expect(await columns('ops_workflows')).not.toContain('workflow_id');
    expect((await client.query(`SELECT count(*)::int AS n FROM journey_steps`)).rows[0].n).toBe(8);
    expect((await client.query(`SELECT count(*)::int AS n FROM enablers WHERE key IN ('device_lock','account_selfcheck')`)).rows[0].n).toBe(0);
    expect((await client.query(`SELECT count(*)::int AS n FROM journeys WHERE parent_journey_id = $1`, [VS])).rows[0].n).toBe(0);
    expect((await client.query(`SELECT 1 FROM schema_version WHERE version = '494'`)).rowCount).toBe(0);
    await run(migrationSql);
    expect((await client.query(`SELECT count(*)::int AS n FROM workflows`)).rows[0].n).toBe(2);
  });
});
