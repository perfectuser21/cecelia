/**
 * Migration 495 价值流建模④（真 PostgreSQL）：spans 表 + CHECK + 幂等唯一键 / task_runs.workflow_id /
 * activity_flow_metrics 视图（fallback_rate、first_pass_yield、p50/p95）/ 回滚。
 * 决策 3e867cad 第 9-10 张表；任务 ec643d60。
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
const migrationSql = fs.readFileSync(path.resolve(__dirname, '../../../migrations/495_vs_model_spans.sql'), 'utf8');
const rollbackSql = fs.readFileSync(path.resolve(__dirname, '../../../migrations/rollback/495_vs_model_spans.down.sql'), 'utf8');

if (!/_test$|_scratch$/.test(DB_DEFAULTS.database || '')) {
  throw new Error(`migration 495 integration test requires a test database, got ${DB_DEFAULTS.database}`);
}

const VS = 'afa6abca-53c0-4815-8594-b7fb81ca547f';
const CAP = 'a1000000-0000-4000-8000-000000000001';
const WF = 'b1000000-0000-4000-8000-000000000001';

const pool = new pg.Pool({ ...DB_DEFAULTS, max: 2 });
let client;
let schemaName;
let activityId;
let stepId;
let enablerId;
const q = (identifier) => `"${identifier.replaceAll('"', '""')}"`;

async function createParentTables() {
  await client.query(`
    CREATE TABLE schema_version (version VARCHAR(10) PRIMARY KEY, description TEXT, applied_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE journeys (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(200) NOT NULL, parent_journey_id UUID REFERENCES journeys(id)
    );
    CREATE TABLE journey_steps (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), journey_id UUID REFERENCES journeys(id), name VARCHAR(200) NOT NULL,
      step_number INTEGER, backbone_version TEXT, capability_key TEXT, activity_key TEXT, workflow_id UUID
    );
    CREATE TABLE workflows (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), capability_id uuid NOT NULL REFERENCES journeys(id), key text NOT NULL UNIQUE, name text NOT NULL
    );
    CREATE TABLE enablers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key text NOT NULL UNIQUE, name text NOT NULL, kind text NOT NULL);
    CREATE TABLE steps (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), activity_id uuid NOT NULL REFERENCES journey_steps(id), step_order integer NOT NULL,
      key text NOT NULL UNIQUE, activity_key text NOT NULL
    );
    CREATE TABLE tasks (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE TABLE task_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid REFERENCES tasks(id), run_id text NOT NULL,
      started_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz, status text NOT NULL DEFAULT 'running'
    );
    INSERT INTO journeys (id, name) VALUES ('${VS}', '客户智能获客路径');
    INSERT INTO journeys (id, name, parent_journey_id) VALUES ('${CAP}', '关键词获客', '${VS}');
    INSERT INTO workflows (id, capability_id, key, name) VALUES ('${WF}', '${CAP}', 'douyin_keyword_leadgen', '抖音·关键词获客');
  `);
  const a = await client.query(
    `INSERT INTO journey_steps (journey_id, name, step_number, backbone_version, capability_key, activity_key, workflow_id)
     VALUES ($1, '采集', 4, '3.0', 'keyword_acquisition', 'collection', $2) RETURNING id`, [VS, WF],
  );
  activityId = a.rows[0].id;
  const s = await client.query(
    `INSERT INTO steps (activity_id, step_order, key, activity_key)
     VALUES ($1, 26, 'keyword_acquisition.collection.return_to_results', 'collection') RETURNING id`, [activityId],
  );
  stepId = s.rows[0].id;
  const e = await client.query(`INSERT INTO enablers (key, name, kind) VALUES ('return_to_results', '归位', 'code') RETURNING id`);
  enablerId = e.rows[0].id;
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

function insertSpan({ runId = 'social-keyword-leadgen-crontab-t1__a1.collection', activity = activityId, step = null, enabler = null,
  startedAt, endedAt = null, fallback = false, outcome = 'pass', executor = 'code' }) {
  return client.query(
    `INSERT INTO spans (run_id, workflow_id, activity_id, step_id, enabler_id, started_at, ended_at, executor_kind, executor_id, attempts, fallback, outcome)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'xian-m4', 1, $9, $10)
     ON CONFLICT (run_id, (COALESCE(step_id, activity_id, enabler_id)), started_at) DO NOTHING`,
    [runId, WF, activity, step, enabler, startedAt, endedAt, executor, fallback, outcome],
  );
}

afterAll(async () => {
  await pool.end();
});

describe('migration 495 — 价值流建模④', () => {
  beforeEach(async () => {
    schemaName = `migration_495_${process.pid}_${randomUUID().replaceAll('-', '')}`;
    client = await pool.connect();
    await client.query(`CREATE SCHEMA ${q(schemaName)}`);
    await client.query(`SET search_path TO ${q(schemaName)}, public`);
    await createParentTables();
  });

  afterEach(async () => {
    await client.query(`DROP SCHEMA IF EXISTS ${q(schemaName)} CASCADE`);
    client.release();
  });

  it('重放幂等：写 schema_version 495；spans 表与视图存在；task_runs 有 workflow_id', async () => {
    await run(migrationSql);
    await run(migrationSql);
    expect((await client.query(`SELECT 1 FROM schema_version WHERE version = '495'`)).rowCount).toBe(1);
    expect((await client.query(`SELECT to_regclass($1) AS r`, [`${schemaName}.spans`])).rows[0].r).not.toBeNull();
    expect((await client.query(`SELECT to_regclass($1) AS r`, [`${schemaName}.activity_flow_metrics`])).rows[0].r).not.toBeNull();
    expect(await columns('task_runs')).toContain('workflow_id');
  });

  it('CHECK：至少挂一个目标；executor_kind / outcome 非法值被拒；duration_ms 由 started/ended 生成', async () => {
    await run(migrationSql);
    await expect(client.query(
      `INSERT INTO spans (run_id, started_at, executor_kind, outcome) VALUES ('r', now(), 'code', 'pass')`,
    )).rejects.toThrow(/spans_target_check/);
    await expect(client.query(
      `INSERT INTO spans (run_id, activity_id, started_at, executor_kind, outcome) VALUES ('r', $1, now(), 'robot', 'pass')`, [activityId],
    )).rejects.toThrow(/spans_executor_kind_check/);
    await expect(client.query(
      `INSERT INTO spans (run_id, activity_id, started_at, executor_kind, outcome) VALUES ('r', $1, now(), 'code', 'meh')`, [activityId],
    )).rejects.toThrow(/spans_outcome_check/);
    const t0 = '2026-09-30T10:00:00Z';
    await insertSpan({ startedAt: t0, endedAt: '2026-09-30T10:00:02.5Z' });
    const r = await client.query(`SELECT duration_ms FROM spans`);
    expect(r.rows[0].duration_ms).toBe(2500);
  });

  it('幂等唯一键：同 run_id + 同目标 + 同 started_at 重发不增行；不同目标可共存；step/enabler 级也能记', async () => {
    await run(migrationSql);
    const t0 = '2026-09-30T10:00:00Z';
    await insertSpan({ startedAt: t0 });
    await insertSpan({ startedAt: t0 });
    expect((await client.query(`SELECT count(*)::int AS n FROM spans`)).rows[0].n).toBe(1);
    await insertSpan({ startedAt: t0, activity: null, step: stepId, fallback: true });
    await insertSpan({ startedAt: t0, activity: null, enabler: enablerId });
    expect((await client.query(`SELECT count(*)::int AS n FROM spans`)).rows[0].n).toBe(3);
  });

  it('activity_flow_metrics：4 条 span 其中 2 条 fallback → fallback_rate 0.5、first_pass_yield 0.5、runs 数与 p50/p95 有值；8 天前的不算', async () => {
    await run(migrationSql);
    const base = Date.now() - 60 * 60 * 1000;
    const at = (i) => new Date(base + i * 1000).toISOString();
    const end = (i, ms) => new Date(base + i * 1000 + ms).toISOString();
    await insertSpan({ runId: 'run-a', startedAt: at(1), endedAt: end(1, 1000), fallback: false });
    await insertSpan({ runId: 'run-a', startedAt: at(2), endedAt: end(2, 3000), fallback: true });
    await insertSpan({ runId: 'run-b', startedAt: at(3), endedAt: end(3, 2000), fallback: false });
    await insertSpan({ runId: 'run-b', startedAt: at(4), endedAt: end(4, 4000), fallback: true });
    const old = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
    await insertSpan({ runId: 'run-old', startedAt: old, endedAt: old, fallback: true });
    const m = await client.query(`SELECT * FROM activity_flow_metrics WHERE activity_id = $1`, [activityId]);
    expect(m.rowCount).toBe(1);
    const row = m.rows[0];
    expect(row.span_count).toBe(4);
    expect(row.runs).toBe(2);
    expect(Number(row.fallback_rate)).toBeCloseTo(0.5, 6);
    expect(Number(row.first_pass_yield)).toBeCloseTo(0.5, 6);
    expect(Number(row.p50_duration_ms)).toBeGreaterThan(0);
    expect(Number(row.p95_duration_ms)).toBeGreaterThanOrEqual(Number(row.p50_duration_ms));
    expect(row.activity_key).toBe('collection');
    expect(row.workflow_id).toBe(WF);
  });

  it('回滚：视图/表/索引/task_runs.workflow_id 全部还原，schema_version 495 删除；再迁一次又能建', async () => {
    await run(migrationSql);
    await run(rollbackSql);
    expect((await client.query(`SELECT to_regclass($1) AS r`, [`${schemaName}.spans`])).rows[0].r).toBeNull();
    expect((await client.query(`SELECT to_regclass($1) AS r`, [`${schemaName}.activity_flow_metrics`])).rows[0].r).toBeNull();
    expect(await columns('task_runs')).not.toContain('workflow_id');
    expect((await client.query(`SELECT 1 FROM schema_version WHERE version = '495'`)).rowCount).toBe(0);
    await run(migrationSql);
    expect((await client.query(`SELECT to_regclass($1) AS r`, [`${schemaName}.spans`])).rows[0].r).not.toBeNull();
  });
});
