import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { releaseEvidenceDatabase } from '../../../__tests__/fixtures/release-evidence-db.js';
import { withLegacyNames } from '../../../__tests__/fixtures/minimum-definition-schema.js';
import { createRelease, recordReleaseObservation } from '../../release-index.js';
import { dispatchCommanderV2, prepareCommander } from '../../commander-v2-dispatch.js';
import { receiveCommanderEvent } from '../../commander-v2-feedback.js';
import { reconcileCommanderTask } from '../../commander-v2-control.js';
import { finalizeTask } from '../../task-terminal.js';
import { dispatchWorkflowCommanderTasks } from '../../workflow-commander-dispatch.js';
let f, id, definition, contract, deps;
const input = { text: '中文\n换行 $(touch /tmp/no-command) `false` ; "引号"', empty: [] };
beforeEach(async () => {
 f = await releaseEvidenceDatabase(); id = randomUUID();
 await f.db.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS result jsonb,ADD COLUMN IF NOT EXISTS task_type text,ADD COLUMN IF NOT EXISTS claimed_by text,ADD COLUMN IF NOT EXISTS claimed_at timestamptz,ADD COLUMN IF NOT EXISTS executor_kind text,ADD COLUMN IF NOT EXISTS error_message text`);
 await f.db.query(readFileSync(new URL('../../../../migrations/268_task_events.sql',import.meta.url),'utf8'));
 await f.db.query('DROP TABLE spans CASCADE');
 for(const file of ['495_vs_model_spans.sql','514_span_occurrences.sql','516_span_definition_provenance.sql'])await withLegacyNames(f.db,()=>f.db.query(readFileSync(new URL(`../../../../migrations/${file}`,import.meta.url),'utf8')));
 const release=(await createRelease(f.db,f.releaseInput)).release;
 const observation=(await recordReleaseObservation(f.db,release.id,f.observationInput,{trustedCollector:'fixture-collector'})).observation;
 definition=f.runInput(release,observation);delete definition.source_kind;delete definition.external_origin;
 contract={ key:'report', input_schema:{type:'object',required:['text','empty'],properties:{text:{type:'string'},empty:{type:'array'}}}, resources:{},recovery:{max_attempts:2,total_timeout_sec:2400,cleanup_timeout_sec:300,retry_safe:true,retry_on:['verification_failed','execution_failed']} };
 await f.db.query("INSERT INTO tasks(id,title,status,task_type,payload) VALUES($1,'通用报告','queued','workflow_dispatch',$2)",[id,{commander_protocol:'commander-v2',workflow_key:'report',workflow_input:input,workflow_definition:definition}]);
 deps={ afterTerminal:vi.fn(), frozenContract:async()=>({definition,contract}),ready:vi.fn(async e=>({protocol:'commander-v2',ready:true,...e.definition})),sshDispatch:vi.fn(async()=> 'DISPATCHED'),lockGate:vi.fn(async()=>({pass:true})),setLease:vi.fn(),releaseLease:vi.fn(),releaseLock:vi.fn(),createVerify:vi.fn(async(db,spec)=>{
   const child=randomUUID();await db.query("INSERT INTO tasks(id,title,status,task_type,payload) VALUES($1,$2,'queued','research',$3)",[child,spec.title,spec.metadata]);return {task:{id:child}};
 }) };
});
afterEach(async()=>{await f?.close();f=null;});
async function state(){return (await f.db.query('SELECT * FROM tasks WHERE id=$1',[id])).rows[0];}
async function envelope(){return (await state()).result.workflow_control.envelope;}
async function sendEvent(seq,type,data,e){e??=await envelope();return receiveCommanderEvent(f.db,id,{protocol:e.protocol,run_id:e.run_id,attempt:e.attempt,owner_epoch:e.owner_epoch,seq,type,data});}
function delivery(e,over={}) { return {...e,status:'completed',outputs:[{path:'/tmp/report.json'}],evidence:['source:actual'],cleanup:{completed:true,evidence:['resource:free']},effects:[],...over}; }
async function stopWithDelivery(e,over={}){
 await sendEvent(1,'delivery',delivery(e,over),e);
 await reconcileCommanderTask(f.db,id,{...deps,status:async()=>({protocol:e.protocol,run_id:e.run_id,execution_stopped:true,events:[]})});
}
it('正式派发先落task_runs/绑定/完整输入，非手机零锁，中文恶意字符仅stdin往返',async()=>{
 deps.sshDispatch.mockImplementation(async(args,data)=>{
  const e=JSON.parse(data);expect(e.input).toEqual(input);expect(args.join(' ')).not.toContain(input.text);
  expect((await f.db.query('SELECT * FROM task_runs WHERE run_id=$1',[e.run_id])).rows).toHaveLength(1);
  expect((await f.db.query('SELECT * FROM run_definition_bindings WHERE run_id=$1',[e.run_id])).rows).toHaveLength(1);
  return 'DISPATCHED';
 });
 await dispatchWorkflowCommanderTasks(f.db,deps);
 expect(deps.sshDispatch).toHaveBeenCalledTimes(1);expect(deps.lockGate).not.toHaveBeenCalled();
 expect((await envelope()).input).toEqual(input);
});
it('绑定失败零业务SSH/锁/租约且整笔事务回滚',async()=>{
 definition.observation_id=randomUUID();
 await expect(dispatchCommanderV2(f.db,id,deps)).rejects.toThrow();
 expect(deps.sshDispatch).not.toHaveBeenCalled();expect(deps.lockGate).not.toHaveBeenCalled();expect(deps.setLease).not.toHaveBeenCalled();
 expect((await f.db.query('SELECT * FROM task_runs WHERE task_id=$1',[id])).rows).toHaveLength(0);
 expect((await state()).status).toBe('queued');
});
it('并发重复派发只有一个真实run和一次业务启动',async()=>{
 await Promise.all([dispatchCommanderV2(f.db,id,deps),dispatchCommanderV2(f.db,id,deps)]);
 expect(deps.sshDispatch).toHaveBeenCalledTimes(1);
 expect((await f.db.query('SELECT * FROM task_runs WHERE task_id=$1',[id])).rows).toHaveLength(1);
});
it('同seq同内容幂等、异内容/旧owner/乱序零新事实',async()=>{
 await prepareCommander(f.db,id,deps);const e=await envelope();
 await sendEvent(1,'started',{session:'child-1'},e);expect(await sendEvent(1,'started',{session:'child-1'},e)).toMatchObject({duplicate:true});
 await expect(sendEvent(1,'started',{session:'other'},e)).rejects.toThrow('内容冲突');
 await expect(sendEvent(2,'heartbeat',{}, {...e,owner_epoch:0})).rejects.toThrow('过期反馈');
 await expect(sendEvent(3,'heartbeat',{},e)).rejects.toThrow('乱序');
 expect((await f.db.query("SELECT * FROM task_events WHERE event_type='commander_feedback' AND task_id=$1",[id])).rows).toHaveLength(1);
});
it('活动写真实span且绑定冻结路径，反馈摘要重复不重复span',async()=>{
 await prepareCommander(f.db,id,deps);const e=await envelope();const path=e.definition.expected_path[0];
 const data={reference_id:path.reference_id,started_at:'2026-10-13T00:00:00Z',ended_at:'2026-10-13T00:01:00Z',outcome:'pass',evidence:{ref:'actual'}};
 await sendEvent(1,'activity_completed',data,e);await sendEvent(1,'activity_completed',data,e);
 const spans=(await f.db.query('SELECT * FROM spans WHERE run_id=$1',[e.run_id])).rows;
 expect(spans).toHaveLength(1);expect(spans[0].workflow_definition_version_id).toBe(e.definition.workflow_definition_version_id);
});
it('投递完成但未确认停止不能释放租约、建核验或完成任务',async()=>{
 await dispatchCommanderV2(f.db,id,deps);const e=await envelope();await sendEvent(1,'delivery',delivery(e),e);
 await reconcileCommanderTask(f.db,id,{...deps,status:async()=>({protocol:e.protocol,run_id:e.run_id,execution_stopped:false,events:[]})});
 expect(deps.releaseLease).not.toHaveBeenCalled();expect(deps.createVerify).not.toHaveBeenCalled();
 expect((await finalizeTask(f.db,id,'completed',{relay:false})).rowCount).toBe(0);
 expect((await state()).status).toBe('in_progress');
});
it('child仍活/活性未知均不重发，跨重入deadline不变',async()=>{
 await dispatchCommanderV2(f.db,id,deps);const e=await envelope();
 await reconcileCommanderTask(f.db,id,{...deps,status:async()=>({protocol:e.protocol,run_id:e.run_id,execution_stopped:false,state:'running'})});
 await reconcileCommanderTask(f.db,id,{...deps,status:async()=>{throw Error('offline');}});
 expect(deps.sshDispatch).toHaveBeenCalledTimes(1);expect((await envelope()).deadline_at).toBe(e.deadline_at);
});
it('终态回执丢失时status events幂等补账，核验只建一次',async()=>{
 await dispatchCommanderV2(f.db,id,deps);const e=await envelope();
 const feedback={protocol:e.protocol,run_id:e.run_id,attempt:e.attempt,owner_epoch:e.owner_epoch,seq:1,type:'delivery',data:delivery(e)};
 const status=async()=>({protocol:e.protocol,run_id:e.run_id,execution_stopped:true,events:[feedback]});
 await reconcileCommanderTask(f.db,id,{...deps,status});await reconcileCommanderTask(f.db,id,{...deps,status});
 expect(deps.createVerify).toHaveBeenCalledTimes(1);expect(deps.releaseLease).toHaveBeenCalledTimes(1);
 const run=(await f.db.query('SELECT * FROM task_runs WHERE run_id=$1',[e.run_id])).rows[0];expect(run.status).toBe('success');
 expect((await state()).result.workflow_control.phase).toBe('awaiting_verify');
});
async function verify(verdict){
 const c=(await state()).result.workflow_control,e=c.envelope;
 await f.db.query("UPDATE tasks SET status='completed',result=$2 WHERE id=$1",[c.verify_task_id,{workflow_verification:{task_id:id,run_id:e.run_id,attempt:e.attempt,definition_sha256:e.definition.snapshot_sha256,verdict,assertions:[{name:'cleanup',pass:true},{name:'effects_safe_to_retry',pass:true},{name:'output',pass:verdict==='PASS'}],evidence:['independent:readback']}}]);
 await reconcileCommanderTask(f.db,id,deps);
}
it('独立核验PASS与真实cleanup成立才完成原任务',async()=>{
 await dispatchCommanderV2(f.db,id,deps);await stopWithDelivery(await envelope());await verify('PASS');
 expect((await state()).status).toBe('completed');expect((await state()).result.workflow_control.verdict).toBe('PASS');
});
it('核验FAIL回原task并自动用已验证实现接续，保留历史run及总deadline',async()=>{
 await dispatchCommanderV2(f.db,id,deps);const first=await envelope();await stopWithDelivery(first);await verify('FAIL');
 expect((await state()).result.workflow_control.phase).toBe('recovering');
 await reconcileCommanderTask(f.db,id,deps);const second=await envelope();
 expect(second.task_id).toBe(id);expect(second.attempt).toBe(2);expect(second.run_id).not.toBe(first.run_id);expect(second.deadline_at).toBe(first.deadline_at);
 expect((await f.db.query('SELECT * FROM task_runs WHERE task_id=$1',[id])).rows).toHaveLength(2);
 expect(deps.sshDispatch).toHaveBeenCalledTimes(2);
 await expect(sendEvent(2,'heartbeat',{},first)).rejects.toThrow('过期反馈');
});
it('已提交/未知副作用的失败保留持久读回条件，禁止再次发布',async()=>{
 await dispatchCommanderV2(f.db,id,deps);await stopWithDelivery(await envelope(),{effects:[{key:`${id}:publish`,status:'unknown',receipt:null}]});await verify('FAIL');
 const c=(await state()).result.workflow_control;expect(c.phase).toBe('blocked');expect(c.resume_condition).toBe('independent_effect_readback_or_compensation');expect(deps.sshDispatch).toHaveBeenCalledTimes(1);
});
it('运行端部署漂移拒绝新执行，既有固定输入不被最新版替换',async()=>{
 deps.ready.mockResolvedValue({protocol:'commander-v2',ready:true,release_id:definition.release_id,snapshot_sha256:'0'.repeat(64),runtime_snapshot_sha256:definition.runtime_snapshot_sha256});
 await expect(prepareCommander(f.db,id,deps)).rejects.toThrow('部署漂移');expect(deps.sshDispatch).not.toHaveBeenCalled();
 expect((await f.db.query('SELECT * FROM task_runs WHERE task_id=$1',[id])).rows).toHaveLength(0);
});
it('一次FAIL只记同版本错误指纹，不建coding；阈值到达只产改进建议',async()=>{
 contract.recovery.improvement_after_failures=1;
 await dispatchCommanderV2(f.db,id,deps);await stopWithDelivery(await envelope());await verify('FAIL');
 const c=(await state()).result.workflow_control;
 expect(c.failure.error_fingerprint).toMatch(/^[0-9a-f]{64}$/);expect(c.failure.occurrences).toBe(1);
 expect(c.failure.improvement_suggestion.kind).toBe('decision');expect(c.recovery_mode).toBe('same_verified_implementation_retry');
 expect((await f.db.query("SELECT * FROM tasks WHERE task_type IN ('dev','coding_workflow')")).rows).toHaveLength(0);
 expect((await f.db.query("SELECT * FROM task_events WHERE event_type='commander_failure' AND task_id=$1",[id])).rows).toHaveLength(1);
});
it('unknown副作用补独立逐项读回后同task恢复，原delivery及run历史不改写',async()=>{
 await dispatchCommanderV2(f.db,id,deps);const e=await envelope(),key=`${id}:publish`;
 await stopWithDelivery(e,{effects:[{key,status:'unknown',receipt:null}]});await verify('FAIL');
 const blocked=(await state()).result.workflow_control;
 await reconcileCommanderTask(f.db,id,deps);expect(deps.createVerify).toHaveBeenCalledTimes(1);expect(deps.releaseLease).toHaveBeenCalledTimes(1);
 const v={...blocked.verification,assertions:[...blocked.verification.assertions,{name:`effect:${key}`,pass:true,status:'none',evidence:['independent:account-readback']} ]};
 await f.db.query('UPDATE tasks SET result=$2 WHERE id=$1',[blocked.verify_task_id,{workflow_verification:v}]);
 await reconcileCommanderTask(f.db,id,deps);expect((await state()).result.workflow_control.phase).toBe('recovering');
 await reconcileCommanderTask(f.db,id,deps);expect((await envelope()).attempt).toBe(2);
 const original=(await f.db.query('SELECT result FROM task_runs WHERE run_id=$1',[e.run_id])).rows[0].result;
 expect(original.delivery.effects[0].status).toBe('unknown');expect(deps.sshDispatch).toHaveBeenCalledTimes(2);
});
