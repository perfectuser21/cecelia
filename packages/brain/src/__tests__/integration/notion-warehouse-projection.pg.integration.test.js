import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
import { pushWarehouseItems, pushActivityUses } from '../../notion-warehouse-projection.js';

let client, schema;
beforeEach(async () => {
  if (!(DB_DEFAULTS.database === 'cecelia_scratch' || process.env.CI === 'true' && DB_DEFAULTS.database === 'cecelia_test')) throw new Error('仅允许scratch/CI隔离库');
  client = new pg.Client(DB_DEFAULTS); await client.connect();
  schema = `warehouse_${randomUUID().replaceAll('-', '')}`;
  await client.query(`CREATE SCHEMA ${schema}`); await client.query(`SET search_path TO ${schema}`);
  await client.query(`
    CREATE TABLE activities(id uuid PRIMARY KEY, name text, notion_id varchar);
    CREATE TABLE warehouse_items(id uuid PRIMARY KEY, key text, name text, kind text, shelf text, impl_ref text, owner text, description text,
      failure_semantics text, shelf_life_days int, active boolean DEFAULT true, source_table text, source_ref text,
      notion_id varchar, notion_synced_at timestamptz, notion_digest text);
    CREATE TABLE activity_uses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), activity_id uuid, item_id uuid, role text, assertion_ref text,
      cell_status text, created_at timestamptz DEFAULT now(), notion_id varchar, notion_synced_at timestamptz, notion_digest text);
    CREATE TABLE projection_links(target text, entity_type text, entity_id uuid, external_id text);`);
});
afterEach(async () => { if (client) { await client.query(`DROP SCHEMA ${schema} CASCADE`); await client.end(); } });

describe('仓库物件库 / 用料库推送（真 PG）', () => {
  it('物件带「被用于」推送并回写页 id；用料等两边页面都在才推，Activity 页 id 取目录投影链接', async () => {
    const [a1, a2, i1, i2] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    await client.query("INSERT INTO activities VALUES($1,'回复',NULL),($2,'外呼','legacy-page')", [a1, a2]);
    await client.query("INSERT INTO projection_links VALUES('notion-directory','activities',$1,'dir-page-a1')", [a1]);
    await client.query("INSERT INTO warehouse_items(id,key,name,kind,shelf) VALUES($1,'lock','设备锁','service','service'),($2,'crm','CRM 表','data','data')", [i1, i2]);
    await client.query("INSERT INTO activity_uses(activity_id,item_id,role,cell_status) VALUES($1,$2,'uses','green'),($3,$2,'depends','gray')", [a1, i1, a2]);

    let n = 0;
    const posts = [];
    const notionReq = vi.fn(async (_t, path, method, body) => { posts.push({ path, method, body }); return { id: `page-${++n}` }; });

    const items = await pushWarehouseItems(client, 'tok', 'wh-db', { notionReq });
    expect(items).toMatchObject({ created: 2, failed: 0 });
    const lock = posts.find(p => p.body.properties.Name.title[0].text.content === '设备锁');
    expect(lock.body.properties['被用于'].rich_text[0].text.content).toBe('回复；外呼');
    expect(lock.body.properties['货架']).toEqual({ select: { name: '服务' } });
    expect((await client.query('SELECT count(*)::int AS n FROM warehouse_items WHERE notion_id IS NOT NULL')).rows[0].n).toBe(2);

    posts.length = 0;
    const uses = await pushActivityUses(client, 'tok', 'use-db', { notionReq });
    expect(uses).toMatchObject({ created: 2, failed: 0 });
    const byName = Object.fromEntries(posts.map(p => [p.body.properties['名称'].title[0].text.content, p.body.properties]));
    expect(byName['回复 ← 设备锁'].Activity.relation[0].id).toBe('dir-page-a1');
    expect(byName['外呼 ← 设备锁'].Activity.relation[0].id).toBe('legacy-page');
    const lockPage = (await client.query("SELECT notion_id FROM warehouse_items WHERE id=$1", [i1])).rows[0].notion_id;
    expect(byName['回复 ← 设备锁']['物件'].relation[0].id).toBe(lockPage);
  });

  it('物件还没推（无页 id）或 Activity 没有页：用料不推，不发请求', async () => {
    const [a1, i1] = [randomUUID(), randomUUID()];
    await client.query("INSERT INTO activities VALUES($1,'回复',NULL)", [a1]);
    await client.query("INSERT INTO warehouse_items(id,key,name,kind,shelf) VALUES($1,'lock','设备锁','service','service')", [i1]);
    await client.query("INSERT INTO activity_uses(activity_id,item_id,role) VALUES($1,$2,'uses')", [a1, i1]);
    const notionReq = vi.fn(async () => ({ id: 'x' }));
    expect(await pushActivityUses(client, 'tok', 'use-db', { notionReq })).toMatchObject({ created: 0, patched: 0 });
    expect(notionReq).not.toHaveBeenCalled();
  });

  it('指纹没变：第二轮不再打 Notion', async () => {
    const i1 = randomUUID();
    await client.query("INSERT INTO warehouse_items(id,key,name,kind,shelf) VALUES($1,'lock','设备锁','service','service')", [i1]);
    const notionReq = vi.fn(async () => ({ id: 'p1' }));
    await pushWarehouseItems(client, 'tok', 'wh-db', { notionReq });
    notionReq.mockClear();
    expect(await pushWarehouseItems(client, 'tok', 'wh-db', { notionReq })).toMatchObject({ skipped: 1, created: 0, patched: 0 });
    expect(notionReq).not.toHaveBeenCalled();
  });
});
