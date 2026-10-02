import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import express from 'express';
import request from 'supertest';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
const holder = vi.hoisted(() => ({ pool: null }));
vi.mock('../../db.js', () => ({ default: { query: (...args) => holder.pool.query(...args), connect: (...args) => holder.pool.connect(...args) } }));
import router from '../../routes/spans.js';
let admin, pool, schema, app, activity, workflow;
const migration = new URL('../../../migrations/514_span_occurrences.sql', import.meta.url);
beforeEach(async () => {
  if (!(DB_DEFAULTS.database === 'cecelia_scratch' || (process.env.CI === 'true' && DB_DEFAULTS.database === 'cecelia_test'))) throw new Error('Span测试仅允许隔离scratch或CI测试库');
  if (!process.env.CI && DB_DEFAULTS.host !== '/tmp') throw new Error('本地Span测试只允许/tmp PostgreSQL');
  admin = new pg.Client(DB_DEFAULTS); await admin.connect();
  expect((await admin.query('SELECT current_database() name')).rows[0].name).toBe(DB_DEFAULTS.database);
  schema = `span_ingestion_${randomUUID().replaceAll('-', '')}`; await admin.query(`CREATE SCHEMA ${schema}`);
  for (const table of ['schema_version', 'journeys', 'workflows', 'enablers', 'journey_steps', 'steps', 'task_runs']) await admin.query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
  pool = new pg.Pool({ ...DB_DEFAULTS, options: `-c search_path=${schema}` }); holder.pool = pool;
  await pool.query(readFileSync(new URL('../../../migrations/495_vs_model_spans.sql', import.meta.url), 'utf8'));
  const journey = randomUUID(); activity = randomUUID(); workflow = randomUUID();
  await pool.query("INSERT INTO journeys(id,name) VALUES($1,'Span验收')", [journey]);
  await pool.query("INSERT INTO workflows(id,capability_id,key,name,channel) VALUES($1,$2,'span-test','工作流','test')", [workflow, journey]);
  await pool.query("INSERT INTO journey_steps(id,journey_id,name,step_number) VALUES($1,$2,'活动',1)", [activity, journey]);
  app = express(); app.use(express.json()); app.use('/api/brain', router);
});
afterEach(async () => {
  if (pool) await pool.end();
  if (admin) { if (schema) await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
});
async function migrate() {
  expect(existsSync(migration), 'occurrence迁移必须存在').toBe(true);
  await pool.query(readFileSync(migration, 'utf8'));
}
const span = (extra = {}) => ({ run_id: 'real-run', workflow_id: workflow, activity_id: activity,
  started_at: '2026-10-02T10:00:00.000Z', ended_at: '2026-10-02T10:00:01.000Z', executor_kind: 'code', outcome: 'pass', ...extra });
const post = body => request(app).post('/api/brain/spans').send(body);
const rows = async () => (await pool.query('SELECT * FROM spans ORDER BY created_at,id')).rows;

it('旧数据不猜occurrence，迁移重复无损，旧客户端继续按原键幂等', async () => {
  await pool.query(`INSERT INTO spans(run_id,activity_id,started_at,executor_kind,outcome)
    VALUES('real-run',$1,'2026-10-02T10:00:00Z','code','pass')`, [activity]);
  const original = (await rows())[0];
  await migrate(); await migrate();
  expect((await rows())[0]).toEqual({ ...original, occurrence_key: null, payload_sha256: null });
  const replay = await post(span({ outcome: 'fail' }));
  expect(replay.body).toMatchObject({ inserted: 0, skipped: 1 }); expect((await rows())[0].outcome).toBe('pass');
});
it('同run同活动同秒的不同发生位置都保留，新旧协议互不吞事件', async () => {
  await migrate();
  const response = await post([span({ occurrence_key: 'stage/1/attempt/1' }), span({ occurrence_key: 'stage/1/attempt/2' }), span()]);
  expect(response.status, response.body.error).toBe(200); expect(response.body).toMatchObject({ inserted: 3, skipped: 0, count: 3 });
  const stored = await rows(); expect(stored).toHaveLength(3);
  expect(new Set(stored.map(r => r.started_at.toISOString())).size).toBe(1);
  expect(new Set(stored.map(r => r.run_id))).toEqual(new Set(['real-run']));
});
it('同key同规范内容重传幂等，忽略客户端伪摘要且版本位置实现证据可读回', async () => {
  await migrate();
  const evidence = { workflow_definition_version_id: randomUUID(), reference_id: randomUUID(),
    activity_definition_version_id: randomUUID(), implementation: { revision: 'a'.repeat(40), repo: 'org/repo', path: 'run.js' } };
  const body = span({ occurrence_key: 'delivery:1:1', evidence, payload_sha256: '伪摘要' });
  const first = await post(body); expect(first.status).toBe(200);
  const replay = await post({ ...body, evidence: { implementation: evidence.implementation, ...evidence }, payload_sha256: '另一个伪摘要' });
  expect(replay.body).toEqual({ inserted: 0, skipped: 1, count: 1, ids: [] });
  const read = await request(app).get('/api/brain/spans').query({ run_id: body.run_id });
  expect(read.body.total).toBe(1); expect(read.body.spans[0]).toMatchObject({ evidence, occurrence_key: body.occurrence_key });
  expect(read.body.spans[0].payload_sha256).toMatch(/^[0-9a-f]{64}$/);
});
it('同key异body返回409保留原事实，批量前面的新事件也回滚', async () => {
  await migrate(); const original = span({ occurrence_key: 'same' }); await post(original);
  const before = await rows();
  const response = await post([span({ occurrence_key: 'new' }), { ...original, evidence: { changed: true } }]);
  expect(response.status).toBe(409);
  expect(response.body).toMatchObject({ code: 'SPAN_OCCURRENCE_CONFLICT', run_id: 'real-run', occurrence_key: 'same' });
  expect(await rows()).toEqual(before);
});
it('同批自身冲突及数据库外键失败均整批回滚', async () => {
  await migrate();
  expect((await post([span({ occurrence_key: 'self' }), span({ occurrence_key: 'self', outcome: 'fail' })])).status).toBe(409);
  expect(await rows()).toHaveLength(0);
  expect((await post([span({ occurrence_key: 'valid' }), span({ occurrence_key: 'bad-fk', activity_id: randomUUID() })])).status).toBe(500);
  expect(await rows()).toHaveLength(0);
});
it('并发相同事件只一条，冲突body只有一个成功且不同run可复用key', async () => {
  await migrate();
  const body = span({ occurrence_key: 'concurrent' });
  const repeated = await Promise.all([post(body), post(body)]);
  expect(repeated.map(r => r.status)).toEqual([200, 200]);
  expect(repeated.map(r => r.body.inserted).sort()).toEqual([0, 1]);
  const conflicting = await Promise.all([post(span({ occurrence_key: 'conflict', outcome: 'pass' })), post(span({ occurrence_key: 'conflict', outcome: 'fail' }))]);
  expect(conflicting.map(r => r.status).sort()).toEqual([200, 409]);
  expect((await post({ ...body, run_id: 'another-real-run' })).body.inserted).toBe(1);
  expect(await rows()).toHaveLength(3);
});
it('空白或非字符串occurrence返回400不入库，数据库拒绝缺摘要的新事件', async () => {
  await migrate();
  for (const occurrence_key of ['', '  ', 23, {}]) expect((await post(span({ occurrence_key }))).status).toBe(400);
  expect(await rows()).toHaveLength(0);
  await expect(pool.query(`INSERT INTO spans(run_id,activity_id,started_at,executor_kind,occurrence_key)
    VALUES('invalid',$1,now(),'code','missing-hash')`, [activity])).rejects.toThrow();
});
it.each(['occurrence', 'legacy'])('%s反序批次并发仍幂等且返回ids保持请求顺序', async protocol => {
  await migrate();
  await pool.query(`CREATE FUNCTION delay_span() RETURNS trigger AS $$BEGIN PERFORM pg_sleep(0.05);RETURN NEW;END$$ LANGUAGE plpgsql;
    CREATE TRIGGER delay_span AFTER INSERT ON spans FOR EACH ROW EXECUTE FUNCTION delay_span()`);
  const first = protocol === 'occurrence' ? span({ occurrence_key: 'a' }) : span();
  const second = protocol === 'occurrence' ? span({ occurrence_key: 'b' }) : span({ started_at: '2026-10-02T10:00:00.500Z' });
  const responses = await Promise.all([post([second, first]), post([first, second])]);
  expect(responses.map(r => ({ status: r.status, error: r.body.error }))).toEqual([{ status: 200, error: undefined }, { status: 200, error: undefined }]);
  expect(responses.map(r => r.body.inserted).sort()).toEqual([0, 2]);
  const saved = (await rows()).sort((a, b) => protocol === 'occurrence' ? a.occurrence_key.localeCompare(b.occurrence_key) : a.started_at - b.started_at);
  expect(saved).toHaveLength(2);
  expect(responses[0].body.ids).toEqual(responses[0].body.inserted ? [saved[1].id, saved[0].id] : []);
  expect(responses[1].body.ids).toEqual(responses[1].body.inserted ? [saved[0].id, saved[1].id] : []);
});
