/**
 * TDD：统一推送引擎（三面模型 PR②a，决策 297ffee5 / 立项 f5ba8ee3）
 * 病根：13 个 push 里 9 个 insert-only（notion_synced_at IS NULL）——Brain 改了 Notion 永不更新；
 * 各自复制粘贴 create/UPDATE/错误处理，改一处漏八处。
 * 引擎契约：指纹按「将要发送的 properties」算；有 id 且指纹同→跳过；变了→PATCH；无 id→POST；
 * 404/错库→清 id+指纹下轮重建；stale relation→按旧行为标 synced 不死循环。库 id 优先从注册表取。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  propsDigest, pushRegisteredRows, resolveDbId,
} from '../notion-projection-engine.js';

const mkPool = (impl) => ({ query: vi.fn(impl || (async () => ({ rows: [] }))) });
const okNotion = () => vi.fn(async (token, path, method) => ({ id: method === 'POST' ? 'new-page' : 'patched' }));

describe('propsDigest', () => {
  it('同内容不同键序 → 同指纹；内容变 → 指纹变', () => {
    const a = propsDigest({ Name: { title: [{ text: { content: 'x' } }] }, Status: { select: { name: 'a' } } });
    const b = propsDigest({ Status: { select: { name: 'a' } }, Name: { title: [{ text: { content: 'x' } }] } });
    const c = propsDigest({ Name: { title: [{ text: { content: 'y' } }] }, Status: { select: { name: 'a' } } });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('pushRegisteredRows', () => {
  const buildProps = (r) => ({ Name: { title: [{ text: { content: r.name } }] } });

  it('有 notion_id 且指纹相同 → 不调 Notion（防限流），只抬 synced 防饿死', async () => {
    const digest = propsDigest(buildProps({ name: 'same' }));
    const pool = mkPool(); const notion = okNotion();
    const res = await pushRegisteredRows(pool, 't', { table: 'issues', dbId: 'db1',
      rows: [{ id: 1, name: 'same', notion_id: 'p1', notion_digest: digest }], buildProps, notionReq: notion });
    expect(notion).not.toHaveBeenCalled();
    expect(res.skipped).toBe(1);
    expect(pool.query.mock.calls.some(c => /notion_digest/.test(c[0]))).toBe(false);
  });

  it('有 notion_id 但指纹变了 → PATCH 该页并回写新指纹（insert-only 缺陷的核心修复）', async () => {
    const pool = mkPool(); const notion = okNotion();
    await pushRegisteredRows(pool, 't', { table: 'issues', dbId: 'db1',
      rows: [{ id: 1, name: 'changed', notion_id: 'p1', notion_digest: 'old' }], buildProps, notionReq: notion });
    expect(notion).toHaveBeenCalledWith('t', '/pages/p1', 'PATCH', expect.objectContaining({ properties: expect.any(Object) }));
    const upd = pool.query.mock.calls.find(c => /UPDATE issues/.test(c[0]));
    expect(upd[0]).toMatch(/notion_digest/);
    expect(upd[1]).toContain(propsDigest(buildProps({ name: 'changed' })));
  });

  it('无 notion_id → POST 到注册表给的库，带 children，回写 id+指纹+synced', async () => {
    const pool = mkPool(); const notion = okNotion();
    await pushRegisteredRows(pool, 't', { table: 'issues', dbId: 'db1',
      rows: [{ id: 1, name: 'new', notion_id: null }], buildProps,
      buildChildren: () => [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [] } }], notionReq: notion });
    expect(notion).toHaveBeenCalledWith('t', '/pages', 'POST', expect.objectContaining({
      parent: { database_id: 'db1' }, children: expect.any(Array) }));
    const upd = pool.query.mock.calls.find(c => /UPDATE issues/.test(c[0]));
    expect(upd[0]).toMatch(/notion_id/); expect(upd[0]).toMatch(/notion_digest/); expect(upd[0]).toMatch(/notion_synced_at/);
    expect(upd[1]).toContain('new-page');
  });

  it('404（页被人删）或错库 400 → 清 notion_id 与指纹，下轮重建', async () => {
    const pool = mkPool();
    const notion = vi.fn(async () => { throw new Error('Notion PATCH /pages/p1 → 404: Could not find page'); });
    await pushRegisteredRows(pool, 't', { table: 'issues', dbId: 'db1',
      rows: [{ id: 1, name: 'x', notion_id: 'p1', notion_digest: 'old' }], buildProps, notionReq: notion, logSyncError: async () => {} });
    const clr = pool.query.mock.calls.find(c => /notion_id\s*=\s*NULL/.test(c[0]));
    expect(clr).toBeTruthy();
    expect(clr[0]).toMatch(/notion_digest\s*=\s*NULL/);
  });

  it('stale relation（关联页失效）→ 标 synced 不死循环（沿用旧行为）', async () => {
    const pool = mkPool();
    const notion = vi.fn(async () => { throw new Error('Notion POST /pages → 400: Could not find database with ID: rel-x'); });
    await pushRegisteredRows(pool, 't', { table: 'journeys', dbId: 'db1',
      rows: [{ id: 1, name: 'x', notion_id: null }], buildProps, notionReq: notion, logSyncError: async () => {},
      isStaleRelationError: () => true });
    const upd = pool.query.mock.calls.find(c => /UPDATE journeys SET notion_synced_at\s*=\s*NOW\(\)/.test(c[0]));
    expect(upd).toBeTruthy();
  });

  it('table 传函数：同一批行按行回写各自的真身表（价值流 / 能力）', async () => {
    const pool = mkPool();
    const notion = vi.fn(async () => ({ id: 'page-x' }));
    await pushRegisteredRows(pool, 't', { table: r => (r.parent_journey_id ? 'capabilities' : 'value_streams'), dbId: 'db1',
      rows: [{ id: 'vs1', name: 'a', notion_id: null, parent_journey_id: null },
        { id: 'cap1', name: 'b', notion_id: null, parent_journey_id: 'vs1' }],
      buildProps, notionReq: notion, logSyncError: async () => {} });
    const sqls = pool.query.mock.calls.map(c => c[0]);
    expect(sqls.some(s => /UPDATE value_streams SET notion_id/.test(s))).toBe(true);
    expect(sqls.some(s => /UPDATE capabilities SET notion_id/.test(s))).toBe(true);
    expect(sqls.some(s => /UPDATE undefined|UPDATE \[object/.test(s))).toBe(false);
  });
});

describe('resolveDbId — 库 id 优先从注册表取', () => {
  it('注册表有 active push 行 → 用它；没有 → 回退给的常量（安全灰度）', async () => {
    const pool = mkPool(async (sql, params) => /notion_projection_map/.test(sql) && params[0] === 'issues'
      ? { rows: [{ notion_db_id: 'reg-db' }] } : { rows: [] });
    expect(await resolveDbId(pool, 'issues', 'const-db')).toBe('reg-db');
    expect(await resolveDbId(pool, 'journeys', 'const-db')).toBe('const-db');
  });
});

it('新页正文失败保留pageId且不标完成，下次沿同页重试',async()=>{
 const state={id:1,name:'run'},pool=mkPool(async(sql,args)=>{if(sql.includes('SET notion_id=$2'))state.notion_id=args[1];return {rows:[]};});
 const notion=okNotion(),syncBody=vi.fn().mockRejectedValueOnce(Error('readback mismatch')).mockResolvedValueOnce(true);
 const options={table:'task_runs',dbId:'db',rows:[state],buildProps:()=>({}),notionReq:notion,syncBody};
 expect((await pushRegisteredRows(pool,'t',options)).failed).toBe(1);
 expect(state.notion_id).toBe('new-page');expect(pool.query.mock.calls.some(c=>c[0].includes('= NOW()'))).toBe(false);
 expect((await pushRegisteredRows(pool,'t',options)).patched).toBe(1);
 expect(notion.mock.calls.filter(c=>c[2]==='POST')).toHaveLength(1);
 expect(syncBody.mock.calls.every(c=>c[1]==='new-page')).toBe(true);
});
it('属性指纹相同仍验正文，失败不被stale relation旧逻辑标成功',async()=>{
 const pool=mkPool(),syncBody=vi.fn(async()=>{throw Error('body failure');});
 const result=await pushRegisteredRows(pool,'t',{table:'task_runs',dbId:'db',rows:[{id:1,notion_id:'page',notion_digest:propsDigest({})}],buildProps:()=>({}),notionReq:okNotion(),syncBody,isStaleRelationError:()=>true});
 expect(result.failed).toBe(1);expect(result.skipped).toBe(0);expect(syncBody).toHaveBeenCalled();
 expect(pool.query.mock.calls.some(c=>c[0].includes('= NOW()'))).toBe(false);
});
it('正文整行完成后预算耗尽，其余行不写同步成功可下轮继续',async()=>{
 let clock=100;const now=vi.spyOn(Date,'now').mockImplementation(()=>clock),pool=mkPool(),notion=okNotion();
 try{
  const result=await pushRegisteredRows(pool,'t',{table:'task_runs',dbId:'db',rows:[{id:1,notion_id:'page1'},{id:2,notion_id:'page2'}],buildProps:()=>({}),notionReq:notion,budgetMs:50,syncBody:async()=>{clock+=51;}});
  expect(result.patched).toBe(1);expect(notion).toHaveBeenCalledTimes(1);
  expect(pool.query.mock.calls.every(c=>c[1][0]===1)).toBe(true);
 }finally{now.mockRestore();}
});

it.each([false,true])('Run正文子块404保留页身份，待同步重试；新建=%s',async created=>{
 const row={id:1,...(!created?{notion_id:'existing-run-page'}:{})},pool=mkPool(),notion=okNotion();
 const result=await pushRegisteredRows(pool,'t',{table:'task_runs',dbId:'db',rows:[row],buildProps:()=>({}),notionReq:notion,
  syncBody:async()=>{throw Error('404 object_not_found: child block missing');}});
 expect(result.failed).toBe(1);expect(result.cleared).toBe(0);
 expect(pool.query.mock.calls.some(c=>/SET notion_id = NULL/.test(c[0]))).toBe(false);
 expect(pool.query.mock.calls.some(c=>/notion_synced_at=NULL/.test(c[0]))).toBe(true);
 expect(pool.query.mock.calls.some(c=>c[0].includes('= NOW()'))).toBe(false);
 if(created)expect(pool.query.mock.calls.some(c=>c[0].includes('SET notion_id=$2')&&c[1][1]==='new-page')).toBe(true);
});
