import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { releaseEvidenceDatabase } from '../../../__tests__/fixtures/release-evidence-db.js';
import { withLegacyNames } from '../../../__tests__/fixtures/minimum-definition-schema.js';
import { createRelease, recordReleaseObservation } from '../../release-index.js';
import { dispatchCommanderV2, prepareCommander } from '../../commander-v2-dispatch.js';
import { receiveCommanderEvent } from '../../commander-v2-feedback.js';
import { reconcileCommanderTask } from '../../commander-v2-control.js';
let f, id, definition, contract, deps;
const input = { text: '中文\n换行 $(touch /tmp/no-command) `false` ; "引号"', empty: [] };
beforeEach(async context => {
 f = await releaseEvidenceDatabase(context.task.name.includes('冻结shell') ? {activityExecutor:'shell'} : {}); id = randomUUID();
 await f.db.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_task_id uuid,ADD COLUMN IF NOT EXISTS project_id uuid,ADD COLUMN IF NOT EXISTS summary text,ADD COLUMN IF NOT EXISTS priority text,ADD COLUMN IF NOT EXISTS due_at timestamptz,ADD COLUMN IF NOT EXISTS description text,ADD COLUMN IF NOT EXISTS result jsonb,ADD COLUMN IF NOT EXISTS task_type text,ADD COLUMN IF NOT EXISTS claimed_by text,ADD COLUMN IF NOT EXISTS claimed_at timestamptz,ADD COLUMN IF NOT EXISTS executor_kind text,ADD COLUMN IF NOT EXISTS error_message text`);
 await f.db.query(readFileSync(new URL('../../../../migrations/268_task_events.sql',import.meta.url),'utf8'));
 await f.db.query(readFileSync(new URL('../../../../migrations/553_task_leases_device_pools.sql',import.meta.url),'utf8').split('CREATE TABLE IF NOT EXISTS device_pools')[0]);
 await f.db.query('CREATE TABLE IF NOT EXISTS device_locks(locked_by text,expires_at timestamptz)');
 await f.db.query('DROP TABLE spans CASCADE');
 for(const file of ['495_vs_model_spans.sql','514_span_occurrences.sql','516_span_definition_provenance.sql'])await withLegacyNames(f.db,()=>f.db.query(readFileSync(new URL(`../../../../migrations/${file}`,import.meta.url),'utf8')));
 const release=(await createRelease(f.db,f.releaseInput)).release;
 const observation=(await recordReleaseObservation(f.db,release.id,f.observationInput,{trustedCollector:'fixture-collector'})).observation;
 definition=f.runInput(release,observation);delete definition.source_kind;delete definition.external_origin;
 contract={ key:'report', input_schema:{type:'object',required:['text','empty'],properties:{text:{type:'string'},empty:{type:'array'}}}, resources:{},recovery:{max_attempts:2,total_timeout_sec:2400,cleanup_timeout_sec:300,retry_safe:true,retry_on:['verification_failed','execution_failed']} };
 await f.db.query("INSERT INTO tasks(id,title,status,task_type,payload) VALUES($1,'通用报告','queued','workflow_dispatch',$2)",[id,{commander_protocol:'commander-v2',workflow_key:'report',workflow_input:input,workflow_definition:definition}]);
 deps={ afterTerminal:vi.fn(), frozenContract:async()=>({definition,contract}),ready:vi.fn(async e=>({protocol:'commander-v2',ready:true,...e.definition})),sshDispatch:vi.fn(async()=> 'DISPATCHED'),lockGate:vi.fn(async()=>({pass:true})),setLease:vi.fn(),releaseLease:vi.fn(),releaseLock:vi.fn(),createVerify:vi.fn(async(db,spec)=>{
   const child=randomUUID();await db.query("INSERT INTO tasks(id,title,status,task_type,payload,description,parent_task_id) VALUES($1,$2,'queued','research',$3,$4,$5)",[child,spec.title,spec.metadata,spec.description,id]);return {task:{id:child}};
 }) };
});
afterEach(async()=>{await f?.close();f=null;});
async function state(){return (await f.db.query('SELECT * FROM tasks WHERE id=$1',[id])).rows[0];}
async function envelope(){return (await state()).result.workflow_control.envelope;}
async function sendEvent(seq,type,data,e){e??=await envelope();return receiveCommanderEvent(f.db,id,{protocol:e.protocol,run_id:e.run_id,attempt:e.attempt,owner_epoch:e.owner_epoch,seq,type,data});}
function delivery(e,over={}) { return {...e,status:'completed',outputs:[{path:'/tmp/report.json'}],evidence:['source:actual'],cleanup:{completed:true,evidence:['resource:free']},effects:[],...over}; }
async function stopWithDelivery(e,over={}){
 const seq=((await state()).result.workflow_control.last_seq??0)+1;
 await sendEvent(seq,'delivery',delivery(e,over),e);
 await reconcileCommanderTask(f.db,id,{...deps,status:async()=>({protocol:e.protocol,run_id:e.run_id,execution_stopped:true,events:[]})});
}
async function verify(verdict){
 const c=(await state()).result.workflow_control,e=c.envelope;
 const child=(await f.db.query('SELECT * FROM tasks WHERE id=$1',[c.verify_task_id])).rows[0];
 await f.db.query("UPDATE tasks SET status='completed',result=$2 WHERE id=$1",[c.verify_task_id,{receipt:{verification_runtime:{provider:'openai',model:'gpt-6.1-sol',logical_run_id:child.payload.run_id,official_run_id:'fixture',rerouted:false}},workflow_verification:{task_id:id,run_id:e.run_id,attempt:e.attempt,definition_sha256:e.definition.snapshot_sha256,verdict,assertions:[{name:'cleanup',pass:true},{name:'effects_safe_to_retry',pass:true},{name:'output',pass:verdict==='PASS'}],evidence:['independent:readback']}}]);
 await reconcileCommanderTask(f.db,id,deps);
}
async function completePath(e){
 let seq=(await state()).result.workflow_control.last_seq;
 for(const path of e.definition.expected_path)await sendEvent(++seq,'activity_completed',{reference_id:path.reference_id,step_id:path.step_id,started_at:'2026-10-13T00:00:00Z',ended_at:'2026-10-13T00:01:00Z',outcome:'pass',evidence:{ref:'actual:execution'}},e);
}
import { digest } from '../../commander-v2-contract.js';
import { methodManifest, expectedPath } from '../../commander-method-contract.js';
import { launchCommander } from '../../commander-v2-dispatch.js';
async function versions(revision,date,differentBusiness=false,driftSafety=false,businessSkill=false) {
 const acts=[];
 for(const a of f.activities){
  const row=structuredClone(a);row.id=randomUUID();row.source_commit=revision;row.created_at=date;row.payload.source_commit=revision;
  for(const b of row.payload.implementation_bindings??[]){b.revision=revision;if(differentBusiness)b.digest='sha256:'+revision[0].repeat(64);}
  if(row.payload.implementation_bindings?.length) {row.payload.contract={...row.payload.contract,key:'report',executor_kind:differentBusiness?'code':'agent',...(businessSkill?{skill:'business-skill'}:{})};if(driftSafety)row.payload.implementation_bindings.push({kind:'code',repo:row.source_repo,path:'src/supervisor.py',revision,digest:'sha256:'+(revision[0]==='e'?'8':'7').repeat(64),status:'verified'});}
  row.payload_sha256=digest(row.payload);
  await f.db.query('INSERT INTO activity_definition_versions(id,activity_id,payload,contract_sha256,payload_sha256,source_repo,source_path,source_commit,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[row.id,row.activity_id,row.payload,digest(row.payload.contract),row.payload_sha256,row.source_repo,row.source_path,revision,date]);acts.push(row);
 }
 const business=acts.find(a=>a.payload.implementation_bindings?.length);
 const meta=structuredClone(business);meta.id=randomUUID();meta.payload.contract={key:'supervisor',executor_kind:'code'};
 meta.payload.implementation_bindings=[{kind:'code',repo:meta.source_repo,path:'src/supervisor.py',revision,digest:'sha256:'+(driftSafety&&revision[0]==='e'?'8':'7').repeat(64),status:'verified'}];meta.payload_sha256=digest(meta.payload);
 await f.db.query('INSERT INTO activity_definition_versions(id,activity_id,payload,contract_sha256,payload_sha256,source_repo,source_path,source_commit,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[meta.id,meta.activity_id,meta.payload,digest(meta.payload.contract),meta.payload_sha256,meta.source_repo,meta.source_path,revision,date]);
 if(f.workflows.length===2)for(let i=2;i<7;i++){
  const row=structuredClone(f.workflows[0]);row.workflow_id=randomUUID();row.payload.workflow_id=row.workflow_id;
  await f.db.query('INSERT INTO workflows(id,capability_id,key,name,channel) VALUES($1,$2,$3,$3,$4)',[row.workflow_id,row.payload.capability_id,`other_business_${i}`,'fixture']);f.workflows.push(row);
 }
 const workflows=[];
 for(const [i,w] of f.workflows.entries()){
  const row=structuredClone(w);row.id=randomUUID();row.source_commit=revision;row.created_at=date;row.payload.source_commit=revision;
  row.payload.contract={...row.payload.contract,...contract,key:i===0?'report':i===1?'workflow_commander.internal':`other_business_${i}`};
  for(const ref of row.payload.activities){ref.activity_version_id=acts.find(a=>a.activity_id===ref.activity_id).id;if(ref.activity_id===business.activity_id)ref.slot_key='report';}
  if(i===1)row.payload.activities=[{...row.payload.activities[0],activity_id:meta.activity_id,activity_version_id:meta.id,slot_key:'supervisor'}];
  row.payload_sha256=digest(row.payload);
  await f.db.query('INSERT INTO workflow_definition_versions(id,workflow_id,payload,contract_sha256,payload_sha256,source_repo,source_path,source_commit,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[row.id,row.workflow_id,row.payload,digest(row.payload.contract),row.payload_sha256,row.source_repo,row.source_path,revision,date]);workflows.push(row);
 }
 acts.push(meta);
 const all=acts.flatMap(a=>(a.payload.implementation_bindings??[]).filter(b=>['code','skill'].includes(b.kind)).map(({kind,repo,path,revision,digest})=>({kind,repo,path,revision,digest})));
 const components=[{kind:'repo',repo:workflows[0].source_repo,revision},...new Map(all.map(b=>[JSON.stringify(b),b])).values()];
 return {workflows,activities:acts,components,verification:{status:'verified',gaps:[]},allowed_enabler_calls:[],ci_evidence:[]};
}
// 合成固定release前置只位于scratch；CI证明的验证另由release-index事务回归覆盖。
async function install(payload,target='mmv',evidence='fixture:actual'){
 const release=(await f.db.query('INSERT INTO release_versions(release_key,manifest_sha256,request_sha256,environment,target,actor,payload) VALUES($1,$2,$2,$3,$4,$5,$6) RETURNING *',[randomUUID(),digest(payload),'scratch',target,'fixture',payload])).rows[0];
 const observation=(await recordReleaseObservation(f.db,release.id,{...f.observationInput,event_key:randomUUID(),environment:'scratch',target,components:payload.components,evidence_ref:evidence,observed_at:new Date().toISOString()},{trustedCollector:'fixture-collector'})).observation;
 return {release,observation};
}
function use({release:r,observation:o}){
 const w=r.payload.workflows[0];definition={release_id:r.id,observation_id:o.id,workflow_id:w.workflow_id,workflow_definition_version_id:w.id,snapshot_sha256:w.payload_sha256,runtime_snapshot_sha256:'9'.repeat(64),expected_path:expectedPath(r,w.id)};contract=w.payload.contract;
}
async function historyAndFailure(differentBusiness=false,driftSafety=false,businessSkill=false){
 const historical=await install(await versions('d'.repeat(40),'2025-01-01T00:00:00Z',differentBusiness,driftSafety,businessSkill));use(historical);
 await dispatchCommanderV2(f.db,id,deps);const old=await envelope();await completePath(old);await stopWithDelivery(old);await verify('PASS');
 expect((await state()).status).toBe('completed');const historyTask=await state();
 const current=await install(await versions('e'.repeat(40),'2026-01-01T00:00:00Z',differentBusiness,driftSafety,businessSkill));use(current);
 id=randomUUID();await f.db.query("INSERT INTO tasks(id,title,status,task_type,payload) VALUES($1,'失败后选方法','queued','workflow_dispatch',$2)",[id,{commander_protocol:'commander-v2',workflow_key:'report',workflow_input:input,workflow_definition:definition}]);
 await dispatchCommanderV2(f.db,id,deps);const first=await envelope();await stopWithDelivery(first);await verify('FAIL');
 const w=historical.release.payload.workflows[0],ids=new Set(w.payload.activities.map(r=>r.activity_version_id));
 const mp={...historical.release.payload,workflows:[w],activities:historical.release.payload.activities.filter(a=>ids.has(a.id))};
 const manifest=methodManifest({payload:mp},w.id),hash=digest(manifest),root=`/Users/administrator/.local/share/zenithjoy/commander-methods/${hash}`;
 mp.components=[{kind:'repo',...manifest.source},...manifest.bindings];
 const resolved=manifest.bindings.map(b=>({...b,absolute_path:`${root}/${b.path}`}));
 const method=await install(mp,`mmv--method--${hash}`,'commander-method-v1:'+JSON.stringify({physical_host:'mmv',method_root:root,manifest_sha256:hash,resolved_bindings_sha256:digest(resolved),installation_sha256:'8'.repeat(64)}));
 deps.ready.mockImplementation(async e=>({protocol:'commander-v2',ready:true,...e.definition,runtime_snapshot_sha256:e.definition.runtime_snapshot_sha256??'9'.repeat(64),...(e.method_selection?{supervisor_runtime_sha256:e.method_selection.supervisor_definition.runtime_snapshot_sha256,method_manifest_sha256:e.method_selection.method_instance.manifest_sha256,resolved_bindings_sha256:digest(e.method_selection.method_instance.resolved_bindings)}:{})}));
 return {historical,current,method,first,historyTask,old};
}
it('历史精确PASS使同task新run选择旧方法，双gate冻结，原目标输入与总预算不变；并发只起跑一次',async()=>{
 const {historical,first,historyTask,old}=await historyAndFailure(),before=deps.sshDispatch.mock.calls.length;
 await Promise.all([dispatchCommanderV2(f.db,id,deps),dispatchCommanderV2(f.db,id,deps)]);const next=await envelope();
 expect(next.definition.workflow_definition_version_id).toBe(historical.release.payload.workflows[0].id);
 expect(next.method_selection.selection_receipt).toMatchObject({previous_run_id:first.run_id,business_run_id:old.run_id,verification_task_id:historyTask.result.workflow_control.verify_task_id});
 expect(next.method_selection.original_goal_definition.snapshot_sha256).toBe(first.definition.snapshot_sha256);
 expect(next.deadline_at).toBe(first.deadline_at);expect(next.input).toEqual(first.input);expect(next.attempt).toBe(2);expect(next.run_id).not.toBe(first.run_id);expect(deps.sshDispatch.mock.calls.length-before).toBe(1);
 expect((await f.db.query('SELECT workflow_definition_version_id FROM run_definition_bindings WHERE run_id=$1',[next.run_id])).rows[0].workflow_definition_version_id).toBe(next.definition.workflow_definition_version_id);
 expect((await f.db.query('SELECT status FROM task_runs WHERE run_id=$1',[first.run_id])).rows[0].status).toBe('success');
});
it.each(['method','supervisor'])('prepare后%s当前观测漂移，launch零业务SSH/锁/租约',async which=>{
 const x=await historyAndFailure();await prepareCommander(f.db,id,deps);const next=await envelope();expect(next.method_selection).toBeDefined();const r=which==='method'?x.method.release:x.current.release;
 await recordReleaseObservation(f.db,r.id,{...f.observationInput,event_key:randomUUID(),environment:r.environment,target:r.target,components:[],observed_at:new Date(Date.now()+1000).toISOString()},{trustedCollector:'fixture-collector'});
 deps.sshDispatch.mockClear();deps.lockGate.mockClear();deps.setLease.mockClear();await expect(launchCommander(f.db,id,deps)).rejects.toThrow('部署');
 expect(deps.sshDispatch).not.toHaveBeenCalled();expect(deps.lockGate).not.toHaveBeenCalled();expect(deps.setLease).not.toHaveBeenCalled();
});
it('仅历史CI/span通过但独立官方核验丢失，不冒称回退；安全条件仍允许明确同版本重试',async()=>{
 const x=await historyAndFailure();await f.db.query("UPDATE tasks SET result=result #- '{receipt,verification_runtime}' WHERE id=$1",[x.historyTask.result.workflow_control.verify_task_id]);
 await dispatchCommanderV2(f.db,id,deps);const next=await envelope();expect(next.definition.workflow_definition_version_id).toBe(x.first.definition.workflow_definition_version_id);expect(next.method_selection).toBeUndefined();
 expect((await state()).result.workflow_control).toMatchObject({recovery_mode:'same_verified_implementation_retry'});expect((await state()).result.workflow_control.method_selection_gaps.some(g=>g.reason.includes('官方PASS'))).toBe(true);
});
it('选中历史方法后仍须完整span与原目标/所选方法双核验；旧失败运行不可改写',async()=>{
 const {first}=await historyAndFailure();const before=(await f.db.query('SELECT result FROM task_runs WHERE run_id=$1',[first.run_id])).rows[0].result;
 await dispatchCommanderV2(f.db,id,deps);const next=await envelope();await completePath(next);await stopWithDelivery(next);await verify('PASS');
 let task=await state();expect(task.status).toBe('in_progress');expect(task.result.workflow_control.verification.verdict).toBe('INCONCLUSIVE');
 const c=task.result.workflow_control,vt=(await f.db.query('SELECT * FROM tasks WHERE id=$1',[c.verify_task_id])).rows[0];
 const v=vt.result.workflow_verification;v.assertions.push({name:'original_goal',pass:true,definition_sha256:next.method_selection.original_goal_definition.snapshot_sha256,evidence:['independent:goal']},{name:'selected_method',pass:true,definition_sha256:next.definition.snapshot_sha256,evidence:['independent:method']});
 await f.db.query("UPDATE tasks SET result=jsonb_set(result,'{workflow_verification}',$2) WHERE id=$1",[vt.id,v]);await reconcileCommanderTask(f.db,id,deps);
 task=await state();expect(task.status).toBe('completed');expect(task.result.workflow_control.verdict).toBe('PASS');
 expect((await f.db.query('SELECT result FROM task_runs WHERE run_id=$1',[first.run_id])).rows[0].result).toEqual(before);
});
it('即使状态已标recovering，未知副作用仍在新运行及业务副作用前拒绝',async()=>{
 await historyAndFailure();await f.db.query("UPDATE tasks SET result=jsonb_set(result,'{workflow_control,delivery,effects}',$2) WHERE id=$1",[id,JSON.stringify([{key:'publish',status:'unknown'}])]);
 const count=(await f.db.query('SELECT count(*) FROM task_runs WHERE task_id=$1',[id])).rows[0].count;deps.sshDispatch.mockClear();deps.setLease.mockClear();
 await expect(dispatchCommanderV2(f.db,id,deps)).rejects.toThrow('安全条件');
 expect((await f.db.query('SELECT count(*) FROM task_runs WHERE task_id=$1',[id])).rows[0].count).toBe(count);expect(deps.sshDispatch).not.toHaveBeenCalled();expect(deps.setLease).not.toHaveBeenCalled();
});

it('准备后历史官方核验证明被撤销，launch拒绝且零业务副作用',async()=>{
 const x=await historyAndFailure();await prepareCommander(f.db,id,deps);expect((await envelope()).method_selection).toBeDefined();
 await f.db.query("UPDATE tasks SET result=result #- '{receipt,verification_runtime}' WHERE id=$1",[x.historyTask.result.workflow_control.verify_task_id]);
 deps.sshDispatch.mockClear();deps.setLease.mockClear();await expect(launchCommander(f.db,id,deps)).rejects.toThrow('历史');
 expect(deps.sshDispatch).not.toHaveBeenCalled();expect(deps.setLease).not.toHaveBeenCalled();
});

it('真实聚合release内当前report业务不同字节不属于meta安全闭包，历史方法可选',async()=>{
 const x=await historyAndFailure(true);assertAggregate(x.current.release);await dispatchCommanderV2(f.db,id,deps);const next=await envelope();
 expect(next.definition.workflow_definition_version_id).toBe(x.historical.release.payload.workflows[0].id);expect(next.method_selection).toBeDefined();
 expect(next.method_selection.method_instance.resolved_bindings[0].digest).not.toBe(x.current.release.payload.components.find(c=>c.path===next.method_selection.method_instance.resolved_bindings[0].path).digest);
});

it('历史业务方法包含旧监督安全依赖时仍拒绝，不因业务可回退放宽安全底座',async()=>{
 const x=await historyAndFailure(true,true);assertAggregate(x.current.release);await dispatchCommanderV2(f.db,id,deps);const next=await envelope();
 expect(next.definition.workflow_definition_version_id).toBe(x.first.definition.workflow_definition_version_id);expect(next.method_selection).toBeUndefined();
 expect((await state()).result.workflow_control.method_selection_gaps.some(g=>g.reason.includes('安全底座'))).toBe(true);
});

function assertAggregate(release){
 const workflows=release.payload.workflows;expect(workflows).toHaveLength(7);expect(new Set(workflows.map(w=>w.payload.contract.key)).size).toBe(7);
 const meta=workflows.filter(w=>w.payload.contract.key==='workflow_commander.internal');expect(meta).toHaveLength(1);
 expect(methodManifest(release,meta[0].id).bindings.map(b=>b.path)).toEqual(['src/supervisor.py']);
 expect(release.payload.components.some(c=>c.path==='src/controller.js')).toBe(true);
}

it('历史官方PASS仍不支持业务skill未声明执行依赖，Brain明确筛除而非交运行端碰运气',async()=>{
 await historyAndFailure(false,false,true);await dispatchCommanderV2(f.db,id,deps);
 const next=await envelope();expect(next.method_selection).toBeUndefined();
 expect((await state()).result.workflow_control.method_selection_gaps.some(g=>g.reason.includes('unsupported_method_skill'))).toBe(true);
});
