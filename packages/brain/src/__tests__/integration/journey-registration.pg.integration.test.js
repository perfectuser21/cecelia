import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import pg from 'pg';
import express from 'express';
import request from 'supertest';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
import { likeSource } from '../fixtures/like-source.js';
const holder = vi.hoisted(() => ({ pool: null }));
vi.mock('../../db.js', () => ({ default: {
  query: (...args) => holder.pool.query(...args), connect: (...args) => holder.pool.connect(...args),
} }));
import router from '../../routes/journeys.js';
let admin, pool, schema, app, department, subarea, stream, capability;
beforeEach(async () => {
  if (!(DB_DEFAULTS.database === 'cecelia_scratch' || (process.env.CI === 'true' && DB_DEFAULTS.database === 'cecelia_test'))) throw new Error('仅允许隔离 scratch 或 CI 测试库');
  if (!process.env.CI && DB_DEFAULTS.host !== '/tmp') throw new Error('本地登记测试必须使用 /tmp PostgreSQL');
  admin = new pg.Client(DB_DEFAULTS); await admin.connect();
  expect((await admin.query('SELECT current_database() AS name')).rows[0].name).toBe(DB_DEFAULTS.database);
  schema = `journey_registration_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  for (const table of ['areas', 'journeys', 'workflows', 'journey_steps']) await admin.query(`CREATE TABLE ${schema}.${table} (LIKE public.${likeSource(table)} INCLUDING ALL)`);
  pool = new pg.Pool({ ...DB_DEFAULTS, options: `-c search_path=${schema}` }); holder.pool = pool;
  await pool.query('ALTER TABLE journeys ADD FOREIGN KEY(parent_journey_id) REFERENCES journeys(id), ADD FOREIGN KEY(area_id) REFERENCES areas(id)');
  await pool.query('ALTER TABLE workflows ADD FOREIGN KEY(capability_id) REFERENCES journeys(id)');
  await pool.query('ALTER TABLE journey_steps ADD FOREIGN KEY(journey_id) REFERENCES journeys(id)');
  department = randomUUID(); subarea = randomUUID(); stream = randomUUID(); capability = randomUUID();
  await pool.query("INSERT INTO areas(id,name,parent_area_id) VALUES($1,'部门',NULL),($2,'子部门',$1)", [department, subarea]);
  await pool.query("INSERT INTO journeys(id,name,parent_journey_id,area_id,capability_code) VALUES($1,'价值流',NULL,$3,NULL),($2,'能力',$1,NULL,'TEST_EXISTING')", [stream, capability, subarea]);
  app = express(); app.use(express.json()); app.use('/api/brain', router);
});
afterEach(async () => {
  if (pool) await pool.end();
  if (admin) { if (schema) await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
});
const create = body => request(app).post('/api/brain/journeys').send({ name: '新能力', journey_type: 'user_facing', ...body });
const patch = (id, body) => request(app).patch(`/api/brain/journeys/${id}`).send(body);
async function organization(id) {
  const moduleUrl = new URL('../../lib/journey-organization.js', import.meta.url);
  expect(existsSync(moduleUrl), '组织归属读取服务必须存在').toBe(true);
  return (await import('../../lib/journey-organization.js')).readJourneyOrganization(pool, id);
}

it('真实HTTP登记父关系、代码、部门与兼容字段，步骤和主体一起落库', async () => {
  const response = await create({ parent_journey_id: stream, capability_code: 'TEST_NEW', area_id: department,
    home: 'factory', trigger: '开始', endpoint: '结果', steps: ['预检', '执行'] });
  expect(response.status, response.body.error).toBe(201);
  const row = (await pool.query('SELECT * FROM journeys WHERE id=$1', [response.body.id])).rows[0];
  expect(row).toMatchObject({ parent_journey_id: stream, capability_code: 'TEST_NEW', area_id: department, kind: 'capability', home: 'factory' });
  expect((await pool.query('SELECT name FROM journey_steps WHERE journey_id=$1 ORDER BY step_number', [row.id])).rows).toEqual([{ name: '预检' }, { name: '执行' }]);
  const changed = await patch(row.id, { name: '改名能力', area_id: null, capability_code: 'TEST_RENAMED' });
  expect(changed.status).toBe(200); expect(changed.body).toMatchObject({ id: row.id, name: '改名能力', area_id: null, capability_code: 'TEST_RENAMED' });
});
it('无直接部门继承价值流且祖先路径稳定，直接归属优先，未知明确表示', async () => {
  const inherited = await organization(capability);
  expect(inherited).toMatchObject({ journey_id: capability, capability_id: capability, capability_code: 'TEST_EXISTING', value_stream_id: stream,
    direct_area: null, effective_area: { id: subarea }, source: 'inherited', gaps: [] });
  expect(inherited.area_path.map(a => a.id)).toEqual([department, subarea]);
  expect((await patch(capability, { area_id: department })).status).toBe(200);
  expect(await organization(capability)).toMatchObject({ direct_area: { id: department }, effective_area: { id: department }, source: 'direct' });
  expect((await patch(stream, { area_id: null })).status).toBe(200);
  expect(await organization(stream)).toMatchObject({ source: 'unknown', effective_area: null, area_path: [], gaps: ['area_unknown'] });
});
it('非法UUID返回400、缺失目标返回404、重复代码409且不留部分记录', async () => {
  expect((await create({ parent_journey_id: 'bad' })).status).toBe(400);
  expect((await patch('bad', { name: 'x' })).status).toBe(400);
  expect((await create({ area_id: randomUUID() })).status).toBe(404);
  expect((await create({ parent_journey_id: randomUUID() })).status).toBe(404);
  expect((await patch(randomUUID(), { name: 'x' })).status).toBe(404);
  expect((await create({ capability_code: 'TEST_EXISTING', parent_journey_id: stream })).status).toBe(409);
  expect((await pool.query('SELECT count(*)::int AS n FROM journeys')).rows[0].n).toBe(2);
});
it('拒绝自指、capability嵌套、带子项价值流降级以及带工作流能力脱离父级', async () => {
  expect((await patch(capability, { parent_journey_id: capability })).status).toBe(400);
  expect((await create({ parent_journey_id: capability })).status).toBe(400);
  const other = await create({ name: '另一价值流' });
  expect((await patch(stream, { parent_journey_id: other.body.id })).status).toBe(409);
  await pool.query("INSERT INTO workflows(capability_id,key,name,channel) VALUES($1,'test-workflow','工作流','api')", [capability]);
  expect((await patch(capability, { parent_journey_id: null })).status).toBe(409);
  expect((await pool.query('SELECT parent_journey_id FROM journeys WHERE id=$1', [capability])).rows[0].parent_journey_id).toBe(stream);
});
it('POST步骤失败回滚主体和此前步骤，兼容旧area名称登记', async () => {
  await pool.query("ALTER TABLE journey_steps ADD CONSTRAINT reject_review_step CHECK(name <> '拒绝步骤')");
  expect((await create({ name: '回滚主体', steps: ['已有步骤', '拒绝步骤'] })).status).toBe(400);
  expect((await pool.query("SELECT count(*)::int n FROM journeys WHERE name='回滚主体'")).rows[0].n).toBe(0);
  expect((await pool.query('SELECT count(*)::int n FROM journey_steps')).rows[0].n).toBe(0);
  const legacy = await create({ name: '兼容名称', area: '部门' });
  expect(legacy.status).toBe(201); expect(legacy.body.area_id).toBe(department);
});
it.each([null, ''])('旧POST可选字段为空%j时仍使用原默认值', async empty => {
  const response = await create({ maturity: empty, status: empty, description: empty,
    e2e_test_path: empty, home: empty, trigger: empty, endpoint: empty });
  expect(response.status, response.body.error).toBe(201);
  expect(response.body).toMatchObject({ maturity: 'not_started', status: 'active', description: null,
    e2e_test_path: null, home: null, trigger: null, endpoint: null });
});
it('相反并发父关系仅允许一方成功，最终无环或capability嵌套', async () => {
  const a = (await create({ name: 'A' })).body.id, b = (await create({ name: 'B' })).body.id;
  const results = await Promise.all([patch(a, { parent_journey_id: b }), patch(b, { parent_journey_id: a })]);
  expect(results.map(r => r.status).sort()).toEqual([200, 400]);
  const rows = (await pool.query('SELECT id,parent_journey_id FROM journeys WHERE id=ANY($1::uuid[])', [[a, b]])).rows;
  expect(rows.filter(r => r.parent_journey_id)).toHaveLength(1);
});
it('部门祖先成环不无限递归，读者显式报缺口、登记拒绝绑定', async () => {
  await pool.query('UPDATE areas SET parent_area_id=$1 WHERE id=$2', [subarea, department]);
  expect(await organization(capability)).toMatchObject({ source: 'unknown', effective_area: null, gaps: ['area_cycle'] });
  expect((await create({ area_id: subarea })).status).toBe(400);
});
