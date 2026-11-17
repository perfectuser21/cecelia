import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import express from 'express';
import pg from 'pg';
import request from 'supertest';
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
import { createAcceptanceInternalRouter } from '../../routes/acceptance.js';
import { createTask } from '../../actions.js';

// Task dispatch is outside this regression. Persist the real router's emitted
// request to the isolated PG transaction, so rollback/task arguments are observable.
vi.mock('../../actions.js', () => ({ createTask: vi.fn(async ({ db, ...input }) => {
  const { rows } = await db.query('INSERT INTO tasks(payload,status) VALUES($1,$2) RETURNING *',
    [JSON.stringify(input.payload), input.status]);
  return { task: rows[0] };
}) }));
const schema = `acceptance_classification_${randomUUID().replaceAll('-', '')}`;
if (!['localhost', '127.0.0.1', '::1'].includes(DB_DEFAULTS.host)) throw new Error('local scratch database required');
const pool = new pg.Pool({ ...DB_DEFAULTS, database: 'cecelia_scratch', max: 2,
  options: `-c search_path=${schema}`, connectionTimeoutMillis: 3000 });
const app = express(); app.use(express.json()); app.use(createAcceptanceInternalRouter({ pool }));
const stamps = { backend_sha: 'a'.repeat(40), frontend_sha: 'b'.repeat(40), spec_sha: 'fixture-spec' };
let runKey;
const adjudicate = (key = 'S1-c1') => request(app).patch(`/runs/${runKey}/checks/${key}/adjudicate`)
  .send({ verdict: '绿', by: 'fixture-reviewer', reason: 'isolated PG evidence' });
const finish = () => request(app).patch(`/runs/${runKey}/adjudicate-run`).send({});
const checks = () => pool.query('SELECT * FROM acceptance_checks ORDER BY check_key');

async function setDetail(detail) {
  await pool.query("UPDATE acceptance_checks SET detail=$1::jsonb WHERE check_key='S1-c1'", [JSON.stringify(detail)]);
}
async function greenAll() {
  for (const n of [1, 2, 3]) {
    const result = await adjudicate(`S${n}-c1`);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
  }
}

