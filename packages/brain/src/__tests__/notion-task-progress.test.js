import handoff from './fixtures/task-release-handoff.json';
import {beforeEach,expect,it,vi} from 'vitest';
const {request}=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('../recurring-notion-sync.js',()=>({notionReq:request,getToken:()=> 'token'}));
import {pushTasksForTest,buildTaskNotionProperties,ingestDelegatedPage} from '../notion-push-sync.js';

let blocks,sequence,query;
const task=()=>({id:'task-one',title:'修复发布门禁',description:'最初目标不能遗忘',status:'in_progress',priority:'P1',task_type:'dev',
 notion_id:'page-one',notion_props:{pushed_status:'in_progress'},project_notion_id:'project-one',content_hash:'hash-one',
 result:{phase:'验证',facts:['采集已读回'],pr_url:'https://github.com/owner/repo/pull/12',handoff:{summary:'已完成门禁修复',next_steps:[{kind:'task',title:'实际部署核验'}]}}});
beforeEach(()=>{
 blocks=[{id:'human',type:'paragraph',paragraph:{rich_text:[{text:{content:'人写的备注必须保留'}}]}}];sequence=0;query=vi.fn(async()=>({rows:[]}));
 request.mockReset();request.mockImplementation(async(_token,path,method='GET',body)=>{
  if(path==='/pages/page-one'&&method==='PATCH')return {id:'page-one'};
  if(path.startsWith('/blocks/page-one/children')&&method==='GET')return {results:blocks,has_more:false};
  if(path==='/blocks/page-one/children'&&method==='PATCH'){
   const added=body.children.map(b=>({...b,id:`machine-${++sequence}`}));blocks.push(...added);return {results:added};
  }
  const id=path.split('/')[2],block=blocks.find(b=>b.id===id);
  if(block&&method==='GET')return {results:block.toggle.children,has_more:false};
  if(block&&method==='DELETE'){blocks=blocks.filter(b=>b.id!==id);return {};}
  throw Error(`unexpected request ${method} ${path}`);
 });
});
it('投影真实目标、事实、PR与交接，保留人工正文；重复同步不堆积',async()=>{
 const t=task();await pushTasksForTest({query},'token',[t]);await pushTasksForTest({query},'token',[t]);
 const body=JSON.stringify(blocks);
 for(const text of ['最初目标不能遗忘','采集已读回','https://github.com/owner/repo/pull/12','实际部署核验','人写的备注必须保留'])expect(body).toContain(text);
 expect(blocks.filter(b=>b.type==='toggle')).toHaveLength(1);
 expect(query.mock.calls.some(([sql,args])=>sql.includes('UPDATE tasks')&&args.includes('hash-one'))).toBe(true);
});
it('正文写入或读回失败，不推进任务同步指纹；恢复重试只留一份机器正文',async()=>{
 const normal=request.getMockImplementation();let fail=true;
 request.mockImplementation(async(...args)=>{if(fail&&args[1].includes('/children')&&args[2]==='PATCH'){fail=false;await normal(...args);throw Error('断网后返回丢失');}return normal(...args);});
 await pushTasksForTest({query},'token',[task()]);
 expect(query.mock.calls.filter(([sql])=>sql.includes('UPDATE tasks'))).toHaveLength(0);
 await pushTasksForTest({query},'token',[task()]);
 expect(blocks.filter(b=>b.type==='toggle')).toHaveLength(1);
 expect(query.mock.calls.filter(([sql])=>sql.includes('UPDATE tasks'))).toHaveLength(1);
});
it('Project已在Brain移除时清空原机器关联；从未关联时不动人工Project',()=>{
 expect(buildTaskNotionProperties({...task(),project_notion_id:null,notion_props:{pushed_project:'old'}}).Project).toEqual({relation:[]});
 expect(buildTaskNotionProperties({...task(),project_notion_id:null,notion_props:{}}).Project).toBeUndefined();
});
it('机器进度不作为新排单回灌',async()=>{
 const result=await ingestDelegatedPage({query},'token',{id:'page-one',properties:{Name:{title:[{text:{content:'修复'}}]},Description:{rich_text:[{text:{content:'dev · brain:task-one'}}]}}});
 expect(result.kind).toBe('skipped');expect(request).not.toHaveBeenCalled();
});

it('现行发布交接完整投影已完成、未完成、范围、证据与下一棒，敏感无关字段不显示',async()=>{
 const t=task();t.result={handoff,heartbeat_count:25,secret:'NEVER_PROJECT'};
 await pushTasksForTest({query},'token',[t]);const content=JSON.stringify(blocks);
 for(const value of [...handoff.done,...handoff.not_done,handoff.scope,...handoff.artifacts.pr_urls,...handoff.artifacts.run_urls,...handoff.next_steps.map(s=>s.task_id)])expect(content).toContain(value);
 expect(content).not.toContain('NEVER_PROJECT');expect(content).not.toContain('heartbeat_count');
});
it('创建成功但Brain保存页身份失败，按brain标记找回同页并补正文',async()=>{
 const t={...task(),notion_id:null,notion_props:null};let created=null,failed=false;
 const normal=request.getMockImplementation();
 request.mockImplementation(async(...args)=>{
  if(args[1].startsWith('/databases/'))return {results:created?[created]:[],has_more:false};
  if(args[1]==='/pages'&&args[2]==='POST'){created={id:'page-one',properties:args[3].properties};return created;}
  return normal(...args);
 });
 query.mockImplementation(async sql=>{if(sql.includes('UPDATE tasks')&&!failed){failed=true;throw Error('数据库写回丢失');}return {rows:[]};});
 await pushTasksForTest({query},'token',[t]);await pushTasksForTest({query},'token',[t]);
 expect(request.mock.calls.filter(([,path,method])=>path==='/pages'&&method==='POST')).toHaveLength(1);
 expect(blocks.filter(b=>b.type==='toggle')).toHaveLength(1);
 expect(query.mock.calls.some(([sql])=>sql.includes('notion_synced_at'))).toBe(true);
});
it('正文400不是错库，不清除已确定的任务页身份',async()=>{
 const normal=request.getMockImplementation();request.mockImplementation(async(...args)=>{
  if(args[1].includes('/children'))throw Error('Notion 400: body invalid');return normal(...args);
 });
 await pushTasksForTest({query},'token',[task()]);expect(query.mock.calls.filter(([sql])=>sql.includes('UPDATE tasks'))).toHaveLength(0);
});
