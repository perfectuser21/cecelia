import { describe, it, expect, vi } from 'vitest';
const api = await import('../directory-config.js').catch(() => ({}));
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const input = () => ({ dbs: Object.fromEntries(['areas','value_streams','capabilities','workflows','activities','steps'].map((k,i) => [k,id(i+1)])),
  value_stream_bindings: [{ journey_id: id(10), scope: 'cecelia', node_key: 'factory' }], area_bindings: [] });
describe('目录配置与单库bootstrap', () => {
  it.each([
    {results:[]},
    {results:null,has_more:false,next_cursor:null},
    {results:[],has_more:true,next_cursor:null},
  ])('父页分页不完整不得误判缺库，零POST %j',async response=>{
    const notionReq=vi.fn().mockResolvedValue(response);
    await expect(api.findCapabilityDatabase({token:'test',parentPageId:id(30),notionReq})).rejects.toThrow(/分页|snapshot/);
    expect(notionReq.mock.calls.every(c=>c[2]==='GET')).toBe(true);
  });
  it('父页A→B→A cursor循环有界拒绝，零POST',async()=>{
    let n=0;
    const notionReq=vi.fn(async()=>{if(++n>4)throw new Error('测试保险：分页无界');return{results:[],has_more:true,next_cursor:n%2?'A':'B'};});
    await expect(api.findCapabilityDatabase({token:'test',parentPageId:id(30),notionReq})).rejects.toThrow(/cursor/);
    expect(notionReq.mock.calls).toHaveLength(3);
  });
  it('合法多页可找回唯一来源库，无新库创建',async()=>{
    const notionReq=vi.fn().mockResolvedValueOnce({results:[],has_more:true,next_cursor:'A'})
      .mockResolvedValueOnce({results:[{id:id(20),type:'child_database',child_database:{title:'Capabilities'}}],has_more:false,next_cursor:null})
      .mockResolvedValueOnce({id:id(20),parent:{page_id:id(30)},description:[{plain_text:'Brain directory capabilities (journeys.kind=capability)'}]});
    expect(await api.findCapabilityDatabase({token:'test',parentPageId:id(30),notionReq})).toBe(id(20));
    expect(notionReq.mock.calls.every(c=>c[2]==='GET')).toBe(true);
  });
  it('父页扫描有最大页数，独特cursor也不能无限扫描',async()=>{
    let n=0;const notionReq=vi.fn(async()=>{if(++n>101)throw Error('测试保险');return{results:[],has_more:true,next_cursor:String(n)};});
    await expect(api.findCapabilityDatabase({token:'test',parentPageId:id(30),notionReq})).rejects.toThrow(/上限/);
    expect(n).toBeLessThanOrEqual(100);
  });
  it('父页条目过量或同页重复库身份不得认领',async()=>{
    const notionReq=vi.fn().mockResolvedValue({results:Array.from({length:10001},()=>({type:'paragraph'})),has_more:false,next_cursor:null});
    await expect(api.findCapabilityDatabase({token:'test',parentPageId:id(30),notionReq})).rejects.toThrow(/上限/);
  });
  it('导出配置白名单入口', () => expect(api.validateDirectoryConfig).toBeTypeOf('function'));
  it('合法配置仅保受限库身份和显式bindings', () => expect(api.validateDirectoryConfig(input())).toEqual(input()));
  it.each([
    data => ({ ...data, token: 'forbidden' }),
    data => ({ ...data, dbs: { ...data.dbs, other: id(11) } }),
    data => ({ ...data, value_stream_bindings: [{ journey_id: id(10), scope: 'cecelia', node_key: 'factory', sql: 'x' }] }),
    data => ({ ...data, area_bindings: [{ brain_id: id(10), notion_id: id(11) }] }),
    data => ({ ...data, dbs: { ...data.dbs, areas: 'bad' } }),
  ])('非法配置拒绝而不静默吞字段', change => expect(() => api.validateDirectoryConfig(change(input()))).toThrow());
  it('父页存在两个同名库时拒绝且零创建/改schema', async () => {
    const notionReq = vi.fn(async () => ({ results: [
      { id: id(20), type: 'child_database', child_database: { title: 'Capabilities' } },
      { id: id(21), type: 'child_database', child_database: { title: 'Capabilities' } },
    ], has_more: false }));
    await expect(api.findCapabilityDatabase({ token: 'test', parentPageId: id(30), notionReq })).rejects.toThrow(/重复/);
    expect(notionReq.mock.calls.every(c => c[2] === 'GET')).toBe(true);
  });
  it('同名但没有机器来源标记的既有库不能认领', async () => {
    const notionReq = vi.fn().mockResolvedValueOnce({ results: [{ id: id(20), type: 'child_database', child_database: { title: 'Capabilities' } }], has_more: false })
      .mockResolvedValueOnce({ id: id(20), parent: { page_id: id(30) }, description: [] });
    await expect(api.findCapabilityDatabase({ token: 'test', parentPageId: id(30), notionReq })).rejects.toThrow(/来源/);
  });
});
