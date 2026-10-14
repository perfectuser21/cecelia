import {describe,it,expect,vi,beforeEach} from 'vitest';
const network=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('../../recurring-notion-sync.js',()=>({notionReq:(...a)=>network.request(...a),getToken:()=> 'fixture'}));
vi.mock('../../notion-capture-ingest.js',()=>({notionRequest:(...a)=>network.request(...a)}));
vi.mock('../../ops-quota-notion.js',async original=>({...await original(),ensureOpsDbProps:async()=>({added:[]})}));
import {pushTaskRows,pushTaskRunsForTest,NOTION_TASKS_DB} from '../../notion-push-sync.js';
import {syncNotionEntity} from '../notion.js';
const T='11111111-1111-4111-8111-111111111111',W='22222222-2222-4222-8222-222222222222',P='33333333-3333-4333-8333-333333333333',WP='55555555-5555-4555-8555-555555555555',RD='77777777-7777-4777-8777-777777777777';
function fixture({runs=[],childFailure=false,workflowPage=WP}={}){
 const task={id:T,title:'Task',status:'failed',task_type:'script_run',workflow_id:W,notion_id:null},pending=new Map(),blocks=new Map(),events=[];let seq=0;
 const query=vi.fn(async(sql,args)=>{args=sql.values||args;sql=sql.text||sql;events.push(sql);
  if(sql.includes('INSERT INTO working_memory')){for(const [id,v]of Object.entries(JSON.parse(args[0])))pending.set('task_execution_body_pending:'+id,v);return{rows:[]};}
  if(sql.includes('SELECT key,value_json FROM working_memory'))return{rows:[...pending].map(([key,value_json])=>({key,value_json}))};
  if(sql.includes('DELETE FROM working_memory')){if(JSON.stringify(pending.get(args[0]))===args[1])pending.delete(args[0]);return{rows:[]};}
  if(sql.includes('pg_try_advisory_lock'))return{rows:[{locked:true}]};
  if(sql.includes('FROM projection_targets'))return{rows:sql.includes("'notion-directory'")?[{config:{dbs:{workflows:WP}}}]:[{enabled:true,config:{task_db_id:NOTION_TASKS_DB,project_db_id:WP}}]};
  if(sql.includes('FROM notion_projection_map'))return{rows:[{notion_db_id:args?.[0]==='task_runs'?RD:NOTION_TASKS_DB}]};
  if(sql.includes('FROM tasks'))return{rows:[task]};
  if(sql.includes('FROM task_runs r'))return{rows:runs.map(r=>({...r,task_title:task.title}))};
  if(sql.includes('FROM task_runs WHERE'))return{rows:runs.map(r=>({...r,total_runs:runs.length}))};
  if(sql.includes('FROM workflows'))return{rows:[{id:W,name:'正式流程',notion_id:workflowPage}]};
  if(sql.includes('SELECT external_id FROM projection_links'))return{rows:task.notion_id?[{external_id:task.notion_id}]:[]};
  if(/UPDATE tasks SET notion_id=\$2/.test(sql)||/UPDATE tasks SET notion_id=\$1/.test(sql)){task.notion_id=args[1]===P?args[1]:args[0]===P?args[0]:task.notion_id;events.push('TASK_ID_SAVED');}
  if(/UPDATE task_runs SET notion_id/.test(sql)){const r=runs.find(r=>r.id===args[0]);if(r)r.notion_id=args[1];events.push('RUN_ID_SAVED');}
  return{rows:[],rowCount:1};});
 const pool={query,connect:vi.fn(async()=>({query,release:vi.fn()}))};
 network.request.mockImplementation(async(token,path,method='GET',body)=>{
  if(path==='/pages'&&method==='POST'){if(body.parent.database_id===NOTION_TASKS_DB)return{id:P};return{id:`88888888-8888-4888-8888-${String(++seq).padStart(12,'0')}`};}
  if(path===`/pages/${P}`)return{id:P,parent:{database_id:NOTION_TASKS_DB},properties:{Description:{rich_text:[{plain_text:'script_run · brain:'+T}]}}};
  if(path.startsWith('/pages/')&&method==='PATCH')return{id:path.split('/')[2]};
  const m=path.match(/^\/blocks\/([^/?]+)\/children/);
  if(m&&method==='GET')return{results:blocks.get(m[1])||[],has_more:false};
  if(m&&method==='PATCH'){if(m[1]===P){events.push('TASK_BODY_WRITE');expect(task.notion_id).toBe(P);if(childFailure)throw Object.assign(Error('block404'),{status:404});}const kids=body.children.map(b=>{const id='block-'+(++seq);blocks.set(id,b[b.type]?.children||[]);return{...b,id};});blocks.set(m[1],[...(blocks.get(m[1])||[]),...kids]);return{results:kids};}
  if(method==='DELETE'){for(const [id,kids]of blocks)blocks.set(id,kids.filter(b=>b.id!==path.split('/').at(-1)));return{};}
  throw Error('unexpected '+method+' '+path);
 });
 return{task,pool,pending,events,blocks,setChildFailure:v=>{childFailure=v;},setWorkflowPage:v=>{workflowPage=v;}};
}
beforeEach(()=>{network.request.mockReset();vi.stubEnv('NOTION_API_KEY','fixture');vi.spyOn(console,'warn').mockImplementation(()=>{});});
describe('正式Task与Run推送的正文接缝',()=>{
 it('真实legacy Task先持久ID；子block404不清ID，后续零Run周期自愈',async()=>{const f=fixture({childFailure:true});await pushTaskRows(f.pool,'fixture',[f.task]);expect(f.task.notion_id).toBe(P);expect(f.events.indexOf('TASK_ID_SAVED')).toBeLessThan(f.events.indexOf('TASK_BODY_WRITE'));expect(f.events.some(s=>s.includes('SET notion_id=NULL'))).toBe(false);expect(f.pending.size).toBe(1);f.setChildFailure(false);await pushTaskRunsForTest(f.pool,'fixture');expect(f.pending.size).toBe(0);});
 it('Run页晚到经真实统一引擎保存全部ID后自动重建两个attempt',async()=>{const runs=[1,2].map(n=>({id:'row'+n,task_id:T,workflow_id:W,run_id:'real-a'+n,status:'failed',notion_id:null,notion_digest:null,started_at:'2026-10-14T00:00:00Z',context:{},result:{}}));const f=fixture({runs});await pushTaskRows(f.pool,'fixture',[f.task]);expect(f.pending.size).toBe(1);await pushTaskRunsForTest(f.pool,'fixture');expect(runs.every(r=>r.notion_id)).toBe(true);expect(f.pending.size).toBe(0);expect(f.events.lastIndexOf('TASK_BODY_WRITE')).toBeGreaterThan(f.events.lastIndexOf('RUN_ID_SAVED'));const last=network.request.mock.calls.filter(a=>a[1]===`/blocks/${P}/children`&&a[2]==='PATCH').at(-1);for(const r of runs)expect(JSON.stringify(last)).toContain(r.notion_id.replaceAll('-',''));});
 it('零Run的Workflow页晚到经正式周期补齐，不改Task属性',async()=>{const f=fixture({workflowPage:null});await pushTaskRows(f.pool,'fixture',[f.task]);expect(f.pending.size).toBe(1);const taskBefore=JSON.stringify(f.task);f.setWorkflowPage(WP);await pushTaskRunsForTest(f.pool,'fixture');expect(f.pending.size).toBe(0);expect(JSON.stringify(f.task)).toBe(taskBefore);});
 it('modern outbox adapter同样在ID持久后写正文，失败隔离',async()=>{const f=fixture({childFailure:true});await expect(syncNotionEntity(f.pool,{target:'notion',entity_type:'tasks',entity_id:T})).resolves.toMatchObject({externalId:P,skipped:true,reason:'task_execution_body_pending'});expect(f.task.notion_id).toBe(P);expect(f.pending.size).toBe(1);});
});
