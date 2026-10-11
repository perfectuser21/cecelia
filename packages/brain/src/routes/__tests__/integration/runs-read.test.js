/**
 * GET /api/brain/runs/:run_id 执行记录总记录读接口（任务 05cfbcde）。
 * 私有 schema 真跑迁移 531/546 的触发器：先 POST /spans 写入，再 GET 读触发器建出的总记录与汇总值。
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { privateFixtureDatabase } from '../../../__tests__/fixtures/private-fixture-db.js';
import { minimumDefinitionSchema, migrationSql, migrationTable } from '../../../__tests__/fixtures/minimum-definition-schema.js';
import { releaseEvidenceDatabase } from '../../../__tests__/fixtures/release-evidence-db.js';
import { DB_DEFAULTS } from '../../../db-config.js';
const holder = vi.hoisted(() => ({ pool: null }));
vi.mock('../../../db.js', () => ({ default: { query: (...a) => holder.pool.query(...a), connect: (...a) => holder.pool.connect(...a) } }));
vi.mock('../../../lib/activity-judge.js', () => ({ onSpansWritten: () => {} }));
import spansRouter from '../../spans.js';
import { createRunsReadRouter } from '../../runs-read.js';
import { createRunDefinitionsRouter } from '../../run-definitions.js';
import { createRunReconciliationRouter } from '../../run-reconciliation.js';

const TOKEN = 'runs-read-test-token';
let fixture, pool, app, activity, savedToken;
beforeEach(async () => {
  savedToken = process.env.CECELIA_INTERNAL_TOKEN;
  process.env.CECELIA_INTERNAL_TOKEN = TOKEN;
  fixture = await privateFixtureDatabase('runsread', async db => {
    await minimumDefinitionSchema(db);
    await db.query(migrationTable('433_ops_projection.sql', 'ops_schedule_entries'));
    for (const file of ['514_span_occurrences.sql', '531_runs_table.sql', '546_runs_terminal_span.sql']) await db.query(migrationSql(file));
  });
  pool = fixture.createPool(DB_DEFAULTS.max); holder.pool = pool;
  activity = randomUUID();
  const vs = randomUUID();
  await pool.query("INSERT INTO value_streams(id,name,parent_journey_id) VALUES($1,'runs读接口',NULL)", [vs]);
  await pool.query("INSERT INTO journey_steps(id,journey_id,name,step_number) VALUES($1,$2,'规格',1)", [activity, vs]);
  // 与 server.js 同顺序挂载：新路由在 run-definitions 之前
  app = express(); app.use(express.json());
  app.use('/api/brain', spansRouter);
  app.use('/api/brain/runs', createRunsReadRouter({ pool }));
  app.use('/api/brain/runs', createRunDefinitionsRouter({ pool }));
  app.use('/api/brain/runs', createRunReconciliationRouter({ pool }));
});
afterEach(async () => {
  if (savedToken === undefined) delete process.env.CECELIA_INTERNAL_TOKEN; else process.env.CECELIA_INTERNAL_TOKEN = savedToken;
  await fixture?.close(); fixture = null;
});

const newRunId = () => `coding-workflow:${randomUUID()}`;
const enc = id => encodeURIComponent(id);
const span = (run_id, extra = {}) => ({ run_id, activity_id: activity, occurrence_key: 'qa/spec/1', started_at: '2026-10-10T10:00:00.000Z',
  ended_at: '2026-10-10T10:00:05.000Z', executor_kind: 'agent', outcome: 'pass', tokens_in: 100, tokens_out: 20, cost_usd: 0.125, ...extra });
const post = body => request(app).post('/api/brain/spans').set('x-internal-token', TOKEN).send(body);
const get = (path, token = TOKEN) => { const r = request(app).get(path); return token ? r.set('x-internal-token', token) : r; };

it('POST span 后立即 GET（编码与裸冒号）拿到触发器建出的总记录，字段齐全且无 spans 键', async () => {
  const rid = newRunId();
  expect((await get(`/api/brain/runs/${enc(rid)}`)).status).toBe(404);
  const w = await post(span(rid)); expect(w.status, JSON.stringify(w.body)).toBe(200); expect(w.body.inserted).toBe(1);
  for (const path of [`/api/brain/runs/${enc(rid)}`, `/api/brain/runs/${rid}`]) {
    const r = await get(path); expect(r.status, JSON.stringify(r.body)).toBe(200);
    for (const k of ['run_id', 'workflow_id', 'trigger_kind', 'started_at', 'ended_at', 'outcome', 'header_source', 'tokens_in', 'tokens_out', 'cost_usd']) expect(r.body).toHaveProperty(k);
    expect(r.body).toMatchObject({ run_id: rid, trigger_kind: 'external', header_source: 'spans', outcome: 'pass', tokens_in: '100', tokens_out: '20' });
    expect(new Date(r.body.started_at).toISOString()).toBe('2026-10-10T10:00:00.000Z');
    expect(new Date(r.body.ended_at).toISOString()).toBe('2026-10-10T10:00:05.000Z');
    expect(Number(r.body.cost_usd)).toBe(0.125);
    expect('spans' in r.body).toBe(false);
  }
});

it('include=spans 按 started_at 升序附 span 全量，其它 include 值不附 spans 键', async () => {
  const rid = newRunId();
  const w = await post([span(rid, { occurrence_key: 'qa/b', started_at: '2026-10-10T11:00:10.000Z', ended_at: '2026-10-10T11:00:20.000Z', cost_usd: 0.2 }),
    span(rid, { occurrence_key: 'qa/a', started_at: '2026-10-10T11:00:00.000Z', ended_at: '2026-10-10T11:00:05.000Z', cost_usd: 0.1 })]);
  expect(w.body.inserted).toBe(2);
  const r = await get(`/api/brain/runs/${enc(rid)}?include=spans`); expect(r.status).toBe(200);
  expect(r.body.spans.map(s => s.occurrence_key)).toEqual(['qa/a', 'qa/b']);
  for (const s of r.body.spans) for (const k of ['occurrence_key', 'activity_id', 'outcome', 'cost_usd', 'started_at', 'ended_at']) expect(s).toHaveProperty(k);
  expect(r.body.spans[0].activity_id).toBe(activity);
  expect(Number(r.body.cost_usd)).toBeCloseTo(0.3, 6);
  for (const q of ['', '?include=foo']) expect('spans' in (await get(`/api/brain/runs/${enc(rid)}${q}`)).body).toBe(false);
  expect((await get(`/api/brain/runs/${enc(rid)}?include=foo,%20spans`)).body.spans).toHaveLength(2);
  expect((await get(`/api/brain/runs/${enc(rid)}?include=a&include=spans`)).body.spans).toHaveLength(2);
});

it('写入即可读：最差结果、546 终态 span 定 pass 并转 owner、重复上报不重复计费', async () => {
  const rid = newRunId(), url = `/api/brain/runs/${enc(rid)}`;
  await post(span(rid, { occurrence_key: 'qa/1', cost_usd: 0.1 }));
  expect(await get(url).then(r => [r.body.outcome, Number(r.body.cost_usd), r.body.header_source])).toEqual(['pass', 0.1, 'spans']);
  const failSpan = span(rid, { occurrence_key: 'qa/2', started_at: '2026-10-10T12:00:00.000Z', ended_at: '2026-10-10T12:00:03.000Z', outcome: 'fail', cost_usd: 0.05 });
  await post(failSpan);
  let r = await get(url); expect(r.body.outcome).toBe('fail'); expect(Number(r.body.cost_usd)).toBeCloseTo(0.15, 6);
  await post(span(rid, { occurrence_key: 'qa/3', started_at: '2026-10-10T12:10:00.000Z', ended_at: '2026-10-10T12:10:01.000Z', cost_usd: 0.01, evidence: { run_terminal: true } }));
  r = await get(url); expect(r.body).toMatchObject({ outcome: 'pass', header_source: 'owner' }); expect(Number(r.body.cost_usd)).toBeCloseTo(0.16, 6);
  expect((await post(failSpan)).body.inserted).toBe(0);
  r = await get(url); expect(r.body.outcome).toBe('pass'); expect(Number(r.body.cost_usd)).toBeCloseTo(0.16, 6);
});

it('不存在 404（含 include=spans 与 SQL 注入式输入），非法入参 400 不是 500', async () => {
  for (const path of [`/api/brain/runs/${enc(newRunId())}`, `/api/brain/runs/${enc(newRunId())}?include=spans`, '/api/brain/runs/x%27%20OR%20%271%27%3D%271', `/api/brain/runs/${'a'.repeat(200)}`]) {
    const r = await get(path); expect(r.status, path).toBe(404);
    expect(r.body.error).toMatch(/not found/); expect('spans' in r.body).toBe(false);
  }
  const cases = [['/api/brain/runs/%20%20', 'run_id is required'], ['/api/brain/runs/', 'run_id is required'], ['/api/brain/runs', 'run_id is required'],
    [`/api/brain/runs/${'a'.repeat(201)}`, 'run_id must be at most 200 characters'], ['/api/brain/runs/%E0%A4%A', 'run_id is not valid URL encoding']];
  for (const [path, error] of cases) { const r = await get(path); expect(r.status, path).toBe(400); expect(r.body).toEqual({ error }); }
});

it('鉴权：缺/错 token 401 不泄露记录，正确 token 200；原两段路由鉴权与行为不变', async () => {
  const rid = newRunId(); await post(span(rid));
  for (const token of [null, 'wrong']) {
    const r = await get(`/api/brain/runs/${enc(rid)}`, token); expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED'); expect(r.body).not.toHaveProperty('run_id');
    for (const sub of ['definition', 'reconciliation']) {
      const s = await get(`/api/brain/runs/${enc(rid)}/${sub}`, token); expect(s.status, sub).toBe(401); expect(s.body.error.code).toBe('UNAUTHORIZED');
    }
    expect((await request(app).post(`/api/brain/runs/${enc(rid)}/definition`).set(token ? { 'x-internal-token': token } : {}).send({})).status).toBe(401);
  }
  expect((await request(app).get(`/api/brain/runs/${enc(rid)}`).set('authorization', `Bearer ${TOKEN}`)).status).toBe(200);
});

it('带 token 的两段请求穿过新路由落到原路由，行为不变', async () => {
  const f = await releaseEvidenceDatabase();
  try {
    const twoSegApp = express(); twoSegApp.use(express.json());
    twoSegApp.use('/api/brain/runs', createRunsReadRouter({ pool: f.db }));
    twoSegApp.use('/api/brain/runs', createRunDefinitionsRouter({ pool: f.db }));
    twoSegApp.use('/api/brain/runs', createRunReconciliationRouter({ pool: f.db }));
    const rid = enc(newRunId()), g = path => request(twoSegApp).get(path).set('x-internal-token', TOKEN);
    const def = await g(`/api/brain/runs/${rid}/definition`); expect(def.status, JSON.stringify(def.body)).toBe(404); expect(def.body.error.code).toBe('RUN_DEFINITION_UNKNOWN');
    const rec = await g(`/api/brain/runs/${rid}/reconciliation`); expect(rec.status, JSON.stringify(rec.body)).toBe(200); expect(rec.body).toHaveProperty('evidence_status', 'unknown');
    expect((await g(`/api/brain/runs/${rid}/definition`).unset('x-internal-token')).status).toBe(401);
  } finally { await f.close(); }
});
