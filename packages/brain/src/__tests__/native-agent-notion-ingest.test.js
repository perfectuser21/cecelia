import {beforeEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({query:vi.fn(),notion:vi.fn(),create:vi.fn()}));
vi.mock('../db.js',()=>({default:{query:state.query}}));
vi.mock('../recurring-notion-sync.js',()=>({notionReq:state.notion,getToken:()=> 'isolated-notion-fixture'}));
vi.mock('../work-routing-store.js',()=>({createRoutedTask:state.create}));
import {ingestDelegatedPage,pullNotionTasksForTest,pullMarkedNotionTasks} from '../notion-push-sync.js';
import {runGtdSyncOnce} from '../notion-gtd-sync.js';
const EN='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',ZH='11111111-2222-3333-4444-555555555555';
const paragraph=text=>({type:'paragraph',paragraph:{rich_text:[{plain_text:text}]}});
const page={id:EN,properties:{Name:{title:[{plain_text:'[P1] 整理完整任务说明'}]},Description:{rich_text:[{plain_text:'[zh:11111111222233334444555555555555]'}]},Status:{status:{name:'Delegated'}}}};
const zh={id:ZH,properties:{名称:{title:[{plain_text:'整理完整任务说明'}]},状态:{status:{name:'委派'}},优先级:{select:{name:'高'}},备注:{rich_text:[]},'OpenClaw任务号':{rich_text:[]},'预期开始时间':{date:{start:'2026-12-01T09:00:00+08:00'}},'预期结束时间':{date:{start:'2026-12-01T10:00:00+08:00'}}}};
beforeEach(()=>{state.query.mockReset().mockResolvedValue({rows:[]});state.notion.mockReset();state.create.mockReset().mockResolvedValue({task:{id:'15f42776-8d1b-430d-b27a-38a480b93151'}});});
const env={QIUMI_DISPATCH_ENABLED:'true',NOTION_TENANT_MAP:JSON.stringify({'c69c40c2-ba63-8271-badf-01c5410d8929':'isolated-tenant'})};
describe('Notion完整交办经Brain原生Agent接入',()=>{
 it('保留超过2000字符完整分页正文、任务类型和双页租户排期，不再绑OpenClaw',async()=>{
  const first='甲'.repeat(2400),tail='完整的末页验收要求';
  state.notion.mockImplementation(async(_token,path,method)=>{
   if(method==='PATCH')return {};
   if(path===`/pages/${ZH}`)return zh;
   if(path.startsWith(`/blocks/${EN}/`))return {results:[],has_more:false};
   if(path.includes('start_cursor=second'))return {results:[paragraph(tail)],has_more:false};
   if(path.startsWith(`/blocks/${ZH}/`))return {results:[paragraph(first)],has_more:true,next_cursor:'second'};
   throw Error('unexpected isolated Notion request '+path);
  });
  expect(await ingestDelegatedPage({query:state.query},'fixture',page,{env})).toMatchObject({kind:'qiumi_task'});
  const request=state.create.mock.calls[0][1];
  expect(request).toMatchObject({requested_task_type:'qiumi_task',mutation_intent:'none',task:{executor_kind:'external-worker',status:'queued'},metadata:{source:'notion_gtd',tenant_id:'isolated-tenant',notion_page_id:EN,notion_zh_page_id:ZH,headed_manual:false,next_run_at:'2026-12-01T09:00:00+08:00',native_agent_content:{protocol:'notion-complete-body/v1',complete:true,empty_body:false,page_ids:[EN,ZH]}}});
  expect(request.description).toBe(first+'\n'+tail);
  expect(request.metadata.qiumi_source.body).toBe(first+'\n'+tail);
  expect(state.query.mock.calls).toEqual(expect.arrayContaining([[expect.stringContaining('due_at=$2'),['15f42776-8d1b-430d-b27a-38a480b93151','2026-12-01T10:00:00+08:00']]]));
 });
 it.each(['en_failed','request_failed','nested_failed','cursor_missing','body_truncated'])('正文%s时不按标题接单，不写Brain接管回执',async mode=>{
  state.notion.mockImplementation(async(_token,path,method)=>{
   if(method==='PATCH')return {};
   if(path===`/pages/${ZH}`)return zh;
   if(path.startsWith(`/blocks/${EN}/`)){if(mode==='en_failed')throw Error('isolated English body unavailable');return {results:[],has_more:false};}
   if(path.startsWith('/blocks/nested/'))throw Error('isolated nested unavailable');
   if(path.startsWith(`/blocks/${ZH}/`)){
    if(mode==='request_failed')throw Error('isolated body unavailable');
    if(mode==='nested_failed')return {results:[{id:'nested',type:'toggle',has_children:true,toggle:{rich_text:[{plain_text:'前半段'}]}}],has_more:false};
    if(mode==='cursor_missing')return {results:[paragraph('前半段')],has_more:true,next_cursor:null};
    return {results:[paragraph('字'.repeat(20001))],has_more:false};
   }
   throw Error('unexpected isolated Notion request '+path);
  });
  await expect(ingestDelegatedPage({query:state.query},'fixture',page,{env})).rejects.toThrow();
  expect(state.create).not.toHaveBeenCalled();
  expect(state.notion.mock.calls.filter(([, ,method])=>method==='PATCH')).toEqual([]);
 });
 it('完整读取成功且正文为空的交办保留标题，并如实记录空正文',async()=>{
  state.notion.mockImplementation(async(_token,path,method)=>{
   if(method==='PATCH')return {};
   if(path===`/pages/${ZH}`)return zh;
   if(path.startsWith('/blocks/'))return {results:[],has_more:false};
   throw Error('unexpected isolated Notion request '+path);
  });
  await ingestDelegatedPage({query:state.query},'fixture',page,{env});
  const request=state.create.mock.calls[0][1];
  expect(request.description).toContain('整理完整任务说明');
  expect(request.metadata.qiumi_source.body).toBe('');
  expect(request.metadata.native_agent_content).toEqual({protocol:'notion-complete-body/v1',complete:true,empty_body:true,page_ids:[EN,ZH]});
 });
 it('同步协调器的正文读取失败明确报错，不把空正文交给镜像入账',async()=>{
  state.notion.mockRejectedValue(new Error('isolated full body unavailable'));
  const result=await runGtdSyncOnce({query:state.query},{token:'fixture',
   syncZhToEn:async(_pool,token,options)=>{await options.fetchPageContent(token,ZH);return {created:1};},
   syncEnToZh:async()=>({created:0}),pullMarked:async()=>({ingested:0}),applyOwnerStops:async()=>({}),pushQiumiStatus:async()=>({}),
  });
  expect(result.zhToEn).toMatchObject({error:'isolated full body unavailable'});
 });
});

