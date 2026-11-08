import {startDurableCommonRunner} from '../durable/common-runner-durable-client.js';
/** 旧workflow只保留调度身份；新执行由固定公共Runner活动链负责。 */
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createCommonRunnerDispatcher} from './common-runner-dispatch.js';
import {transaction, frozenContract} from './commander-v2-store.js';
import {validateContract,digest} from './commander-v2-contract.js';
import {startRun} from './task-run.js';
import {checkDeviceLockForManualDispatch} from './manual-dispatch-device-gate.js';
import {blockCommonRunnerForReview} from './common-runner-review.js';
import {finalizeTask} from './task-terminal.js';
import {releaseDeviceLocksHeldBy} from '../device-lock-helpers.js';
import {setBrainLease} from './task-lease.js';
const fail=reason=>{throw Error(reason);};
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
export function loadWorkflowCommonRoutes(filename){
 if(!filename)return {};
 if(!path.isAbsolute(filename))fail('workflow_common_routes_unprotected');
 const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const s=fs.fstatSync(fd);if(!s.isFile()||s.size>262144||(s.mode&0o077)!==0||![0,process.getuid?.()].includes(s.uid))fail('workflow_common_routes_unprotected');
  const data=JSON.parse(fs.readFileSync(fd,'utf8'));
  if(data.schema_version!==1||!object(data.routes))fail('workflow_common_routes_invalid');
  return data.routes;
 }finally{fs.closeSync(fd);}
}
export function matchWorkflowSource(task,frozen,routes){
 const route=routes[task.payload?.workflow_key];
 if(!route||typeof route.machine_id!=='string'||!route.machine_id||!/^([a-z][a-z0-9-]{0,63})$/.test(route.profile??'')||!/^([a-f0-9]{64})$/.test(route.profile_sha256??''))fail('workflow_common_profile_unavailable');
 const definition=frozen.definition;
 if(!object(route.definition)||['release_id','workflow_id','workflow_definition_version_id','snapshot_sha256','runtime_snapshot_sha256'].some(k=>route.definition[k]!==definition[k]))fail('workflow_common_source_mismatch');
 if(!/^[a-f0-9]{64}$/.test(route.components_sha256??'')||digest(frozen.release.payload.components)!==route.components_sha256)fail('workflow_common_components_mismatch');
 if(digest(route.resources)!==digest(frozen.contract.resources))fail('workflow_common_resource_mismatch');
 validateContract({...task,payload:{...task.payload,commander_protocol:'commander-v2'}},frozen.contract);
 return route;
}
export function createWorkflowCommonAdapter(pool,deps={}){
 const routes=()=>deps.routes??loadWorkflowCommonRoutes((deps.env??process.env).WORKFLOW_COMMON_RUNNER_ROUTES_FILE);
 const readFrozen=deps.frozenContract??frozenContract;
 const taskPolicy=async({task,db,action,runId,body})=>{
  if(task.task_type!=='workflow_dispatch'||!['workflow', 'agent'].includes(task.kind))return false;
  const source=task.result?.workflow_common_runner;
  if(!source||source.run_id!==runId)return false;
  // Bound cleanup remains possible after config revocation. No new business is issued.
  if(action!=='start'||task.result?.common_runner&&task.result.common_runner.launch_state!=='not_started')return source.task_id===task.id;
  const frozen=await readFrozen(db,{...task,payload:{...task.payload,workflow_definition:source.definition}});
  const route=matchWorkflowSource(task,frozen,routes());
  return route.profile===body.profile&&route.profile_sha256===source.profile_sha256&&digest(body.input)===source.input_sha256;
 };
 const dispatcher=deps.dispatcher??createCommonRunnerDispatcher({pool,...deps.commonRunner,
  profiles:Object.fromEntries(Object.values(routes()).map(r=>[r.profile,{machine_id:r.machine_id,profile_sha256:r.profile_sha256}])),taskPolicy});
 return {async dispatch(taskId){
  const source=await transaction(pool,taskId,async(db,task)=>{
   if(task.task_type!=='workflow_dispatch'||!['workflow','agent'].includes(task.kind))fail('workflow_common_task_owned');
   if(task.result?.workflow_common_runner){if(task.status!=='in_progress'||task.claimed_by!=='common-runner')fail('workflow_common_task_owned');return task.result.workflow_common_runner;}
   if(task.status!=='queued'||task.claimed_by||task.payload?.run_id||task.result?.workflow_control)fail('workflow_common_existing_execution_read_only');
   const selected=routes()[task.payload?.workflow_key];
   if(!selected)fail('workflow_common_profile_unavailable');
   const definition=task.payload.workflow_definition??selected.definition;
   const frozen=await readFrozen(db,{...task,payload:{...task.payload,workflow_definition:definition}});
   const route=matchWorkflowSource(task,frozen,routes());
   const runId=randomUUID(), policy=validateContract({...task,payload:{...task.payload,commander_protocol:'commander-v2'}},frozen.contract);
   const source={run_id:runId,task_id:task.id,definition:{...definition,attempt_key:`${task.id}:1`,actor:'common-runner'},profile:route.profile,profile_sha256:route.profile_sha256,input:{...task.payload.workflow_input,task_id:task.id,publication_input:task.payload.workflow_input},input_sha256:digest({...task.payload.workflow_input,task_id:task.id,publication_input:task.payload.workflow_input}),resources:frozen.contract.resources,timeout_s:policy.total_timeout_sec+policy.cleanup_timeout_sec};
   await (deps.startRun??startRun)({taskId:task.id,runId,source:'workflow-common-runner',definition:source.definition,context:{workflow_key:task.payload.workflow_key}}, {pool,transactionClient:db});
   await db.query("UPDATE tasks SET result=COALESCE(result,'{}'::jsonb)||jsonb_build_object('workflow_common_runner',$2::jsonb),status='in_progress',claimed_by='common-runner',claimed_at=NOW(),executor_kind='script',started_at=COALESCE(started_at,NOW()),updated_at=NOW() WHERE id=$1",[task.id,JSON.stringify(source)]);
   return source;
  });
  if(source.resources.device_serial){const gate=await(deps.lockGate??(t=>checkDeviceLockForManualDispatch(t,'common-runner')))({id:taskId,payload:{device_serial:source.resources.device_serial,device_ttl_minutes:Math.min(240,Math.ceil((source.timeout_s??2700)/60))}});if(!gate.pass)return {waiting:true,gate};}
  await(deps.setLease??setBrainLease)(pool,taskId,source.timeout_s??2700);
  const body={task_id:taskId,profile:source.profile,input:source.input,mode:'formal'};
  if((deps.env??process.env).DBOS_DURABLE_ENABLED==='true'){
   const durable=await(deps.durableStart??startDurableCommonRunner)({dispatch_scope:'workflow',run_id:source.run_id,body,deadline_ms:Date.now()+(source.timeout_s??2700)*1000,poll_interval_ms:1000});
   const state=await durable.handle?.getStatus();
   if(['SUCCESS','ERROR','CANCELLED'].includes(state?.status)){
    const outcome=state.status==='SUCCESS'?await durable.handle.getResult():{status:'needs_review',reason:'common_runner_durable_workflow_error'};
    if(outcome.status!=='completed'){
     const reason=/^common_runner_[a-z0-9_]+$/.test(outcome.reason??'')?outcome.reason:'common_runner_durable_worker_review_required';
     // 原dispatcher总在外部动作前写binding；终态且CAS确认无binding，才证明未启动。
     const finished=await(deps.finalizeTask??finalizeTask)(pool,taskId,'failed',{onlyIfStatus:['in_progress'],
      commonRunnerNoLaunchReconciliation:{runId:source.run_id,workflowId:durable.workflow_id,workflowStatus:state.status},
      where:{sql:"claimed_by='common-runner' AND result->'workflow_common_runner'->>'run_id'=$1 AND result->'common_runner' IS NULL",params:[source.run_id]},
      set:{error_message:reason},mergeResult:{actor:'common-runner-durable',summary:'持久协调器终结，未创建Worker绑定',evidence:[{run_id:source.run_id,durable_workflow_id:durable.workflow_id,outcome}],handoff:{summary:'未启动业务；保留原身份与终结证据',next_steps:[]}}});
     if(finished.rowCount===1){await(deps.releaseLock??releaseDeviceLocksHeldBy)(taskId);return {dispatched:false,waiting:false,status:'needs_review',reason,durable_workflow_id:durable.workflow_id};}
    }
   }
   return {dispatched:false,waiting:true,durable_workflow_id:durable.workflow_id};
  }
  const result=await dispatcher.dispatch('start',source.run_id,body);
  return {...result,dispatched:result.authenticated===true,waiting:result.authenticated!==true};
 },async inspect(task){
  const source=task.result?.workflow_common_runner;if(!source)fail('workflow_common_run_unknown');
  // No binding means no HTTP reservation/worker action ever existed. Resume only this reserved identity.
  if(!task.result?.common_runner)return this.dispatch(task.id);
  const result=await dispatcher.dispatch('inspect',source.run_id,{task_id:task.id});
  if(result.authenticated===true&&result.receipt?.execution_unknown!==true&&result.central_run?.recording_status==='confirmed'){
   const review=result.central_run.status==='needs_review';
   const status=result.central_run.status==='success'?'completed':review?'blocked':'failed';
   let transitioned=false;
   if(status==='blocked')transitioned=(await(deps.blockReview??blockCommonRunnerForReview)(pool,task,source.run_id,result)).blocked===true;
   else transitioned=(await(deps.finalizeTask??finalizeTask)(pool,task.id,status,{onlyIfStatus:['in_progress'],where:{sql:"claimed_by='common-runner' AND result->'workflow_common_runner'->>'run_id'=$1 AND result->'common_runner'->>'run_id'=$1",params:[source.run_id]},mergeResult:{actor:'common-runner',summary:'公共Runner独立验收与中央记录读回已完成',evidence:[{run_id:source.run_id,receipt:result.receipt}],handoff:{summary:'保持原task/run身份完成归位',next_steps:[]}}})).rowCount===1;
   // Phone ownership cannot be released on process exit or Commander prose.
   if(transitioned&&result.receipt.execution_unknown!==true&&result.receipt.validation?.cleanup?.verdict==='pass')await(deps.releaseLock??releaseDeviceLocksHeldBy)(task.id);
  }
  return result;
 },taskPolicy,runnerDispatcher:dispatcher};
}
