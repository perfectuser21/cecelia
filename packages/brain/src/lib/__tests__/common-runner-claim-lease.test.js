import {describe,it,expect,vi} from 'vitest';
import {createHmac} from 'node:crypto';
import {createCommonRunnerDispatcher} from '../common-runner-dispatch.js';
import {runCommonRunnerTasks} from '../../common-runner-executor.js';
const taskId='10000000-0000-4000-8000-000000000001',runId='20000000-0000-4000-8000-000000000001';
const claimedAt='2026-11-12 03:23:23.333456+00',token='isolated-claim-lease-test-token-123456';
function fixture({preclaimed=false,conflict=false}={}){
 let task={id:taskId,status:'queued',kind:'agent',payload:{},result:{},claimed_by:preclaimed?'common-runner':null,claimed_at:preclaimed?claimedAt:null},context=null,lease=null,snapshot;
 if(conflict)lease={task_id:taskId,claimer:'foreign',source:'claim',released_at:null,active:true,claim_matches:true};
 const statements=[];
 const query=vi.fn(async(sql,p=[])=>{statements.push(sql);
  if(sql==='BEGIN'){snapshot=structuredClone({task,context,lease});return {rows:[]};}
  if(sql==='ROLLBACK'){({task,context,lease}=snapshot);return {rows:[]};}
  if(sql.includes('FROM tasks')){
   if(sql.includes("WHERE status='in_progress'")&&task.status!=='in_progress')return {rows:[]};
   if(sql.includes("WHERE status='queued'")&&task.status!=='queued')return {rows:[]};
   if(sql.includes('claimed_at = $3::timestamptz')&&(task.claimed_by!==p[1]||task.claimed_at!==p[2]||task.status!=='in_progress'))return {rows:[]};
   return {rows:[structuredClone(task)]};
  }
  if(sql.includes('FROM task_runs'))return {rows:context?[{id:'50000000-0000-4000-8000-000000000001',task_id:taskId,context,status:'running',ended_at:null}]:[]};
  if(sql.includes('FROM task_leases'))return {rows:lease?[lease]:[]};
  if(sql.includes('INSERT INTO task_leases')){lease={task_id:taskId,claimer:p[1],claimed_at:p[2],source:'claim',lease_seconds:p[3],lease_until:'2026-11-12T04:23:23.333456Z'};return {rows:[lease],rowCount:1};}
  if(sql.includes('UPDATE tasks')){
   if(p[1])Object.assign(task.result,JSON.parse(p[1]));
   if(sql.includes("claimed_by='common-runner'")||sql.includes("claimed_by=COALESCE")){task.claimed_by??='common-runner';task.claimed_at??=claimedAt;}
   if(sql.includes("status='in_progress'"))task.status='in_progress';
   return {rows:[{...structuredClone(task),lease_claimed_at:task.claimed_at}],rowCount:1};
  }
  return {rows:[],rowCount:1};
 });
 const db={query,release:vi.fn()},pool={query,connect:vi.fn(async()=>db)};
 const transport=vi.fn(async({body})=>{expect(lease?.claimer).toBe('common-runner');expect(statements.at(-1)).toBe('COMMIT');const receipt={...body,machine_id:'node-a',status:'running'};return {receipt,signature:createHmac('sha256',token).update(JSON.stringify(receipt)).digest('hex')};});
 const dispatcher=createCommonRunnerDispatcher({pool,token,transport,profiles:{demo:{machine_id:'node-a',profile_sha256:'a'.repeat(64)}},assertCanStart:async()=>{},
  executionDirectory:{current:()=>({version:'fixture'})},authorizeExecution:async(_db,_input,fn)=>fn({executionVersionId:'30000000-0000-4000-8000-000000000001',grantId:'40000000-0000-4000-8000-000000000001',node:{canonical_id:'node-a',endpoints:{worker:'http://127.0.0.1:5231'}}},db),
  startRun:async input=>{context={...input.context,source:input.source};return {id:'50000000-0000-4000-8000-000000000001'};}});
 return {pool,dispatcher,transport,statements,get task(){return task;},get lease(){return lease;}};
}
const body={task_id:taskId,profile:'demo',input:{},mode:'exploration'};
describe('CommonRunner真实入口先提交同owner租约再启动Worker',()=>{
 it.each([false,true])('直接API兼容executor预领单=%s，保留认领时间与有限租约',async preclaimed=>{
  const f=fixture({preclaimed});expect(await f.dispatcher.dispatch('start',runId,body)).toMatchObject({authenticated:true});
  expect(f.lease).toMatchObject({claimer:'common-runner',claimed_at:claimedAt,lease_seconds:3600});expect(f.task.claimed_at).toBe(claimedAt);expect(f.transport).toHaveBeenCalledOnce();
 });
 it('实际executor先raw claim的入口也衔接相同Task claim租约',async()=>{
  const f=fixture();f.task.payload.common_runner={run_id:runId,profile:'demo',input:{},mode:'exploration'};
  expect(await runCommonRunnerTasks(f.pool,{dispatcher:f.dispatcher,recordEvent:vi.fn()})).toMatchObject({dispatched:1,errors:0});expect(f.transport).toHaveBeenCalledOnce();expect(f.lease.claimed_at).toBe(f.task.claimed_at);
 });
 it('异主已有lease阻止启动且预约事务回滚，不抢认领',async()=>{
  const f=fixture({conflict:true});await expect(f.dispatcher.dispatch('start',runId,body)).rejects.toThrow('task_claim_lease_conflict');expect(f.transport).not.toHaveBeenCalled();expect(f.statements.at(-1)).toBe('ROLLBACK');expect(f.task.result.common_runner).toBeUndefined();expect(f.task.claimed_by).toBeNull();expect(f.lease.claimer).toBe('foreign');
 });
});
