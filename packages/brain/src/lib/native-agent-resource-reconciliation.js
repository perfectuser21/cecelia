import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {transaction} from '../execution-directory/store.js';
import {nativeAgentAuthoritySql} from './native-agent-authority.js';
import {nativeAgentOperation,nativeAgentReceipt} from './native-agent-protocol.js';
import {nativeAgentTransport} from './native-agent-transport.js';
import {ownerDecisionSignature} from './owner-decision.js';
import {finishRun} from './task-run.js';
import {finalizeTask,afterTerminalTransition} from './task-terminal.js';
import {releaseTaskLease} from './task-lease.js';
import {releaseDeviceLocksHeldBy} from '../device-lock-helpers.js';
const fail=(code,status=409)=>{throw Object.assign(Error(code),{code,status});};
const terminal=new Set(['completed','failed','timed_out','cancelled']);
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function inputReview(input){
 if(input.cleanup_confirmed!==true||input.effects_reviewed!==true||!Array.isArray(input.evidence)||!input.evidence.length
  ||input.evidence.some(e=>typeof e==='string'?!e.trim():!e||typeof e.ref!=='string'||!e.ref.trim())
  ||!Array.isArray(input.expected_devices)||input.expected_devices.some(d=>typeof d.device_name!=='string'||!/^\d+$/.test(d.acquisition_version??'')))fail('native_agent_cleanup_review_invalid',400);
 return {actor:'authenticated-operator',cleanup_confirmed:true,effects_reviewed:true,evidence:input.evidence};
}
/** 人工独立复核已有会话；原TaskRun/待办/设备仍为唯一真身，不创建新执行或重试。 */
export async function reconcileNativeAgentResources(pool,runId,input,{principal,transport=nativeAgentTransport}={}){
 const emitted=[];
 if(principal!=='authenticated-operator')fail('native_agent_cleanup_auth_required',401);
 const review=inputReview(input);
 const selected=(await pool.query(`SELECT * FROM tasks WHERE id=$1 AND status='blocked' AND blocked_reason='owner_decision'
  AND result#>>'{native_agent,request,run_id}'=$2 AND ${nativeAgentAuthoritySql()}`,[input.task_id,runId])).rows[0];
 if(!selected)fail('native_agent_cleanup_binding_changed');
 const original=selected.result.native_agent;
 // 独立重新读取原宿主：Task.result中保存的完成字样不是子进程停止证明。
 let receipt;
 try{receipt=nativeAgentReceipt(original,await transport(original.host,nativeAgentOperation(original,'inspect')));}
 catch{fail('native_agent_cleanup_stop_unknown',503);}
 if(!terminal.has(receipt.status)&&!(receipt.status==='rejected'&&receipt.launch_state==='not_started'&&receipt.execution_stopped===true))fail('native_agent_cleanup_stop_unknown',503);
 const result=await transaction(pool,async db=>{
  const task=(await db.query('SELECT * FROM tasks WHERE id=$1 FOR UPDATE',[input.task_id])).rows[0];
  if(task?.status!=='blocked'||task.blocked_reason!=='owner_decision'||task.blocked_detail?.run_id!==runId||!isDeepStrictEqual(task.result?.native_agent,original))fail('native_agent_cleanup_binding_changed');
  const authority=(await db.query(`SELECT id FROM tasks WHERE id=$1 AND ${nativeAgentAuthoritySql()}`,[task.id])).rows;
  const run=(await db.query("SELECT * FROM task_runs WHERE task_id=$1 AND run_id=$2 AND context->>'source'='native-agent' FOR UPDATE",[task.id,runId])).rows[0];
  if(authority.length!==1||!run||run.ended_at||run.context.native_agent?.resource_bound!==true)fail('native_agent_cleanup_binding_changed');
  const pending=(await db.query('SELECT * FROM pending_actions WHERE id=$1 FOR UPDATE',[input.pending_action_id])).rows[0];
  if(pending?.status!=='pending_approval'||pending.action_type!=='owner_decision'||pending.params?.task_id!==task.id||pending.signature!==ownerDecisionSignature(task.id))fail('native_agent_cleanup_review_changed');
  const devices=(await db.query('SELECT device_name,xmin::text AS acquisition_version FROM device_locks WHERE locked_by=$1 ORDER BY device_name FOR UPDATE',[task.id])).rows;
  const expected=[...input.expected_devices].sort((a,b)=>a.device_name.localeCompare(b.device_name));
  if(!isDeepStrictEqual(devices,expected))fail('native_agent_cleanup_device_changed');
  const proof={protocol:'native-agent-resource-settlement/v1',basis:'operator-cleanup-review',task_run_id:run.id,task_id:task.id,run_id:runId,
   input_digest:original.request.input_digest,request_nonce:original.request.request_nonce,host:original.host,devices,receipt_sha256:hash(receipt),review,pending_action_id:pending.id,human_cancel_requested:original.cancel_requested===true};
  const event=(await db.query("INSERT INTO task_events(task_id,event_type,payload,created_at) VALUES($1,'native_agent_cleanup_reviewed',$2,NOW()) RETURNING id",[task.id,proof])).rows[0];
  if(!event?.id)fail('native_agent_cleanup_record_unconfirmed',503);
  const settlement={...proof,review_event_id:event.id,human_cancel_requested:original.cancel_requested===true};
  const runStatus=receipt.status==='rejected'?'failed':receipt.status==='completed'?'success':receipt.status==='timed_out'?'timeout':receipt.status;
  const finished=await finishRun({runId,status:runStatus,exitCode:receipt.result?.exit_code??null,result:{actor:'native-agent',native_agent_resource_settlement:settlement}},{pool:db,strict:true,emit:async(...args)=>{emitted.push(args);}});
  if(!finished.updated)fail('native_agent_cleanup_record_unconfirmed',503);
  const status=original.cancel_requested===true||receipt.status==='cancelled'?'cancelled':receipt.status==='completed'?'completed_no_pr':'failed';
  await db.query("UPDATE tasks SET result=jsonb_set(result,'{native_agent,needs_review}','false')||jsonb_build_object('native_agent_resource_review',$2::jsonb) WHERE id=$1",[task.id,settlement]);
  let changed;
  if(status==='cancelled')changed=await db.query("UPDATE tasks SET status='cancelled',blocked_reason=NULL,blocked_at=NULL,blocked_until=NULL,claimed_by=NULL,claimed_at=NULL,result=result||jsonb_build_object('receipt',$2::jsonb),updated_at=NOW() WHERE id=$1 AND status='blocked' RETURNING *",[task.id,{summary:'主理人请求取消；原会话执行事实保留，资源已独立复核，未声称撤销外部效果',human_cancel_requested:original.cancel_requested===true,evidence:receipt.evidence}]);
  else changed=await finalizeTask(db,task.id,status,{onlyIfStatus:'blocked',where:{sql:"result#>>'{native_agent,request,run_id}'=$1",params:[runId]},relay:false,
   mergeResult:{actor:'native-agent',receipt:{summary:receipt.summary,text:receipt.result?.final_text||receipt.summary||receipt.error||'原生会话未启动',evidence:receipt.evidence},handoff:{summary:receipt.summary,next_steps:[]}}});
  if(changed.rowCount!==1)fail('native_agent_cleanup_binding_changed');
  await db.query("UPDATE pending_actions SET status='approved',reviewed_by='authenticated-operator',reviewed_at=NOW(),execution_result=$2::jsonb WHERE id=$1 AND status='pending_approval'",[pending.id,settlement]);
  const lease=await releaseTaskLease(db,{taskId:task.id,claimer:null,reason:'native_agent_operator_cleanup_review'});
  if(!lease.released&&(await db.query('SELECT 1 FROM task_leases WHERE task_id=$1 AND released_at IS NULL',[task.id])).rows.length)fail('native_agent_cleanup_lease_unconfirmed',503);
  await releaseDeviceLocksHeldBy(task.id,db);
  if((await db.query('SELECT 1 FROM device_locks WHERE locked_by=$1',[task.id])).rows.length)fail('native_agent_cleanup_release_unconfirmed',503);
  await db.query('UPDATE tasks SET blocked_reason=NULL,blocked_at=NULL,blocked_until=NULL,blocked_detail=NULL,error_message=$2 WHERE id=$1',[task.id,status==='failed'?'native_agent_'+receipt.status:null]);
  return {task_id:task.id,run_id:runId,status,resources_released:true,review_event_id:event.id};
 });
 for(const args of emitted){try{await(await import('../event-bus.js')).emit(...args);}catch(error){console.warn(`[native-agent] run event delivery unavailable: ${error.message}`);}}
 await afterTerminalTransition(pool,result.task_id,result.status);
 return result;
}