describe('现役Notion拉取有界分页与历史过滤',()=>{
 it.each([pullNotionTasksForTest,pullMarkedNotionTasks])('过滤已接手历史且读完后页新单 %s',async pull=>{
  const other={...structuredClone(page),id:'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee'};
  for(const p of [other])p.properties.Description.rich_text=[{plain_text:'[en-native]'}];
  const first={...structuredClone(other),id:EN};let queried=0;
  state.notion.mockImplementation(async(_token,path,method,body)=>{
   if(method==='PATCH')return {};
   if(path.includes('/blocks/'))return {results:[],has_more:false};
   if(body?.filter?.property==='备注')return {results:[],has_more:false};
   if(path.includes('/databases/')){
    const filters=body.filter.and;
    expect(filters).toEqual(expect.arrayContaining(['brain:','run:notion-','[n8n_retired]'].map(mark=>({property:'Description',rich_text:{does_not_contain:mark}}))));
    if(filters.some(f=>f.rich_text?.contains==='[zh:'))return {results:[],has_more:false};
    queried++;return body.start_cursor==='next-page'?{results:[other],has_more:false}:{results:[first],has_more:true,next_cursor:'next-page'};
   }
   throw Error('unexpected request '+path);
  });
  await pull({query:state.query},'fixture',{env});
  expect(queried).toBe(2);expect(state.create).toHaveBeenCalledTimes(2);
 });
 it.each([pullNotionTasksForTest,pullMarkedNotionTasks])('缺游标不得报告空成功 %s',async pull=>{
  state.notion.mockResolvedValue({results:[],has_more:true,next_cursor:null});
  const result=await pull({query:state.query},'fixture',{env});
  expect(result.error).toContain('cursor');expect(state.create).not.toHaveBeenCalled();
 });
});
