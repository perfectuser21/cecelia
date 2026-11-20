import {isDeepStrictEqual} from 'node:util';
import {qiumiEnv} from './routing/env.js';
import {nativeAgentAuthoritySql,hasNativeAgentOwner} from './lib/native-agent-authority.js';
import {acquireDeviceLock} from './device-lock-helpers.js';
import {transaction} from './execution-directory/store.js';
import {startRun,finishRun} from './lib/task-run.js';
import {finalizeTask} from './lib/task-terminal.js';
import {setBrainLease} from './lib/task-lease.js';
import {nativeHasResources,nativeAssistantText,holdNativeReview} from './lib/native-agent-review.js';
import {recordTaskEventSafe} from './lib/task-event-log.js';
import {nativeAgentStartRequest,nativeAgentOperation,nativeAgentReceipt} from './lib/native-agent-protocol.js';
import {resolveNativeAgentHost,nativeAgentTransport} from './lib/native-agent-transport.js';
const errorCode=e=>/^native_agent_[a-z_]+$/.test(e?.message??'')?e.message:'native_agent_unconfirmed';
const boundRun=t=>t.result?.native_agent?.request?.run_id;
async function poolOf(deps){return deps.pool??(await import('./db.js')).default;}
async function save(db,id,binding){
 const result=await db.query(`UPDATE tasks SET result=COALESCE(result,'{}'::jsonb)||jsonb_build_object('native_agent',$2::jsonb),
    updated_at=NOW() WHERE id=$1 RETURNING *`,[id,JSON.stringify(binding)]);
 if(result.rowCount!==1)throw Error('native_agent_binding_unconfirmed');
}
async function blockPreflight(pool,task,reason){
 await pool.query(`UPDATE tasks SET status='blocked',blocked_at=NOW(),blocked_reason=$2::varchar,blocked_until=NULL,
  error_message=$2::text,claimed_by=NULL,claimed_at=NULL,updated_at=NOW()
  WHERE id=$1 AND status IN ('queued','in_progress') AND (result->'native_agent') IS NULL`,[task.id,reason]);
 return {success:false,taskId:task.id,reason,nativePreflightBlocked:true,taskTerminal:true,execution_state:'not_started'};
}
async function releaseLocks(pool,task,binding){
 for(const lock of binding.device_locks??[])await pool.query(`UPDATE device_locks SET locked_by=NULL,locked_at=NULL,expires_at=NULL
  WHERE device_name=$1 AND locked_by=$2::text AND xmin::text=$3`,[lock.device_name,task.id,lock.acquisition_version]);
}
async function reserve(pool,task,deps){
 return transaction(pool,async db=>{
  const current=(await db.query('SELECT * FROM tasks WHERE id=$1 FOR UPDATE',[task.id])).rows[0];
  if(!current)throw Error('native_agent_task_missing');
  if(current.result?.native_agent){
   if(current.status!=='in_progress')throw Error('native_agent_task_not_runnable');
   const proof=await db.query(`SELECT id FROM tasks WHERE id=$1 AND ${nativeAgentAuthoritySql()}`,[task.id]);
   if(proof.rowCount!==1)throw Error('native_agent_binding_unconfirmed');
   const recorded=(await db.query("SELECT context FROM task_runs WHERE task_id=$1 AND run_id=$2 AND context->>'source'='native-agent'",[task.id,current.result.native_agent.request.run_id])).rows[0];
   if(recorded?.context?.native_agent?.resource_bound!==nativeHasResources(current.result.native_agent))throw Error('native_agent_binding_unconfirmed');
   return {task:current,binding:current.result.native_agent,action:current.result.native_agent.cancel_requested?'cancel':'inspect'};
  }
  if(await hasNativeAgentOwner(db,task.id))throw Error('native_agent_binding_unconfirmed');
  if(!['queued','in_progress'].includes(current.status))throw Error('native_agent_task_not_runnable');
  if(current.executor_kind==='openclaw-agent'&&current.payload?.run_id)throw Error('native_agent_legacy_run_requires_review');
  if(current.payload?.headed_manual===true||current.payload?.headed_takeover)throw Error('native_agent_task_owned');
  const host=await(deps.resolveHost??resolveNativeAgentHost)(deps.env??process.env);
  const request=nativeAgentStartRequest(current,(deps.now??Date.now)(),deps.env??process.env);
  const capacity=qiumiEnv(deps.env??process.env).mmvConcurrency;
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,286))',[JSON.stringify(['native-agent-host',host.machine_id])]);
  const occupied=(await db.query(`SELECT count(*)::int AS n FROM task_runs WHERE context->>'source'='native-agent' AND ended_at IS NULL
   AND context#>>'{native_agent,host,machine_id}'=$1`,[host.machine_id])).rows[0]?.n??0;
  if(occupied>=capacity){
   await db.query("UPDATE tasks SET status='queued',claimed_by=NULL,claimed_at=NULL,updated_at=NOW() WHERE id=$1 AND status IN ('queued','in_progress') AND result->'native_agent' IS NULL",[task.id]);
   return {capacity:true};
  }

  await(deps.setLease??setBrainLease)(db,task.id,Math.ceil(request.timeout_ms/1000)+900);
  if(current.payload?.device_serial){
   const acquired=await(deps.acquireDeviceLock??acquireDeviceLock)(task.id,current.payload.device_serial,current.payload.device_ttl_minutes,db);
   if(acquired.result!=='acquired')throw Error(acquired.result==='unknown_device'?'native_agent_device_unregistered':'native_agent_device_locked');
  }
  const locks=(await db.query('SELECT device_name,xmin::text AS acquisition_version FROM device_locks WHERE locked_by=$1 ORDER BY device_name',[task.id])).rows;
  const device=current.payload?.qiumi_route?.device_hint??{};
  const binding={protocol:'native-agent-binding/v1',request,host,device_locks:locks,resources:{device_serial:device.serial??null,requested_device:device.requested??null},dispatch_issued_at:new Date().toISOString(),cancel_requested:false};
  const started=await(deps.startRun??startRun)({taskId:task.id,runId:request.run_id,source:'native-agent',context:{native_agent:{task_id:task.id,run_id:request.run_id,input_digest:request.input_digest,request_nonce:request.request_nonce,host,account_ref:request.account_ref,resource_bound:nativeHasResources(binding)}}},{pool:db,transactionClient:db,strict:true});
  if(!started?.id)throw Error('native_agent_run_unrecorded');
  await save(db,task.id,binding);
  await db.query(`UPDATE tasks SET status='in_progress',executor_kind='external-worker',started_at=COALESCE(started_at,NOW()),
   payload=COALESCE(payload,'{}'::jsonb)||jsonb_build_object('native_agent_run_id',$2::text,'run_id',$2::text,'provider','native-agent'),updated_at=NOW() WHERE id=$1`,[task.id,request.run_id]);
  return {task:current,binding,action:'start'};
 });
}
async function saveReceipt(pool,task,binding,receipt){
 return transaction(pool,async db=>{
  const current=(await db.query('SELECT * FROM tasks WHERE id=$1 FOR UPDATE',[task.id])).rows[0];
  if(boundRun(current)!==binding.request.run_id||!isDeepStrictEqual(current.result.native_agent.request,binding.request)||!isDeepStrictEqual(current.result.native_agent.host,binding.host))throw Error('native_agent_binding_changed');
  await save(db,task.id,{...current.result.native_agent,...(receipt.frozen?{frozen:receipt.frozen}:{}),...(receipt.actual_cli_model?{actual_cli_model:receipt.actual_cli_model}:{}),receipt});
 });
}
async function finishNativeRun(pool,task,binding,input,deps){
 const finished=await(deps.finishRun??finishRun)(input,{pool,strict:true});
 if(finished?.updated===true)return;
 const proof=input.result?.native_agent_resource_settlement??null;
 const saved=await pool.query(`SELECT id FROM task_runs WHERE task_id=$1 AND run_id=$2 AND status=$3 AND ended_at IS NOT NULL
  AND context->>'source'='native-agent' AND ($4::jsonb IS NULL OR result->'native_agent_resource_settlement'=$4::jsonb)`,[task.id,binding.request.run_id,input.status,proof===null?null:JSON.stringify(proof)]);
 if(saved.rows.length!==1)throw Error('native_agent_run_terminal_unconfirmed');
}
async function observe(pool,plan,deps){
 const {binding,task,action}=plan,request=action==='start'?binding.request:nativeAgentOperation(binding,action);
 let receipt;
 try{receipt=nativeAgentReceipt(binding,await(deps.transport??nativeAgentTransport)(binding.host,request));}
 catch(error){
  await(deps.recordEvent??recordTaskEventSafe)(pool,task.id,'native_agent_observation_unknown',{run_id:binding.request.run_id,reason:errorCode(error),action});
  return {success:false,dispatchUncertain:true,taskId:task.id,runId:binding.request.run_id,executor:'native-agent',reason:errorCode(error)};
 }
 await saveReceipt(pool,task,binding,receipt);
 if(receipt.status==='rejected'&&receipt.launch_state==='not_started'){
  const devices=(await pool.query('SELECT device_name,xmin::text AS acquisition_version FROM device_locks WHERE locked_by=$1 ORDER BY device_name',[task.id])).rows;
  if(nativeHasResources(binding)&&!isDeepStrictEqual(devices,binding.device_locks??[]))return holdNativeReview(pool,task,binding,receipt);
  await finishNativeRun(pool,task,binding,{runId:binding.request.run_id,status:'failed',error:receipt.error??'native_agent_preflight_rejected',result:{actor:'native-agent',native_agent_resource_settlement:{protocol:'native-agent-resource-settlement/v1',basis:'not-started',task_id:task.id,run_id:binding.request.run_id,input_digest:binding.request.input_digest,request_nonce:binding.request.request_nonce,host:binding.host,devices:binding.device_locks??[]}}},deps);
  await pool.query(`UPDATE tasks SET status='blocked',blocked_reason='native_agent_preflight_rejected',blocked_at=NOW(),blocked_until=NULL,error_message=$2,updated_at=NOW()
   WHERE id=$1 AND result->'native_agent'->'request'->>'run_id'=$3 AND status='in_progress'`,[task.id,receipt.error??'native_agent_preflight_rejected',binding.request.run_id]);
  await(deps.releaseLocks??releaseLocks)(pool,task,binding);
  return {success:false,taskTerminal:true,nativePreflightBlocked:true,execution_state:'not_started',reason:receipt.error??'native_agent_preflight_rejected',runId:binding.request.run_id};
 }
 if(receipt.status==='unknown'||receipt.launch_state==='unknown')return {success:false,dispatchUncertain:true,reason:'native_agent_execution_unknown',runId:binding.request.run_id};
 if(['completed','failed','timed_out','cancelled'].includes(receipt.status)){
  if(nativeHasResources(binding)) {
   await(deps.setLease??setBrainLease)(pool,task.id,900);
   return holdNativeReview(pool,task,binding,receipt);
  }
  const status=receipt.status==='completed'?'completed_no_pr':receipt.status==='cancelled'?'cancelled':'failed';
  await finishNativeRun(pool,task,binding,{runId:binding.request.run_id,status:receipt.status==='completed'?'success':receipt.status==='timed_out'?'timeout':receipt.status,
   exitCode:receipt.result.exit_code,result:{actor:'native-agent',summary:receipt.summary,evidence:receipt.evidence,termination_scope:receipt.termination_scope??null}},deps);
  const text=receipt.result.final_text||nativeAssistantText(receipt.result.stdout);
  const summary=receipt.status==='cancelled'?'原生会话已确认停止；未声称撤销已产生的外部效果':receipt.summary;
  let finished;
  if(status==='cancelled')finished=await pool.query(`UPDATE tasks SET status='cancelled',result=COALESCE(result,'{}'::jsonb)||jsonb_build_object('receipt',$2::jsonb),updated_at=NOW()
   WHERE id=$1 AND status='in_progress' AND result->'native_agent'->'request'->>'run_id'=$3 RETURNING *`,[task.id,JSON.stringify({summary,text:summary,evidence:receipt.evidence}),binding.request.run_id]);
  else finished=await(deps.finalizeTask??finalizeTask)(pool,task.id,status,{onlyIfStatus:'in_progress',where:{sql:"result->'native_agent'->'request'->>'run_id'=$1",params:[binding.request.run_id]},
   mergeResult:{actor:'native-agent',receipt:{summary,text:text||summary,stdout:receipt.result.stdout,evidence:receipt.evidence},handoff:{summary,next_steps:[]}},
   ...(status==='failed'?{set:{error_message:'native_agent_'+receipt.status}}:{})});
  if(finished.rowCount===1)await(deps.releaseLocks??releaseLocks)(pool,task,binding);
 }
 if(!['completed','failed','timed_out','cancelled'].includes(receipt.status))await(deps.setLease??setBrainLease)(pool,task.id,Math.ceil(binding.request.timeout_ms/1000)+900);
 return {success:true,taskId:task.id,runId:binding.request.run_id,executor:'native-agent',status:receipt.status};
}
export async function triggerNativeAgent(task,deps={}){
 if(task.executor_kind==='openclaw-agent'&&task.status==='in_progress'&&task.payload?.run_id)return {success:false,taskId:task.id,reason:'legacy_execution_read_only'};
 const pool=await poolOf(deps);
 let plan;
 try{plan=await reserve(pool,task,deps);}
 catch(error){
  if(task.result?.native_agent||errorCode(error)==='native_agent_binding_unconfirmed')return {success:false,dispatchUncertain:true,reason:errorCode(error),runId:boundRun(task),executor:'native-agent'};
  return blockPreflight(pool,task,errorCode(error));
 }
 if(plan.capacity)return {success:false,wait:true,nativeCapacityWait:true,taskStateHandled:true,reason:'native_agent_capacity',execution_state:'not_started',taskId:task.id};
 try{
  if(plan.action!=='start')await(deps.setLease??setBrainLease)(pool,task.id,Math.ceil(plan.binding.request.timeout_ms/1000)+900);
  return await observe(pool,plan,deps);
 }
 catch(error){return {success:false,dispatchUncertain:true,reason:errorCode(error),runId:plan.binding.request.run_id,executor:'native-agent'};}
}
export async function reapNativeAgentRuns(pool,deps={}){
 const rows=(await pool.query("SELECT * FROM tasks WHERE status='in_progress' AND executor_kind='external-worker' AND result->'native_agent'->'request'->>'run_id' IS NOT NULL ORDER BY updated_at LIMIT 20")).rows;
 const out={observed:0,unknown:0};
 for(const task of rows){const r=await triggerNativeAgent(task,{...deps,pool});out.observed++;if(r.dispatchUncertain)out.unknown++;}
 return out;
}

/** 只登记原生server-run取消意图；停机及资源效果由原绑定收割路径确认。 */
export async function requestNativeAgentCancellation(pool,taskId){
 const changed=await pool.query(`UPDATE tasks SET result=jsonb_set(result,'{native_agent,cancel_requested}','true'::jsonb,true),updated_at=NOW()
  WHERE id=$1 AND (status='in_progress' OR (status='blocked' AND blocked_reason='owner_decision')) AND executor_kind='external-worker'
   AND ${nativeAgentAuthoritySql()} RETURNING id`,[taskId]);
 if(changed.rowCount===1)return {matched:true};
 return await hasNativeAgentOwner(pool,taskId)?{matched:false,nativeOwned:true}:{matched:false};
}
