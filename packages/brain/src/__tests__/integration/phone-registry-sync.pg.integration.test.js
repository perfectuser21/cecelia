import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';
import { runPhoneRegistrySync, PHONE_REGISTRY_SYNC_KEY } from '../../phone-registry-sync.js';
let client;
const page = (name = 'Notion昵称', account = '抖音：主号(id123)【当前】') => ({ id: 'own-page', properties: {
  '类型': { select: { name: '安卓手机' } }, '序列号': { rich_text: [{ plain_text: 'SER1' }] },
  '名称': { title: [{ plain_text: name }] }, '归属': { select: { name: '新归属' } }, '账号': { rich_text: [{ plain_text: account }] },
  '在线状态': { select: { name: '离线' } }, '绑定Worker': { rich_text: [{ plain_text: 'other-host' }] },
} });
beforeEach(async () => {
  client = new pg.Client(DB_DEFAULTS); await client.connect();
  // 连接独占的临时表，提交也只影响本连接；不跑migration、不改共享数据。
  await client.query(`CREATE TEMP TABLE phone_registry (LIKE public.phone_registry INCLUDING ALL);
    CREATE TEMP TABLE working_memory (key text PRIMARY KEY, value_json jsonb, updated_at timestamptz);
    CREATE TEMP TABLE tasks (id uuid, status text, task_type text, payload jsonb);
    CREATE TEMP TABLE task_events (task_id uuid, event_type text, payload jsonb, created_at timestamptz);`);
  await client.query(`INSERT INTO phone_registry (serial,nickname,aliases,host,profile,model,owner,douyin_accounts)
    VALUES ('SER1','旧昵称',ARRAY['保留别名'],'xian-m1','real-profile','real-model','旧归属','[]')`);
});
afterEach(async () => { await client?.end(); });
async function run(pages) {
  return runPhoneRegistrySync({ connect: async () => ({ query: client.query.bind(client), release: vi.fn() }) }, {
    token: 'fixture', notionReq: async () => ({ results: pages, has_more: false }), now: 1900000000000, force: true,
    inContainer: false, program: 'fixture', exec: async () => JSON.stringify({ ok: true, receipts: [] }), bark: vi.fn(),
  });
}
describe('手机入口真实PG写入证据', () => {
  it('首轮入账真实字段、事件before、基线，技术映射保持原值', async () => {
    expect((await run([page()])).updated).toBe(1);
    const row = (await client.query('SELECT * FROM pg_temp.phone_registry')).rows[0];
    expect(row).toMatchObject({ nickname: 'Notion昵称', owner: '新归属', host: 'xian-m1', profile: 'real-profile', model: 'real-model' });
    expect(row.aliases).toEqual(['保留别名']); expect(row.douyin_accounts[0].id).toBe('id123');
    const event = (await client.query("SELECT payload FROM pg_temp.task_events WHERE event_type='phone_registry_human_edit'")).rows[0].payload;
    expect(event).toMatchObject({ actor: 'phone-registry-sync', before: { nickname: '旧昵称', owner: '旧归属' }, evidence: { notion_page_id: 'own-page' } });
    expect((await client.query('SELECT value_json FROM pg_temp.working_memory WHERE key=$1', [PHONE_REGISTRY_SYNC_KEY])).rows[0].value_json.baselines.SER1).toBeTruthy();
  });
  it('DB后改字段不会被未改Notion内容覆盖，内容单项改动只覆盖该项', async () => {
    await run([page()]); await client.query("UPDATE pg_temp.phone_registry SET owner='DB新归属', nickname='DB新昵称'");
    expect((await run([page()])).updated).toBe(0);
    expect((await run([page('人改昵称')])).updated).toBe(1);
    const row = (await client.query('SELECT nickname,owner FROM pg_temp.phone_registry')).rows[0];
    expect(row).toEqual({ nickname: '人改昵称', owner: 'DB新归属' });
  });
  it('明确清空写NULL/空数组，坏行不覆盖有效台账', async () => {
    await run([page()]); expect((await run([page('Notion昵称', '')])).updated).toBe(1);
    expect((await client.query('SELECT douyin_accounts,wechat FROM pg_temp.phone_registry')).rows[0]).toEqual({ douyin_accounts: [], wechat: null });
    const out = await run([page('坏昵称', '无法解析')]); expect(out.updated).toBe(0); expect(out.invalid).toHaveLength(1);
    expect((await client.query('SELECT nickname FROM pg_temp.phone_registry')).rows[0].nickname).toBe('Notion昵称');
  });
  it('事件落账失败会回滚台账字段与基线，不能改了真身却没证据', async () => {
    await client.query('ALTER TABLE pg_temp.task_events ADD CONSTRAINT injected_write_failure CHECK (false)');
    await expect(run([page()])).rejects.toThrow();
    expect((await client.query('SELECT nickname FROM pg_temp.phone_registry')).rows[0].nickname).toBe('旧昵称');
    expect((await client.query('SELECT * FROM pg_temp.working_memory')).rows).toEqual([]);
  });
});
