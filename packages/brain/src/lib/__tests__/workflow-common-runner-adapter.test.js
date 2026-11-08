import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {digest} from '../commander-v2-contract.js';
import {matchWorkflowSource,loadWorkflowCommonRoutes} from '../workflow-common-runner-adapter.js';
const fixture=()=>{const definition={release_id:'r',workflow_id:'w',workflow_definition_version_id:'v',snapshot_sha256:'a',runtime_snapshot_sha256:'b'};
 const resources={machine:'xian-m4',profile:'legacy',device_serial:'ANGYVB4402004137',account_ref:'人工智能小诺考评'};
 const contract={resources,input_schema:{type:'object',required:['authorized'],properties:{authorized:{const:true}}}};
 const components=[{kind:'skill',revision:'a'.repeat(40),digest:'sha256:'+'b'.repeat(64)}];
 const route={profile:'publish-fixed',machine_id:'xian-m4',profile_sha256:'c'.repeat(64),definition,resources,components_sha256:digest(components)};
 return {task:{payload:{workflow_key:'publish',workflow_input:{authorized:true}}},frozen:{definition,contract,release:{payload:{components}}},routes:{publish:route}};};
describe('frozen workflow common source',()=>{
 it('accepts only the exact frozen source, skill closure and original account',()=>{const x=fixture();expect(matchWorkflowSource(x.task,x.frozen,x.routes)).toBe(x.routes.publish);});
 it.each(['release_id','snapshot_sha256','runtime_snapshot_sha256'])('rejects source drift %s',key=>{const x=fixture();x.routes.publish.definition={...x.routes.publish.definition,[key]:'different'};expect(()=>matchWorkflowSource(x.task,x.frozen,x.routes)).toThrow('source_mismatch');});
 it('rejects changed skill revision even with unchanged workflow',()=>{const x=fixture();x.frozen.release.payload.components[0].revision='e'.repeat(40);expect(()=>matchWorkflowSource(x.task,x.frozen,x.routes)).toThrow('components_mismatch');});
 it('does not silently replace the Ai办公室 account',()=>{const x=fixture();x.routes.publish.resources={...x.routes.publish.resources,account_ref:'Ai办公室'};expect(()=>matchWorkflowSource(x.task,x.frozen,x.routes)).toThrow('resource_mismatch');});
 it('does not synthesize missing authorized publication input',()=>{const x=fixture();delete x.task.payload.workflow_input;expect(()=>matchWorkflowSource(x.task,x.frozen,x.routes)).toThrow();});
 it('rejects omitted machine pin',()=>{const x=fixture();delete x.routes.publish.machine_id;expect(()=>matchWorkflowSource(x.task,x.frozen,x.routes)).toThrow('profile_unavailable');});
 it('loads only operator-owned mode600 regular route files',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wf-routes-'));try{const file=path.join(dir,'routes.json');fs.writeFileSync(file,JSON.stringify({schema_version:1,routes:fixture().routes}),{mode:0o600});expect(loadWorkflowCommonRoutes(file).publish.profile).toBe('publish-fixed');fs.chmodSync(file,0o644);expect(()=>loadWorkflowCommonRoutes(file)).toThrow('unprotected');}finally{fs.rmSync(dir,{recursive:true,force:true});}});
});
import {vi} from 'vitest';
import {createWorkflowCommonAdapter} from '../workflow-common-runner-adapter.js';
function executionFixture(){
 const x=fixture();Object.assign(x.task,{id:'10000000-0000-4000-8000-000000000001',kind:'workflow',task_type:'workflow_dispatch',status:'queued',result:{}});
 const query=vi.fn(async(sql,params)=>{
  if(sql.includes('SELECT * FROM tasks'))return {rows:[structuredClone(x.task)],rowCount:1};
  if(sql.includes("jsonb_build_object('workflow_common_runner'")){x.task.result.workflow_common_runner=JSON.parse(params[1]);x.task.status='in_progress';x.task.claimed_by='common-runner';return {rows:[],rowCount:1};}
  return {rows:[],rowCount:1};
 });
 const db={query,release:vi.fn()},pool={query,connect:async()=>db};
 const start=vi.fn(async()=>({id:'run-row'})),dispatch=vi.fn(async()=>({authenticated:true,receipt:{status:'running'},central_run:{status:'running',recording_status:'pending'}})),lockGate=vi.fn(async()=>({pass:true})),setLease=vi.fn();
 const adapter=createWorkflowCommonAdapter(pool,{routes:x.routes,frozenContract:async()=>x.frozen,startRun:start,dispatcher:{dispatch},lockGate,setLease});
 return {...x,adapter,db,pool,start,dispatch,lockGate,setLease};
}
describe('workflow common lifecycle',()=>{
 it('registers one original-task run and reuses that identity on restart',async()=>{
  const x=executionFixture();await x.adapter.dispatch(x.task.id);await x.adapter.dispatch(x.task.id);
  expect(x.start).toHaveBeenCalledOnce();expect(x.start.mock.calls[0][0]).toMatchObject({taskId:x.task.id,source:'workflow-common-runner'});
  const [action,run,body]=x.dispatch.mock.calls[0];expect(action).toBe('start');expect(body.mode).toBe('formal');expect(run).toMatch(/^[a-f0-9-]{36}$/);expect(x.dispatch.mock.calls[1][1]).toBe(run);
  expect(x.start.mock.calls[0][1].transactionClient).toBe(x.db);
  expect(x.db.query.mock.calls.some(([sql])=>sql.includes("claimed_by='common-runner'")&&sql.includes("status='in_progress'"))).toBe(true);
 });
 it('keeps existing unknown legacy execution read-only and never acquires another phone',async()=>{
  const x=executionFixture();x.task.payload.run_id='wfd-legacy';await expect(x.adapter.dispatch(x.task.id)).rejects.toThrow('existing_execution_read_only');expect(x.start).not.toHaveBeenCalled();expect(x.lockGate).not.toHaveBeenCalled();expect(x.dispatch).not.toHaveBeenCalled();
 });
 it('registers but does not execute when code device gate is busy',async()=>{
  const x=executionFixture();x.lockGate.mockResolvedValue({pass:false,status:409});expect((await x.adapter.dispatch(x.task.id)).waiting).toBe(true);expect(x.dispatch).not.toHaveBeenCalled();expect(x.setLease).not.toHaveBeenCalled();
 });
});
describe('workflow common finalization ownership',()=>{
 it.each(['completed','needs_review'])('does not release task phone when %s finalization loses ownership CAS',async status=>{
  const x=executionFixture();await x.adapter.dispatch(x.task.id);
  x.task.result.common_runner={run_id:x.task.result.workflow_common_runner.run_id};
  const observed={authenticated:true,central_run:{recording_status:'confirmed',status:status==='completed'?'success':'needs_review'},receipt:{status,execution_unknown:false,validation:{cleanup:{verdict:'pass'}}}};
  const release=vi.fn(),finalize=vi.fn(async()=>({rowCount:0})),review=vi.fn(async()=>({blocked:false}));
  const adapter=createWorkflowCommonAdapter(x.pool,{routes:x.routes,dispatcher:{dispatch:async()=>observed},releaseLock:release,finalizeTask:finalize,blockReview:review});
  await adapter.inspect(x.task);expect(release).not.toHaveBeenCalled();
  if(status==='completed')expect(finalize.mock.calls[0][3].where).toMatchObject({params:[x.task.result.workflow_common_runner.run_id]});else expect(review).toHaveBeenCalledOnce();
 });
});
describe('source revocation and bound readback',()=>{
 it('allows inspect after routing removal but cannot relaunch a signed not-started run',async()=>{
  const x=executionFixture();await x.adapter.dispatch(x.task.id);const source=x.task.result.workflow_common_runner;
  x.task.result.common_runner={run_id:source.run_id,launch_state:'not_started'};delete x.routes.publish;
  expect(await x.adapter.taskPolicy({task:x.task,db:x.db,action:'inspect',runId:source.run_id,body:{task_id:x.task.id}})).toBe(true);
  await expect(x.adapter.taskPolicy({task:x.task,db:x.db,action:'start',runId:source.run_id,body:{profile:source.profile,input:source.input}})).rejects.toThrow('profile_unavailable');
 });
});

it('a reserved source cannot acquire the phone after task ownership changes',async()=>{const x=executionFixture();await x.adapter.dispatch(x.task.id);x.lockGate.mockClear();x.task.claimed_by='session:manual';await expect(x.adapter.dispatch(x.task.id)).rejects.toThrow('task_owned');expect(x.lockGate).not.toHaveBeenCalled();});

it('workflow自动派发保持授权与原身份，并走独立可信DBOS scope',async()=>{
 const x=executionFixture(),durableStart=vi.fn(async()=>({workflow_id:'fixed'}));
 const adapter=createWorkflowCommonAdapter(x.pool,{routes:x.routes,frozenContract:async()=>x.frozen,startRun:x.start,dispatcher:{dispatch:x.dispatch},lockGate:x.lockGate,setLease:x.setLease,env:{DBOS_DURABLE_ENABLED:'true'},durableStart});
 const result=await adapter.dispatch(x.task.id);
 expect(x.lockGate).toHaveBeenCalledOnce();expect(x.dispatch).not.toHaveBeenCalled();
 expect(durableStart.mock.calls[0][0]).toMatchObject({dispatch_scope:'workflow',run_id:x.task.result.workflow_common_runner.run_id,body:{task_id:x.task.id,mode:'formal'}});
 expect(result.durable_workflow_id).toBe('fixed');
});
