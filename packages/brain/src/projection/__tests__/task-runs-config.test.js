import {describe,it,expect,vi} from 'vitest';
import {OPS_DB_PROPS as schema} from '../../ops-notion-schema.js';
const api=await import('../task-runs-config.js').catch(()=>({}));
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const body=()=>({database_id:id(1),enabled:true,actor:'operator'});
function fixture(rows=[]){const query=vi.fn(async(sql)=>({rows:sql.includes('SELECT notion_db_id')?rows:sql.includes('RETURNING')?[{notion_db_id:id(1)}]:[],rowCount:1}));const client={query,release:vi.fn()};return{pool:{connect:async()=>client},query};}
const db=()=>({id:id(1),properties:{Name:{type:'title'}},parent:{page_id:id(9)}});
describe('task_runs 正式投影登记',()=>{
 it('缺少显式启用、actor、未知字段写前拒绝',async()=>{for(const b of [{database_id:id(1)},{...body(),enabled:false},{...body(),token:'x'},{...body(),actor:''}])expect(()=>api.validateTaskRunsConfig(b)).toThrow();});
 it('拒绝抢占旧Ops Runs映射，零外部写',async()=>{const f=fixture([{notion_db_id:id(1),brain_table:'ops_runs',vessel:'old'}]),notionReq=vi.fn();await expect(api.configureTaskRunsProjection(f.pool,body(),{token:'test',notionReq})).rejects.toThrow(/归属/);expect(notionReq).not.toHaveBeenCalled();});
 it('schema类型冲突写前拒绝',async()=>{const f=fixture(),notionReq=vi.fn().mockResolvedValue({...db(),properties:{Name:{type:'title'},RunId:{type:'number'}}});await expect(api.configureTaskRunsProjection(f.pool,body(),{token:'test',notionReq})).rejects.toThrow(/RunId/);expect(notionReq.mock.calls.every(c=>c[2]==='GET')).toBe(true);expect(f.query.mock.calls.some(([s])=>s.includes('INSERT'))).toBe(false);});
 it('配置补缺列并注册新真身，保留所有旧映射',async()=>{let patched=false;const f=fixture(),notionReq=vi.fn(async(_t,_p,m)=>m==='GET'?{...db(),properties:patched?Object.fromEntries(Object.entries(schema.task_runs).map(([k,v])=>[k,{type:Object.keys(v)[0]}])):db().properties}:(patched=true,{}));expect(await api.configureTaskRunsProjection(f.pool,body(),{token:'test',notionReq})).toMatchObject({database_id:id(1),status:'active'});const patch=notionReq.mock.calls.find(c=>c[2]==='PATCH');expect(patch[3].properties.RunId).toEqual({rich_text:{}});expect(patch[3].properties.Name).toBeUndefined();expect(f.query.mock.calls.some(([s])=>/DELETE|UPDATE notion_projection_map/.test(s))).toBe(false);});
 it('拒绝换到第二个active Runs库，零外部写',async()=>{const f=fixture([{notion_db_id:id(2),brain_table:'task_runs',status:'active',vessel:'notion-push-sync.pushTaskRuns',face:'mirror'}]),notionReq=vi.fn();await expect(api.configureTaskRunsProjection(f.pool,body(),{token:'test',notionReq})).rejects.toThrow(/已存在/);expect(notionReq).not.toHaveBeenCalled();});
 it('父页分页不完整不得创建重复库',async()=>{const f=fixture(),notionReq=vi.fn().mockResolvedValue({results:[],has_more:true,next_cursor:null});await expect(api.configureTaskRunsProjection(f.pool,{parent_page_id:id(9),enabled:true,actor:'operator'},{token:'test',notionReq})).rejects.toThrow(/分页/);expect(notionReq.mock.calls.every(c=>c[2]==='GET')).toBe(true);});
});
describe('bootstrap外部故障与幂等',()=>{
 it('创建读回后登记，重试认领同库零重复POST',async()=>{
  const f=fixture();let exists=false;const full={...db(),description:[{plain_text:api.TASK_RUNS_MARKER}],properties:Object.fromEntries(Object.entries(schema.task_runs).map(([k,v])=>[k,{type:Object.keys(v)[0]}]))};
  const notionReq=vi.fn(async(_t,path,method)=>{if(path.includes('/children'))return{results:exists?[{id:id(1),type:'child_database',child_database:{title:api.TASK_RUNS_TITLE}}]:[],has_more:false,next_cursor:null};if(method==='POST'){exists=true;return{id:id(1)}}return full;});
  const input={parent_page_id:id(9),enabled:true,actor:'operator'};
  await api.configureTaskRunsProjection(f.pool,input,{token:'test',notionReq});await api.configureTaskRunsProjection(f.pool,input,{token:'test',notionReq});
  expect(notionReq.mock.calls.filter(c=>c[2]==='POST')).toHaveLength(1);expect(f.query.mock.calls.filter(([s])=>s.includes('INSERT INTO notion_projection_map'))).toHaveLength(2);
 });
 it('创建后读回失败不登记，留来源标记供重试认领',async()=>{const f=fixture(),notionReq=vi.fn(async(_t,p,m)=>p.includes('/children')?{results:[],has_more:false,next_cursor:null}:m==='POST'?{id:id(1)}:Promise.reject(Error('remote unavailable')));await expect(api.configureTaskRunsProjection(f.pool,{parent_page_id:id(9),enabled:true,actor:'operator'},{token:'test',notionReq})).rejects.toThrow('remote unavailable');expect(f.query.mock.calls.some(([s])=>s.includes('INSERT'))).toBe(false);expect(f.query.mock.calls.some(([s])=>s.includes('pg_advisory_unlock'))).toBe(true);});
 it('schema补列读回仍不完整时不登记',async()=>{const f=fixture(),notionReq=vi.fn().mockResolvedValue(db());await expect(api.configureTaskRunsProjection(f.pool,body(),{token:'test',notionReq})).rejects.toThrow(/读回/);expect(f.query.mock.calls.some(([s])=>s.includes('INSERT'))).toBe(false);});
});
