import { describe, it, expect, vi } from 'vitest';
import { runtimeFixture } from './directory-runtime.fixture.js';
const api = await import('../directory-projector.js').catch(() => ({}));
const id = '00000000-0000-4000-8000-000000000001';
const dbId = '00000000-0000-4000-8000-000000000002';
const pageId = '00000000-0000-4000-8000-000000000003';
const rich = value => ({ rich_text: [{ text: { content: value } }] });
function fixture({ linked = true, identity = id, parent = dbId, readbackWrong = false, duplicate = false } = {}) {
  let properties = { 'Brain ID': rich(identity) };
  const query = vi.fn(async sql => ({ rows: sql.includes('FROM projection_links') && sql.includes('entity_type=$1') ? (linked ? [{ entity_type: 'workflows', entity_id: id, external_id: pageId }] : []) : [] }));
  const notionReq = vi.fn(async (_token, path, method, body) => {
    if (path.endsWith('/query')) return { results: duplicate ? [{ id: pageId }, { id: 'duplicate' }] : [], has_more: false };
    if (method === 'PATCH' || path === '/pages') properties = { ...properties, ...body.properties };
    return { id: pageId, parent: { database_id: parent }, properties: readbackWrong && method === 'GET' ? { ...properties, Activities: { relation: [] } } : structuredClone(properties) };
  });
  const row = { layer: 'workflows', table: 'workflows', id, pageId: null, allowCreate: true, properties: { 'Brain ID': rich(id) }, relations: {}, gaps: [] };
  return { pool: { query }, query, notionReq, row };
}
describe('严格目录页投影', () => {
  it('真实运行六层都能落收据；不再写同步时间/登记缺口（只留 Brain ID + 同步状态）', async () => {
    const f = runtimeFixture();
    const sent = [];
    const notionReq = async (...args) => { if (args[3]?.properties) sent.push(...Object.keys(args[3].properties)); return f.notionReq(...args); };
    const result = await api.runDirectoryProjection(f.pool, { token: 'test', notionReq, force: true });
    expect(result.failed).toBe(0);
    expect(f.links).toHaveLength(6);
    expect(sent).not.toContain('同步时间');
    expect(sent).not.toContain('登记缺口');
    expect(sent).toContain('同步状态');
  });
  function pagedFixture(count=26, corrupt) {
    const f=fixture(), propertyId='rel%3A%2Fid';
    const all=Array.from({length:26},(_,i)=>({id:`20000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`}));
    let current=all.slice(0,count);
    f.notionReq=vi.fn(async(_token,path,method,body)=>{
      if(path.includes('/properties/')){
        const second=path.includes('start_cursor=next');
        const items=second?current.slice(25):current.slice(0,25);
        const response={object:'list',type:'property_item',results:items.map(relation=>({object:'property_item',id:propertyId,type:'relation',relation})),
          has_more:!second&&current.length>25,next_cursor:!second&&current.length>25?'next':null,
          property_item:{id:propertyId,type:'relation',relation:{},next_url:null}};
        return corrupt ? corrupt(response,second) : response;
      }
      if(method==='PATCH')current=structuredClone(body.properties.Activities.relation);
      return{id:pageId,parent:{database_id:dbId},properties:{'Brain ID':rich(id),
        Activities:{id:propertyId,type:'relation',relation:current.slice(0,25),has_more:current.length>25}}};
    });
    return {...f,all,propertyId};
  }
  const pushPaged = f => api.projectDirectoryPage(f.pool,{token:'test',dbId,row:f.row,
    properties:{...f.row.properties,Activities:{relation:f.all}},notionReq:f.notionReq});
  it('26条已相同关系完整分页后零PATCH仍可写receipt，编码property ID不重复编码',async()=>{
    const f=pagedFixture();await pushPaged(f);
    const paths=f.notionReq.mock.calls.map(c=>c[1]);
    expect(paths).toContain(`/pages/${pageId}/properties/${f.propertyId}?page_size=100`);
    expect(paths.some(p=>p.endsWith('start_cursor=next'))).toBe(true);
    expect(f.notionReq.mock.calls.some(c=>c[2]==='PATCH')).toBe(false);
    expect(f.query.mock.calls.some(([sql])=>sql.includes('INSERT INTO projection_links'))).toBe(true);
  });
  it('0→26写入后完整分页读回才成功',async()=>{
    const f=pagedFixture(0);await pushPaged(f);
    expect(f.notionReq.mock.calls.filter(c=>c[1].includes('/properties/'))).toHaveLength(2);
    expect(f.query.mock.calls.some(([sql])=>sql.includes('INSERT INTO projection_links'))).toBe(true);
  });
  it('26→0先读完整旧关系再清空，不因旧has_more卡住',async()=>{
    const f=pagedFixture();f.all=[];await pushPaged(f);
    expect(f.notionReq.mock.calls.find(c=>c[2]==='PATCH')[3].properties.Activities.relation).toEqual([]);
    expect(f.query.mock.calls.some(([sql])=>sql.includes('INSERT INTO projection_links'))).toBe(true);
  });
  it.each([
    response=>({...response,has_more:undefined}),
    response=>({...response,next_cursor:null}),
    response=>({...response,property_item:{id:'other',type:'relation'}}),
    response=>({...response,results:[{object:'property_item',id:'other',type:'relation',relation:{id:pageId}}]}),
    response=>({...response,results:[{object:'property_item',id:'rel%3A%2Fid',type:'relation',relation:{id:'invalid'}}]}),
  ])('不完整或错身份的关系分页零成功receipt',async corrupt=>{
    const f=pagedFixture(0,corrupt);await expect(pushPaged(f)).rejects.toThrow();
    expect(f.query.mock.calls.some(([sql])=>sql.includes('INSERT INTO projection_links'))).toBe(false);
  });
  it('关系分页cursor循环拒绝，不能不断读取或记成功',async()=>{
    let n=0;
    const f=pagedFixture(0,response=>({...response,results:[],has_more:true,next_cursor:++n%2?'A':'B'}));
    await expect(pushPaged(f)).rejects.toThrow(/分页|cursor/);
    expect(f.notionReq.mock.calls.filter(c=>c[1].includes('/properties/')).length).toBeLessThanOrEqual(3);
    expect(f.query.mock.calls.some(([sql])=>sql.includes('INSERT INTO projection_links'))).toBe(false);
  });
  it('导出独立严格页入口', () => expect(api.projectDirectoryPage).toBeTypeOf('function'));
  it('旧合法链接可认领，GET读回之后才写成功receipt', async () => {
    const f = fixture({ identity: '' });
    await api.projectDirectoryPage(f.pool, { token: 'test', dbId, row: f.row, properties: f.row.properties, notionReq: f.notionReq });
    expect(f.notionReq.mock.calls.map(c => c[2])).toEqual(['GET', 'PATCH', 'GET']);
    expect(f.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO projection_links'))).toBe(true);
  });
  it.each([{ parent: 'wrong' }, { identity: 'other' }])('旧页错库或身份冲突保留映射且零PATCH %j', async options => {
    const f = fixture(options);
    await expect(api.projectDirectoryPage(f.pool, { token: 'test', dbId, row: f.row, properties: f.row.properties, notionReq: f.notionReq })).rejects.toThrow();
    expect(f.notionReq.mock.calls.some(c => c[2] === 'PATCH')).toBe(false);
    expect(f.query.mock.calls.some(([sql]) => /UPDATE|INSERT|DELETE/.test(sql))).toBe(false);
  });
  it('关系读回不一致不能记成功', async () => {
    const f = fixture({ readbackWrong: true });
    await expect(api.projectDirectoryPage(f.pool, { token: 'test', dbId, row: f.row, properties: { ...f.row.properties, Activities: { relation: [{ id: pageId }] } }, notionReq: f.notionReq })).rejects.toThrow(/读回/);
    expect(f.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO projection_links'))).toBe(false);
  });
  it('重复Brain ID页拒绝，不按标题抢占或创建第三页', async () => {
    const f = fixture({ linked: false, duplicate: true });
    await expect(api.projectDirectoryPage(f.pool, { token: 'test', dbId, row: f.row, properties: f.row.properties, notionReq: f.notionReq })).rejects.toThrow(/重复/);
    expect(f.notionReq.mock.calls.some(c => c[1] === '/pages')).toBe(false);
  });
});
