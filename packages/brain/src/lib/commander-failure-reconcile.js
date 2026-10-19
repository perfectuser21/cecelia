/** 专用失败收口。只消费服务端读回与真实独审任务，不接调用方状态布尔。 */
import { digest, requireCommander, bounded } from './commander-v2-contract.js';
import { transaction, writeControl, event } from './commander-v2-store.js';
import { validateFailureProof, failureIdentity } from './commander-failure-proof.js';
import { failureProbeSessions } from './commander-failure-reader.js';
import { finishRun } from './task-run.js';
import { finalizeTask } from './task-terminal.js';
import { releaseTaskLease } from './task-lease.js';
const check=(ok,why)=>requireCommander(ok,`failure_reconciliation: ${why}`,409);
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
const KEYS=['task_id','run_id','attempt','owner_epoch','input_sha256','definition_snapshot_sha256','verification_task_id','expected_control_sha256','expected_attestation_sha256','reason','actor'];
function validateRequest(taskId,input){
 bounded(input,4096,'failure reconciliation request');
 check(input&&Object.keys(input).every(k=>KEYS.includes(k))&&KEYS.every(k=>Object.hasOwn(input,k)),'请求字段');
 check(input.task_id===taskId&&UUID.test(taskId)&&UUID.test(input.verification_task_id)&&SHA.test(input.expected_control_sha256)&&SHA.test(input.expected_attestation_sha256),'请求身份/摘要');
 check(/^codex:[a-zA-Z0-9_:/-]{1,100}$/.test(input.actor)&&typeof input.reason==='string'&&input.reason.trim().length>=4&&input.reason.length<=1000,'操作actor/原因');
}
function authorization(task,verifier,input){
 const e=task.result?.workflow_control?.envelope;check(e,'原控制器缺失');
 const identity=failureIdentity(e);
 check(Object.entries(identity).every(([k,v])=>input[k]===v),'请求冻结身份');
 const auth=task.result.commander_failure_reconciliation;
 check(auth?.verification_task_id===verifier?.id&&auth.operator_actor===input.actor&&Object.entries(identity).every(([k,v])=>auth[k]===v),'原任务授权签收');
 const va=verifier?.result?.commander_failure_verification_authorization;
 check(va?.purpose==='commander_failed_reconciliation_cleanup'&&Object.entries(identity).every(([k,v])=>va[k]===v)&&va.review_actor===verifier.verification_lease?.claimer,'核验授权');
 check(digest(verifier.result.commander_failure_verification)===input.expected_attestation_sha256,'独审摘要CAS');
 return identity;
}
async function loadVerifier(db,id,lock=false){
 const v=(await db.query('SELECT * FROM tasks WHERE id=$1'+(lock?' FOR UPDATE':''),[id])).rows[0];
 if(v)v.verification_lease=(await db.query('SELECT * FROM task_leases WHERE task_id=$1'+(lock?' FOR UPDATE':''),[id])).rows[0];
 return v;
}
function alreadyClosed(task,input){
 const c=task.result?.workflow_control,record=c?.failed_reconciliation;
 if(c?.phase!=='final')return null;
 check(task.status==='failed'&&c.verdict==='FAIL'&&record?.request_sha256===digest(input),'终态/重复请求冲突');
 return {task_id:task.id,run_id:c.envelope.run_id,status:'failed',effects:'unknown',retry_safe:false,duplicate:true,reconciliation_sha256:record.sha256};
}
export async function reconcileFailedCommander(pool,taskId,input,deps={}){
 validateRequest(taskId,input);
 const initial=(await pool.query('SELECT * FROM tasks WHERE id=$1',[taskId])).rows[0];check(initial,'任务不存在');
 const duplicate=alreadyClosed(initial,input);if(duplicate)return duplicate;
 const c=initial.result?.workflow_control;check(c&&digest(c)===input.expected_control_sha256,'控制状态CAS');
 const verifier=await loadVerifier(pool,input.verification_task_id);
 authorization(initial,verifier,input);
 const now=()=> (deps.now??Date.now)();
 check(now()>=Date.parse(c.envelope.cleanup_deadline_at),'只允许原预算已结束的失败对账');
 let session,committed=false;
 try{
  session=await (deps.probe??failureProbeSessions)(c);
  validateFailureProof(initial,verifier,session.observation,now());
  const result=await transaction(pool,taskId,async(db,current)=>{
   const existing=alreadyClosed(current,input);if(existing)return existing;
   check(digest(current.result?.workflow_control)===input.expected_control_sha256&&digest(current.result.commander_failure_reconciliation)===digest(initial.result.commander_failure_reconciliation),'控制状态/授权CAS');
   const v=await loadVerifier(db,input.verification_task_id,true);
   authorization(current,v,input);
   check(digest(v.result.commander_failure_verification_authorization)===digest(verifier.result.commander_failure_verification_authorization),'核验授权CAS');
   const e=current.result.workflow_control.envelope,resource=e.contract.resources;
   const locks=await db.query('SELECT device_name,locked_by,expires_at FROM device_locks WHERE device_name=$1 FOR UPDATE',[resource.device_serial]);
   check(locks.rows.length===1&&locks.rows[0].locked_by===null,'Brain资源锁非free或失读');
   const run=(await db.query('SELECT * FROM task_runs WHERE run_id=$1 FOR UPDATE',[e.run_id])).rows[0];
   check(run?.task_id===taskId&&digest(run.context?.commander_envelope)===digest(e)&&['running','failed'].includes(run.status),'原运行账绑定');
   const other=(await db.query('SELECT run_id FROM task_runs WHERE task_id=$1 AND run_id<>$2 AND ended_at IS NULL',[taskId,e.run_id])).rows;
   check(other.length===0,'同任务另有active run');
   // Locks held at both hosts; refresh original identity, hashes, exact durable failure and active flags.
   const final=await session.recheck();
   const proof=validateFailureProof(current,v,final,now());session.assertAlive();
   const record={...proof,actor:input.actor,principal:deps.principal??'internal-controller',reason:input.reason,
    observed_at:new Date(now()).toISOString(),request_sha256:digest(input),previous_control_sha256:input.expected_control_sha256};
   record.sha256=digest(record);
   const next={...current.result.workflow_control,phase:'final',verdict:'FAIL',effects:'unknown',retry_safe:false,
    execution_stopped:true,resume_condition:null,failed_reconciliation:record};
   await writeControl(db,taskId,next);
   await finishRun({runId:e.run_id,status:'failed',error:'durable_child_failure_reconciled',result:{failed_reconciliation:record}},{pool:db,strict:true,emit:async()=>{}});
   await releaseTaskLease(db,{taskId,claimer:null,reason:'commander_failed_reconciliation'});
   const done=await finalizeTask(db,taskId,'failed',{relay:false,onlyIfStatus:'in_progress',commanderFailureReconciliation:{runId:e.run_id,sha256:record.sha256},set:{completed_at:'now',error_message:'原尝试已失败，业务效果未知；不授权重试'}});
   check(done.rowCount===1,'失败终态CAS');
   await event(db,taskId,'commander_failed_reconciliation',record);
   session.assertAlive();
   return {task_id:taskId,run_id:e.run_id,status:'failed',effects:'unknown',retry_safe:false,reconciliation_sha256:record.sha256};
  });
  committed=true;return result;
 }finally{if(session)await session.release(committed);}
}
