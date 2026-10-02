import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
import { syncDirectoryAreas } from '../../projection/directory-areas.js';

let client, schema, pool, rootId, dbId, rootPage, childPage, pages, calls;
const page = (id, name, parent = null) => ({ id, parent: { database_id: dbId }, properties: {
  Name: { title: [{ plain_text: name }] }, 'Parent item': { relation: parent ? [{ id: parent }] : [] },
  Archive: { checkbox: false }, Domain: { select: { name: 'System' } },
} });
beforeEach(async () => {
  if (!(DB_DEFAULTS.database === 'cecelia_scratch' || (process.env.CI === 'true' && DB_DEFAULTS.database === 'cecelia_test'))) throw new Error('仅允许隔离测试数据库');
  client = new pg.Client(DB_DEFAULTS); await client.connect();
  expect((await client.query('SELECT current_database() AS name')).rows[0].name).toBe(DB_DEFAULTS.database);
  schema = `directory_areas_${randomUUID().replaceAll('-', '')}`;
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`SET search_path TO ${schema}`);
  await client.query(`CREATE TABLE areas(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name varchar NOT NULL,domain varchar,
    archived boolean NOT NULL DEFAULT false,notion_id varchar UNIQUE,parent_area_id uuid REFERENCES areas(id),
    owner varchar NOT NULL DEFAULT 'user',notion_props jsonb,notion_synced_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE cecelia_events(id bigserial PRIMARY KEY,event_type text,source text,payload jsonb)`);
  pool = { query: client.query.bind(client), connect: async () => ({ query: client.query.bind(client), release() {} }) };
  rootId = randomUUID(); dbId = randomUUID(); rootPage = randomUUID(); childPage = randomUUID(); calls = [];
  await client.query(`INSERT INTO areas(id,name,owner) VALUES($1,'Cecelia','Alex')`, [rootId]);
  pages = [page(rootPage, 'Cecelia'), page(childPage, '管家', rootPage)];
});
afterEach(async () => {
  if (client) {
    await client.query('ROLLBACK'); await client.query('SET search_path TO public');
    if (schema) await client.query(`DROP SCHEMA ${schema} CASCADE`);
    await client.end();
  }
});
const notionReq = async (_token, path, method) => {
  calls.push({ path, method }); return { results: structuredClone(pages), has_more: false };
};
const run = (extra = {}) => syncDirectoryAreas(pool, {
  token: 'test', dbId, notionReq, actor: 'test-directory',
  bindings: [{ brain_id: rootId, notion_id: rootPage, expected_name: 'Cecelia' }], ...extra,
});
const rows = async () => (await client.query('SELECT * FROM areas ORDER BY name')).rows;
describe('组织入口真实事务回灌', () => {
  it('保原UUID与owner，父子落真身；事件留原值且第二轮无新增/改写', async () => {
    const first = await run(); expect(first.changed).toBe(2); expect(first.event_id).toBeTruthy();
    const after = await rows();
    expect(after.find(x => x.name === 'Cecelia')).toMatchObject({ id: rootId, notion_id: rootPage, owner: 'Alex', parent_area_id: null });
    expect(after.find(x => x.name === '管家')).toMatchObject({ parent_area_id: rootId, notion_id: childPage });
    const event = (await client.query('SELECT payload FROM cecelia_events')).rows[0].payload;
    expect(event.actor).toBe('test-directory'); expect(event.changes.find(x => x.id === rootId).before.notion_id).toBeNull();
    expect((await run()).changed).toBe(0); expect(await rows()).toEqual(after);
    expect((await client.query('SELECT count(*)::int AS n FROM cecelia_events')).rows[0].n).toBe(1);
    expect(calls.every(x => x.method === 'POST' && x.path.endsWith('/query'))).toBe(true);
  });
  it('没有显式身份绑定不按同名收编，整批零写', async () => {
    const before = await rows(); await expect(run({ bindings: [] })).rejects.toThrow(/binding_required/);
    expect(await rows()).toEqual(before);
  });
  it('旧同名行已明确绑定一个分支，其它分支同名节点获得独立身份', async () => {
    const old = randomUUID(), otherRoot = randomUUID(), otherDashboard = randomUUID();
    await client.query(`INSERT INTO areas(id,name) VALUES($1,'Dashboard')`, [old]);
    pages = [page(rootPage, 'Cecelia'), page(childPage, 'Dashboard', rootPage),
      page(otherRoot, 'ZenithJoy'), page(otherDashboard, 'Dashboard', otherRoot)];
    await run({ bindings: [{ brain_id: rootId, notion_id: rootPage, expected_name: 'Cecelia' },
      { brain_id: old, notion_id: childPage, expected_name: 'Dashboard' }] });
    const after = await rows(), first = after.find(x => x.notion_id === childPage), second = after.find(x => x.notion_id === otherDashboard);
    expect(first.id).toBe(old); expect(second.id).not.toBe(old);
    expect(first.parent_area_id).toBe(rootId); expect(second.parent_area_id).toBe(after.find(x => x.notion_id === otherRoot).id);
    expect((await run()).changed).toBe(0);
  });
  it.each(['cycle', 'missing_parent', 'partial_relation', 'wrong_database', 'duplicate_page'])('%s 拒绝不完整组织快照', async reason => {
    const before = await rows();
    if (reason === 'cycle') pages[0].properties['Parent item'].relation = [{ id: childPage }];
    if (reason === 'missing_parent') pages[1].properties['Parent item'].relation = [{ id: randomUUID() }];
    if (reason === 'partial_relation') pages[1].properties['Parent item'].has_more = true;
    if (reason === 'wrong_database') pages[1].parent.database_id = randomUUID();
    if (reason === 'duplicate_page') pages.push(pages[0]);
    await expect(run()).rejects.toThrow(); expect(await rows()).toEqual(before);
  });
  it('已绑定后人改名称和Parent生效，清空Parent也生效，原owner不变', async () => {
    await run(); pages[0].properties.Name.title = [{ plain_text: 'Cecelia 新名称' }];
    pages[1].properties['Parent item'].relation = [];
    expect((await run()).changed).toBe(2);
    expect((await rows()).find(x => x.id === rootId)).toMatchObject({ name: 'Cecelia 新名称', owner: 'Alex' });
    expect((await rows()).find(x => x.notion_id === childPage).parent_area_id).toBeNull();
  });
  it('事件留痕失败回滚全部组织改动', async () => {
    const before = await rows();
    await client.query(`ALTER TABLE cecelia_events ADD CONSTRAINT reject_event CHECK (false)`);
    await expect(run()).rejects.toThrow(); expect(await rows()).toEqual(before);
  });
  it('读分页必须走到完整终页；重复游标拒绝，不能处理半棵树', async () => {
    const before = await rows();
    await expect(run({ notionReq: async () => ({ results: [], has_more: true, next_cursor: 'same' }) })).rejects.toThrow(/pagination/);
    expect(await rows()).toEqual(before);
  });
});
