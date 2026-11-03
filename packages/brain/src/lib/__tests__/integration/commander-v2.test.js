import { EventEmitter } from 'node:events';
import { triggerOpenclawAgent, reapOpenclawAgentRuns } from '../../../openclaw-agent-executor.js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { releaseEvidenceDatabase } from '../../../__tests__/fixtures/release-evidence-db.js';
import { withLegacyNames } from '../../../__tests__/fixtures/minimum-definition-schema.js';
import { createRelease, recordReleaseObservation, getRelease } from '../../release-index.js';
import { dispatchCommanderV2 } from '../../commander-v2-dispatch.js';
import { receiveCommanderEvent } from '../../commander-v2-feedback.js';
import { reconcileCommanderTask } from '../../commander-v2-control.js';
import { digest, makeEnvelope } from '../../commander-v2-contract.js';
import { activityBindings, writeControl } from '../../commander-v2-store.js';
import { startRun } from '../../task-run.js';
import { runtimeRootFromRelease } from '../../commander-runtime-location.js';
import { finalizeTask } from '../../task-terminal.js';

let f, id, definition, contract, deps;
const input = { text: '中文\n换行 $(touch /tmp/no-command) `false` ; "引号"', empty: [] };
beforeEach(async context => {
 f = await releaseEvidenceDatabase(context.task.name.includes('冻结shell') ? {activityExecutor:'shell'} : {}); id = randomUUID();
 await f.db.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS kind text,ADD COLUMN IF NOT EXISTS parent_task_id uuid,ADD COLUMN IF NOT EXISTS project_id uuid,ADD COLUMN IF NOT EXISTS summary text,ADD COLUMN IF NOT EXISTS priority text,ADD COLUMN IF NOT EXISTS due_at timestamptz,ADD COLUMN IF NOT EXISTS description text,ADD COLUMN IF NOT EXISTS result jsonb,ADD COLUMN IF NOT EXISTS task_type text,ADD COLUMN IF NOT EXISTS claimed_by text,ADD COLUMN IF NOT EXISTS claimed_at timestamptz,ADD COLUMN IF NOT EXISTS executor_kind text,ADD COLUMN IF NOT EXISTS error_message text`);
 await f.db.query(readFileSync(new URL('../../../../migrations/268_task_events.sql',import.meta.url),'utf8'));
 await f.db.query(readFileSync(new URL('../../../../migrations/553_task_leases_device_pools.sql',import.meta.url),'utf8').split('CREATE TABLE IF NOT EXISTS device_pools')[0]);
 await f.db.query('CREATE TABLE IF NOT EXISTS device_locks(locked_by text,expires_at timestamptz)');
 await f.db.query('DROP TABLE spans CASCADE');
 for(const file of ['495_vs_model_spans.sql','514_span_occurrences.sql','516_span_definition_provenance.sql'])await withLegacyNames(f.db,()=>f.db.query(readFileSync(new URL(`../../../../migrations/${file}`,import.meta.url),'utf8')));
 f.releaseInput.environment='production';f.observationInput.environment='production';
 const release=(await createRelease(f.db,f.releaseInput)).release;
 const observation=(await recordReleaseObservation(f.db,release.id,f.observationInput,{trustedCollector:'fixture-collector'})).observation;
 definition=f.runInput(release,observation);delete definition.source_kind;delete definition.external_origin;
 contract={ key:'report', input_schema:{type:'object',required:['text','empty'],properties:{text:{type:'string'},empty:{type:'array'}}}, resources:{},recovery:{max_attempts:2,total_timeout_sec:2400,cleanup_timeout_sec:300,retry_safe:true,retry_on:['verification_failed','execution_failed']} };
 await f.db.query("INSERT INTO tasks(id,title,status,task_type,kind,payload) VALUES($1,'通用报告','queued','workflow_dispatch','workflow',$2)",[id,{commander_protocol:'commander-v2',workflow_key:'report',workflow_input:input,workflow_definition:definition}]);
 deps={ afterTerminal:vi.fn(), frozenContract:async()=>({definition,contract}),ready:vi.fn(async e=>({protocol:'commander-v2',ready:true,...e.definition})),sshDispatch:vi.fn(async()=> 'DISPATCHED'),lockGate:vi.fn(async()=>({pass:true})),setLease:vi.fn(),releaseLease:vi.fn(),releaseLock:vi.fn(),createVerify:vi.fn(async(db,spec)=>{
   const child=randomUUID();await db.query("INSERT INTO tasks(id,title,status,task_type,payload,description) VALUES($1,$2,'queued','research',$3,$4)",[child,spec.title,spec.metadata,spec.description]);return {task:{id:child}};
 }) };
});
afterEach(async()=>{await f?.close();f=null;});
// 重建退役前已存在的持久事实；不调用已退役的prepare/launch或任何运输。
// 反馈和收尾仍由workflow-commander-dispatch → reconcileCommanderV2消费这些记录。
async function historicalInFlight(){
 const task=await state(),release=await getRelease(f.db,definition.release_id);
 const e=makeEnvelope(task,definition,contract,undefined,new Date());
 e.activity_bindings=activityBindings(definition,release);
 const runtime_root=runtimeRootFromRelease(release);
 e.execution_location={ssh_target:'fixture-worker',run_directory:`~/wf-agent-runs/${e.run_id}`,runtime_root};
 await startRun({taskId:id,runId:e.run_id,source:'workflow-commander-v2',definition:e.definition,
  context:{commander_envelope:e}},{pool:f.db});
 const control={phase:'running',envelope:e,execution_location:{...e.execution_location},last_seq:0,
  execution_stopped:false,launch_state:'sent',history:[]};
 await writeControl(f.db,id,control);
 await f.db.query("UPDATE tasks SET status='in_progress',claimed_by='workflow-commander-v2',claimed_at=NOW(),executor_kind='openclaw-agent',payload=payload||jsonb_build_object('run_id',$2::text) WHERE id=$1",[id,e.run_id]);
 return control;
}
async function state(){return (await f.db.query('SELECT * FROM tasks WHERE id=$1',[id])).rows[0];}
async function envelope(){return (await state()).result.workflow_control.envelope;}
async function sendEvent(seq,type,data,e){e??=await envelope();return receiveCommanderEvent(f.db,id,{protocol:e.protocol,run_id:e.run_id,attempt:e.attempt,owner_epoch:e.owner_epoch,seq,type,data});}
function delivery(e,over={}) { return {...e,status:'completed',outputs:[{path:'/tmp/report.json'}],evidence:['source:actual'],cleanup:{completed:true,evidence:['resource:free']},effects:[],...over}; }
async function stopWithDelivery(e,over={}){
 const seq=((await state()).result.workflow_control.last_seq??0)+1;
 await sendEvent(seq,'delivery',delivery(e,over),e);
 await reconcileCommanderTask(f.db,id,{...deps,status:async()=>({protocol:e.protocol,run_id:e.run_id,execution_stopped:true,events:[]})});
}
async function commonDeps(){
 const release=await getRelease(f.db,definition.release_id);
 const dispatch=vi.fn(async(action,runId,body)=>{
  expect(action).toBe('start');expect(body.input.publication_input).toEqual(input);
  expect((await f.db.query('SELECT * FROM task_runs WHERE run_id=$1',[runId])).rows).toHaveLength(1);
  expect((await f.db.query('SELECT * FROM run_definition_bindings WHERE run_id=$1',[runId])).rows).toHaveLength(1);
  return {authenticated:true};
 });
 return {dispatch,workflowCommon:{routes:{report:{machine_id:'fixture-worker',profile:'report-fixed',profile_sha256:'a'.repeat(64),definition,
  resources:contract.resources,components_sha256:digest(release.payload.components)}},
  frozenContract:async()=>({definition,contract,release}),dispatcher:{dispatch},setLease:deps.setLease,lockGate:deps.lockGate}};
}
it('现役公共派发先持久run和来源绑定，中文完整输入经结构化运输，非手机零锁',async()=>{
 const common=await commonDeps();await dispatchCommanderV2(f.db,id,common);
 expect(common.dispatch).toHaveBeenCalledTimes(1);expect(deps.lockGate).not.toHaveBeenCalled();expect(deps.sshDispatch).not.toHaveBeenCalled();
 const task=await state();expect(task.claimed_by).toBe('common-runner');expect(task.result.workflow_control).toBeUndefined();
 expect(task.result.workflow_common_runner.input.publication_input).toEqual(input);
});
it('现役公共绑定失败整笔事务回滚，零运输、设备锁及租约',async()=>{
 const common=await commonDeps();definition.observation_id=randomUUID();
 await f.db.query("UPDATE tasks SET payload=jsonb_set(payload,'{workflow_definition}',$2::jsonb) WHERE id=$1",[id,JSON.stringify(definition)]);
 await expect(dispatchCommanderV2(f.db,id,common)).rejects.toThrow();
 expect(common.dispatch).not.toHaveBeenCalled();expect(deps.lockGate).not.toHaveBeenCalled();expect(deps.setLease).not.toHaveBeenCalled();
 expect((await f.db.query('SELECT * FROM task_runs WHERE task_id=$1',[id])).rows).toHaveLength(0);expect((await state()).status).toBe('queued');
});
it('现役公共并发派发只绑定一个真实run，运输重放保持同一身份',async()=>{
 const common=await commonDeps();await Promise.all([dispatchCommanderV2(f.db,id,common),dispatchCommanderV2(f.db,id,common)]);
 const runs=(await f.db.query('SELECT * FROM task_runs WHERE task_id=$1',[id])).rows;expect(runs).toHaveLength(1);
 expect(common.dispatch.mock.calls.map(call=>call[1])).toEqual([runs[0].run_id,runs[0].run_id]);
});
it('同seq同内容幂等、异内容/旧owner/乱序零新事实',async()=>{
 await historicalInFlight();const e=await envelope();
 await sendEvent(1,'started',{session:'child-1'},e);expect(await sendEvent(1,'started',{session:'child-1'},e)).toMatchObject({duplicate:true});
 await expect(sendEvent(1,'started',{session:'other'},e)).rejects.toThrow('内容冲突');
 await expect(sendEvent(2,'heartbeat',{}, {...e,owner_epoch:0})).rejects.toThrow('过期反馈');
 await expect(sendEvent(3,'heartbeat',{},e)).rejects.toThrow('乱序');
 expect((await f.db.query("SELECT * FROM task_events WHERE event_type='commander_feedback' AND task_id=$1",[id])).rows).toHaveLength(1);
});
it('活动写真实span且绑定冻结路径，反馈摘要重复不重复span',async()=>{
 await historicalInFlight();const e=await envelope();const path=e.definition.expected_path[0];
 const data={reference_id:path.reference_id,started_at:'2026-10-13T00:00:00Z',ended_at:'2026-10-13T00:01:00Z',outcome:'pass',evidence:{ref:'actual'}};
 await sendEvent(1,'activity_completed',data,e);await sendEvent(1,'activity_completed',data,e);
 const spans=(await f.db.query('SELECT * FROM spans WHERE run_id=$1',[e.run_id])).rows;
 expect(spans).toHaveLength(1);expect(spans[0].workflow_definition_version_id).toBe(e.definition.workflow_definition_version_id);
});
it('投递完成但未确认停止不能释放租约、建核验或完成任务',async()=>{
 await historicalInFlight();const e=await envelope();await sendEvent(1,'delivery',delivery(e),e);
 await reconcileCommanderTask(f.db,id,{...deps,status:async()=>({protocol:e.protocol,run_id:e.run_id,execution_stopped:false,events:[]})});
 expect(deps.releaseLease).not.toHaveBeenCalled();expect(deps.createVerify).not.toHaveBeenCalled();
 expect((await finalizeTask(f.db,id,'completed',{relay:false})).rowCount).toBe(0);
 expect((await state()).status).toBe('in_progress');
});
it('child仍活/活性未知均不重发，跨重入deadline不变',async()=>{
 await historicalInFlight();const e=await envelope();
 await reconcileCommanderTask(f.db,id,{...deps,status:async()=>({protocol:e.protocol,run_id:e.run_id,execution_stopped:false,state:'running'})});
 await reconcileCommanderTask(f.db,id,{...deps,status:async()=>{throw Error('offline');}});
 expect(deps.sshDispatch).not.toHaveBeenCalled();expect((await envelope()).deadline_at).toBe(e.deadline_at);
});
it('终态回执丢失时status events幂等补账，核验只建一次',async()=>{
 await historicalInFlight();const e=await envelope();
 const feedback={protocol:e.protocol,run_id:e.run_id,attempt:e.attempt,owner_epoch:e.owner_epoch,seq:1,type:'delivery',data:delivery(e)};
 const status=async()=>({protocol:e.protocol,run_id:e.run_id,execution_stopped:true,events:[feedback]});
 await reconcileCommanderTask(f.db,id,{...deps,status});await reconcileCommanderTask(f.db,id,{...deps,status});
 expect(deps.createVerify).toHaveBeenCalledTimes(1);expect(deps.releaseLease).toHaveBeenCalledTimes(1);
 const run=(await f.db.query('SELECT * FROM task_runs WHERE run_id=$1',[e.run_id])).rows[0];expect(run.status).toBe('success');
 expect((await state()).result.workflow_control.phase).toBe('awaiting_verify');
});
async function verify(verdict){
 const c=(await state()).result.workflow_control,e=c.envelope;
 const child=(await f.db.query('SELECT * FROM tasks WHERE id=$1',[c.verify_task_id])).rows[0];
 await f.db.query("UPDATE tasks SET status='completed',result=$2 WHERE id=$1",[c.verify_task_id,{receipt:{verification_runtime:{provider:'openai',model:'gpt-6.1-sol',logical_run_id:child.payload.run_id,official_run_id:'fixture',rerouted:false}},workflow_verification:{task_id:id,run_id:e.run_id,attempt:e.attempt,definition_sha256:e.definition.snapshot_sha256,verdict,assertions:[{name:'cleanup',pass:true},{name:'effects_safe_to_retry',pass:true},{name:'output',pass:verdict==='PASS'}],evidence:['independent:readback']}}]);
 await reconcileCommanderTask(f.db,id,deps);
}
it('独立核验PASS与真实cleanup成立才完成原任务',async()=>{
 await historicalInFlight();await completePath(await envelope());await stopWithDelivery(await envelope());await verify('PASS');
 expect((await state()).status).toBe('completed');expect((await state()).result.workflow_control.verdict).toBe('PASS');
});
it('历史FAIL保留原task/run及预算，退役控制器不能启动第二尝试',async()=>{
 await historicalInFlight();const first=await envelope();await stopWithDelivery(first);await verify('FAIL');
 expect((await state()).result.workflow_control.phase).toBe('recovering');
 expect(await reconcileCommanderTask(f.db,id,deps)).toMatchObject({waiting:true,reason:'legacy_execution_read_only',run_id:first.run_id});
 expect(await envelope()).toEqual(first);
 expect((await f.db.query('SELECT * FROM task_runs WHERE task_id=$1',[id])).rows).toHaveLength(1);
 expect(deps.sshDispatch).not.toHaveBeenCalled();
});
it('已提交/未知副作用的失败保留持久读回条件，禁止再次发布',async()=>{
 await historicalInFlight();await stopWithDelivery(await envelope(),{effects:[{key:`${id}:publish`,status:'unknown',receipt:null}]});await verify('FAIL');
 const c=(await state()).result.workflow_control;expect(c.phase).toBe('blocked');expect(c.resume_condition).toBe('independent_effect_readback_or_compensation');expect(deps.sshDispatch).not.toHaveBeenCalled();
});
it('现役公共source漂移拒绝新执行，零run、运输和租约',async()=>{
 const common=await commonDeps();common.workflowCommon.routes.report.definition={...definition,snapshot_sha256:'0'.repeat(64)};
 await expect(dispatchCommanderV2(f.db,id,common)).rejects.toThrow('workflow_common_source_mismatch');
 expect(common.dispatch).not.toHaveBeenCalled();expect(deps.setLease).not.toHaveBeenCalled();
 expect((await f.db.query('SELECT * FROM task_runs WHERE task_id=$1',[id])).rows).toHaveLength(0);
});
it('一次FAIL只记同版本错误指纹，不建coding；阈值到达只产改进建议',async()=>{
 contract.recovery.improvement_after_failures=1;
 await historicalInFlight();await stopWithDelivery(await envelope());await verify('FAIL');
 const c=(await state()).result.workflow_control;
 expect(c.failure.error_fingerprint).toMatch(/^[0-9a-f]{64}$/);expect(c.failure.occurrences).toBe(1);
 expect(c.failure.improvement_suggestion.kind).toBe('decision');expect(c.recovery_mode).toBe('same_verified_implementation_retry');
 expect((await f.db.query("SELECT * FROM tasks WHERE task_type IN ('dev','coding_workflow')")).rows).toHaveLength(0);
 expect((await f.db.query("SELECT * FROM task_events WHERE event_type='commander_failure' AND task_id=$1",[id])).rows).toHaveLength(1);
});
it('unknown副作用补独立逐项读回后保留恢复条件，退役run历史不改写或重启',async()=>{
 await historicalInFlight();const e=await envelope(),key=`${id}:publish`;
 await stopWithDelivery(e,{effects:[{key,status:'unknown',receipt:null}]});await verify('FAIL');
 const blocked=(await state()).result.workflow_control;
 await reconcileCommanderTask(f.db,id,deps);expect(deps.createVerify).toHaveBeenCalledTimes(1);expect(deps.releaseLease).toHaveBeenCalledTimes(1);
 const v={...blocked.verification,assertions:[...blocked.verification.assertions,{name:`effect:${key}`,pass:true,status:'none',evidence:['independent:account-readback']} ]};
 await f.db.query('UPDATE tasks SET result=result||$2::jsonb WHERE id=$1',[blocked.verify_task_id,{workflow_verification:v}]);
 await reconcileCommanderTask(f.db,id,deps);expect((await state()).result.workflow_control.phase).toBe('recovering');
 expect(await reconcileCommanderTask(f.db,id,deps)).toMatchObject({reason:'legacy_execution_read_only'});expect((await envelope()).attempt).toBe(1);
 const original=(await f.db.query('SELECT result FROM task_runs WHERE run_id=$1',[e.run_id])).rows[0].result;
 expect(original.delivery.effects[0].status).toBe('unknown');expect(deps.sshDispatch).not.toHaveBeenCalled();
});
it('输出schema不符拒绝成功声明但接受原序事件，不卡重放，独立核验处理真实失败',async()=>{
 contract.output_schema={type:'object',required:['json_path','csv_path','task_count','deployment_count','source_snapshot']};
 await historicalInFlight();const e=await envelope();
 const original=delivery(e,{outputs:{}});
 const accepted=await sendEvent(1,'delivery',original,e);
 expect(accepted).toMatchObject({accepted:true,success_claim_rejected:{code:'output_contract_invalid'}});
 expect((await state()).result.workflow_control.delivery).toMatchObject({status:'failed',outputs:{},failure:{code:'output_contract_invalid'}});
 expect(await sendEvent(1,'delivery',original,e)).toMatchObject({duplicate:true});
 const fact=(await f.db.query("SELECT payload FROM task_events WHERE task_id=$1 AND event_type='commander_feedback'",[id])).rows;
 expect(fact).toHaveLength(1);expect(fact[0].payload.data.status).toBe('completed');expect(fact[0].payload.data.outputs).toEqual({});
 expect(deps.createVerify).not.toHaveBeenCalled();expect(deps.releaseLease).not.toHaveBeenCalled();
 await reconcileCommanderTask(f.db,id,{...deps,status:async()=>({protocol:e.protocol,run_id:e.run_id,execution_stopped:true,events:[]})});
 expect((await state()).result.workflow_control.phase).toBe('awaiting_verify');expect((await state()).status).toBe('in_progress');
 expect(deps.createVerify).toHaveBeenCalledTimes(1);
 expect((await f.db.query('SELECT status FROM task_runs WHERE run_id=$1',[e.run_id])).rows[0].status).toBe('failed');
});
it('开始事件只留task_events，完成事件才形成可对账span',async()=>{
 await historicalInFlight();const e=await envelope(),path=e.definition.expected_path[0];
 const data={reference_id:path.reference_id,started_at:'2026-10-13T00:00:00Z'};
 await sendEvent(1,'activity_started',data,e);await sendEvent(2,'activity_completed',{...data,ended_at:'2026-10-13T00:01:00Z',outcome:'pass'},e);
 const spans=(await f.db.query('SELECT * FROM spans WHERE run_id=$1',[e.run_id])).rows;
 expect(spans).toHaveLength(1);expect(spans[0].ended_at).not.toBeNull();
});
it('核验声称PASS但冻结路径无span，原任务不能完成且保留缺口',async()=>{
 await historicalInFlight();await stopWithDelivery(await envelope());await verify('PASS');
 const t=await state();expect(t.status).toBe('in_progress');
 expect(t.result.workflow_control.reconciliation.gaps.some(g=>g.code==='EXPECTED_SPAN_MISSING')).toBe(true);
});
it('历史失败断言与证据持久保存，退役后输入及deadline不变且不新派发',async()=>{
 await historicalInFlight();const old=await envelope();await stopWithDelivery(old);await verify('FAIL');
 const before=(await state()).result.workflow_control;
 expect(before.verification).toMatchObject({verdict:'FAIL',evidence:['independent:readback']});
 expect(before.verification.assertions.some(a=>a.name==='output'&&a.pass===false)).toBe(true);
 expect(await reconcileCommanderTask(f.db,id,deps)).toMatchObject({reason:'legacy_execution_read_only'});
 expect((await state()).result.workflow_control).toEqual(before);expect(await envelope()).toEqual(old);
 expect(deps.sshDispatch).not.toHaveBeenCalled();
});
it('现役公共派发拒绝旧在途owner，不能创建第二run或取得新租约',async()=>{
 await historicalInFlight();const before=await state();deps.sshDispatch.mockClear();deps.setLease.mockClear();
 await expect(dispatchCommanderV2(f.db,id,deps)).rejects.toThrow('workflow_common_existing_execution_read_only');
 expect(await state()).toEqual(before);expect(deps.sshDispatch).not.toHaveBeenCalled();expect(deps.setLease).not.toHaveBeenCalled();
 expect((await f.db.query('SELECT * FROM task_runs WHERE task_id=$1',[id])).rows).toHaveLength(1);
});

async function completePath(e){
 let seq=(await state()).result.workflow_control.last_seq;
 for(const path of e.definition.expected_path)await sendEvent(++seq,'activity_completed',{reference_id:path.reference_id,step_id:path.step_id,started_at:'2026-10-13T00:00:00Z',ended_at:'2026-10-13T00:01:00Z',outcome:'pass',evidence:{ref:'actual:execution'}},e);
}
function officialVerification(v,over={}) {
 return JSON.stringify({runId:'official-run',status:'ok',result:{payloads:[{text:`WORKFLOW_VERIFICATION ${JSON.stringify(v)}`}],meta:{agentMeta:{provider:'openai',model:'gpt-6.1-sol',terminalReceipt:{runId:'official-run',requested:{provider:'openai',model:'gpt-6.1-sol'},effective:{provider:'openai',model:'gpt-6.1-sol'},rerouted:false,successfulToolNames:['gateway_exec']}},executionTrace:{winnerProvider:'openai',winnerModel:'gpt-6.1-sol',fallbackUsed:false,...over}}}});
}
it.each([false,true])('正式OpenClaw运输落独立run，真实模型回执收割后才允许独立PASS（fallback=%s）',async fallback=>{
 await historicalInFlight();const e=await envelope();await completePath(e);await stopWithDelivery(e);
 const c=(await state()).result.workflow_control;
 const child=(await f.db.query('SELECT * FROM tasks WHERE id=$1',[c.verify_task_id])).rows[0];
 const observedAtLaunch=[];
 const spawnFn=vi.fn(()=>{const proc=new EventEmitter();proc.stdout=new EventEmitter();proc.stderr=new EventEmitter();proc.stdin={end:vi.fn()};proc.kill=vi.fn();setImmediate(async()=>{observedAtLaunch.push((await f.db.query('SELECT EXISTS(SELECT 1 FROM task_runs WHERE task_id=$1) AS run_ready,EXISTS(SELECT 1 FROM task_leases WHERE task_id=$1) AS lease_ready',[child.id])).rows[0]);proc.stdout.emit('data',Buffer.from('DISPATCHED'));proc.emit('close',0);});return proc;});
 expect((await triggerOpenclawAgent(child,{pool:f.db,spawnFn})).success).toBe(true);
 expect(observedAtLaunch).toEqual([{run_ready:true,lease_ready:true}]);
 expect((await f.db.query('SELECT task_id FROM task_leases WHERE task_id=$1 AND released_at IS NULL',[child.id])).rows).toHaveLength(1);
 expect(spawnFn.mock.calls[0][1].at(-1)).toContain('--model openai/gpt-6.1-sol');
 expect(spawnFn.mock.calls[0][1].at(-1)).toContain(`agent:skill-factory:${child.payload.run_id}`);
 expect((await f.db.query('SELECT run_id FROM task_runs WHERE task_id=$1',[child.id])).rows).toEqual([{run_id:child.payload.run_id}]);
 expect(child.payload.run_id).not.toBe(e.run_id);
 const v={task_id:id,run_id:e.run_id,attempt:e.attempt,definition_sha256:e.definition.snapshot_sha256,verdict:'PASS',assertions:[{name:'cleanup',pass:true},{name:'output',pass:true}],evidence:['independent:readback']};
 const execFileFn=vi.fn((cmd,args,opts,cb)=>cb(null,`EXIT=0\n${officialVerification(v,{fallbackUsed:fallback})}`,''));
 const reaped=await reapOpenclawAgentRuns(f.db,{execFileFn});expect(reaped).toMatchObject(fallback?{failed:1,completed:0}:{failed:0,completed:1});
 await reconcileCommanderTask(f.db,id,deps);
 const parent=await state();expect(parent.status).toBe(fallback?'in_progress':'completed');
 const settled=(await f.db.query('SELECT * FROM tasks WHERE id=$1',[child.id])).rows[0];
 if(!fallback){expect(settled.result.workflow_verification).toEqual(v);expect(settled.result.receipt.verification_runtime).toMatchObject({provider:'openai',model:'gpt-6.1-sol',logical_run_id:child.payload.run_id});}
 else expect(settled.error_message).toContain('fallback');
});
it('正式信封活动映射只消费冻结release，当前活动key漂移不改变映射',async()=>{
 const workflow=f.workflows.find(w=>w.id===definition.workflow_definition_version_id);
 const ref=workflow.payload.activities[0];
 await f.db.query("UPDATE activities SET activity_key='mutable_wrong' WHERE id=$1",[ref.activity_id]);
 await historicalInFlight();const e=await envelope();
 const binding=e.activity_bindings.find(b=>b.reference_id===ref.reference_id);
 expect(binding.key).toBe(ref.slot_key);expect(binding.key).not.toBe('mutable_wrong');
 const activity=f.activities.find(a=>a.id===ref.activity_version_id);
 expect(binding.steps).toEqual(activity.payload.steps.map(s=>({key:s.locator.step_key,step_id:s.step_id})));
 const context=(await f.db.query('SELECT context FROM task_runs WHERE run_id=$1',[e.run_id])).rows[0].context;
 expect(context.commander_envelope.activity_bindings).toEqual(e.activity_bindings);
});
it('历史冻结路径不完整不能伪造在途执行证据，零运行零外部副作用',async()=>{
 definition.expected_path=definition.expected_path.slice(0,-1);
 await expect(historicalInFlight()).rejects.toThrow('路径');
 expect(deps.ready).not.toHaveBeenCalled();expect(deps.sshDispatch).not.toHaveBeenCalled();
 expect(deps.lockGate).not.toHaveBeenCalled();expect(deps.setLease).not.toHaveBeenCalled();
 expect((await f.db.query('SELECT * FROM task_runs WHERE task_id=$1',[id])).rows).toHaveLength(0);
 expect((await state()).status).toBe('queued');
});

it('冻结shell活动落code且无模型，事件自述agent/codex不能改执行者身份',async()=>{
 await historicalInFlight();const e=await envelope();const path=e.definition.expected_path[0];
 await sendEvent(1,'activity_completed',{reference_id:path.reference_id,started_at:'2026-10-13T00:00:00Z',ended_at:'2026-10-13T00:01:00Z',outcome:'pass',executor_kind:'agent',model:'codex',evidence:{source:'agent'}},e);
 const span=(await f.db.query('SELECT executor_kind,executor_id,model FROM spans WHERE run_id=$1',[e.run_id])).rows[0];
 expect(span).toEqual({executor_kind:'code',executor_id:'commander-shell',model:null});
});
it('agent活动不能凭事件自述shell伪装code事实',async()=>{
 await historicalInFlight();const e=await envelope();const path=e.definition.expected_path[0];
 await sendEvent(1,'activity_completed',{reference_id:path.reference_id,started_at:'2026-10-13T00:00:00Z',ended_at:'2026-10-13T00:01:00Z',outcome:'pass',executor_kind:'code',evidence:{source:'commander-shell'}},e);
 expect((await f.db.query('SELECT executor_kind FROM spans WHERE run_id=$1',[e.run_id])).rows[0].executor_kind).toBe('agent');
});

it.each(['run','lease'])('核验%s起跑账失败整笔回滚，零SSH且不伪造运行成功',async failure=>{
 await historicalInFlight();await stopWithDelivery(await envelope());
 const c=(await state()).result.workflow_control,child=(await f.db.query('SELECT * FROM tasks WHERE id=$1',[c.verify_task_id])).rows[0],spawnFn=vi.fn();
 const inject=failure==='run'?{startRun:async()=>null}:{setLease:async()=>{throw Error('lease unavailable');}};
 const result=await triggerOpenclawAgent(child,{pool:f.db,spawnFn,...inject});
 expect(result).toMatchObject({success:false,reason:'commander_verification_preflight_failed'});expect(spawnFn).not.toHaveBeenCalled();
 expect((await f.db.query('SELECT * FROM task_runs WHERE task_id=$1',[child.id])).rows).toHaveLength(0);
 expect((await f.db.query('SELECT * FROM task_leases WHERE task_id=$1',[child.id])).rows).toHaveLength(0);
});