describe.sequential('真实17列表的验收分类来源与裁决', () => {
  beforeAll(async () => {
    expect((await pool.query('SELECT current_database() AS db')).rows[0].db).toBe('cecelia_scratch');
    await pool.query(`CREATE SCHEMA "${schema}"`);
    vi.stubEnv('ACCEPTANCE_TENANT_ALLOWLIST', 'fixture-owner');
  });
  beforeEach(async () => {
    vi.mocked(createTask).mockClear();
    await pool.query('DROP TABLE IF EXISTS acceptance_checks, acceptance_runs, tasks, schema_version CASCADE');
    await pool.query(`CREATE TABLE schema_version(version text PRIMARY KEY, description text, applied_at timestamptz);
      CREATE TABLE tasks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payload jsonb, status text)`);
    // These actual shipped migrations reproduce the deployed 17-column table.
    for (const file of ['369_acceptance_tables.sql', '380_acceptance_staff_hub_columns.sql', '392_acceptance_two_column.sql']) {
      await pool.query(readFileSync(new URL(`../../../migrations/${file}`, import.meta.url), 'utf8'));
    }
    runKey = `classification-${randomUUID()}`;
    const made = await request(app).post('/runs').send({ run_key: runKey, title: 'API release fixture',
      detail: { ...stamps, backend_sha_src2: stamps.backend_sha, frontend_sha_src2: stamps.frontend_sha, tenant_account: 'fixture-owner' },
      checks: [1, 2, 3].map(n => ({ check_key: `S${n}-c1`, kind: 'FR', name: `check ${n}` })) });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const result = await request(app).post('/results').send({ run_key: runKey, ...stamps,
      results: [1, 2, 3].map(n => ({ check_key: `S${n}-c1`, result: '通过', note: 'fixture evidence' })) });
    expect(result.status).toBe(200);
    expect(result.body.runs[0].status).toBe('human_complete');
  });
  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end(); vi.unstubAllEnvs();
  });

  it('无分类API三格完成单格与整单裁决，持久化绿且不补列或改detail', async () => {
    const columns = await pool.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2', [schema, 'acceptance_checks']);
    expect(columns.rows).toHaveLength(17);
    expect(columns.rows.map(r => r.column_name)).not.toContain('is_hard');
    expect(columns.rows.map(r => r.column_name)).not.toContain('scenario_class');
    await greenAll();
    const done = await finish(); expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body).toMatchObject({ status: 'adjudicated', tasks: [] });
    const run = (await pool.query('SELECT status,detail FROM acceptance_runs')).rows[0];
    expect(run.status).toBe('adjudicated'); expect(run.detail.gate_verdict).toBe('绿');
    for (const row of (await checks()).rows) {
      expect(row.adjudication.verdict).toBe('绿'); expect(row.detail).toBeNull();
    }
    expect(createTask).not.toHaveBeenCalled();
  });
  it('JSON boolean hard=true调用原Hard绿格规则且任务请求在PG读回', async () => {
    await setDetail({ hard: true, scenario_class: 'mandatory' });
    expect((await adjudicate()).status).toBe(200);
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ priority: 'P0',
      payload: expect.objectContaining({ acceptance_bucket: 'hard_green_p0', check_key: 'S1-c1' }) }));
    expect((await pool.query('SELECT payload FROM tasks')).rows[0].payload.acceptance_bucket).toBe('hard_green_p0');
  });
  it('hard=true但本版不可验证时保留原例外注记、不产生P0', async () => {
    await setDetail({ hard: true, scenario_class: 'unverifiable_this_version' });
    expect((await adjudicate()).status).toBe(200);
    expect(createTask).not.toHaveBeenCalled();
    expect((await pool.query('SELECT detail FROM acceptance_runs')).rows[0].detail.unverifiable_adjudicated).toEqual(['S1-c1']);
  });
  it('trace分类保留整单原聚合追查规则', async () => {
    await setDetail({ hard: false, scenario_class: 'trace_q4' });
    await greenAll(); expect((await finish()).status).toBe(200);
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ priority: 'P2',
      payload: expect.objectContaining({ acceptance_bucket: 'trace' }) }));
    expect((await pool.query('SELECT payload FROM tasks')).rows[0].payload.acceptance_bucket).toBe('trace');
  });
  it('显式null分类保持未知，不制造默认false分类', async () => {
    await setDetail({ hard: null, scenario_class: null });
    await greenAll(); expect((await finish()).status).toBe(200);
    expect((await checks()).rows[0].detail).toEqual({ hard: null, scenario_class: null });
    expect(createTask).not.toHaveBeenCalled();
  });
  for (const detail of [{ hard: 'false' }, { hard: 'yes' }, { hard: 0 },
    { scenario_class: true }, { scenario_class: 1 }, { scenario_class: [] }, [], 'invalid']) {
    it(`错误分类${JSON.stringify(detail)}在两入口均拒绝且不落裁决或任务`, async () => {
      await setDetail(detail);
      expect((await adjudicate()).status).toBe(500);
      expect((await finish()).status).toBe(500);
      expect((await checks()).rows.every(row => row.adjudication === null)).toBe(true);
      const run = (await pool.query('SELECT status,detail FROM acceptance_runs')).rows[0];
      expect(run.status).toBe('human_complete'); expect(run.detail.gate_verdict).toBeUndefined();
      expect(createTask).not.toHaveBeenCalled();
      expect((await pool.query('SELECT count(*)::int AS n FROM tasks')).rows[0].n).toBe(0);
      expect((await checks()).rows[0].detail).toEqual(detail);
    });
  }
});
