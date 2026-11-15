import {buildHandoff} from '../handoff.js';
import {verifiedFoundationReceipts} from './receipts.js';
import {withWorkflowClient} from '../../scripts/commander-workflow/runtime-support.mjs';
import {normalizeCommanderRun,digest} from '../orchestrator/commander-decision.js';
import {finishRun} from '../lib/task-run.js';
import {finalizeTask,afterTerminalTransition} from '../lib/task-terminal.js';
import {foundationTransaction} from './registry.js';
import {loadFoundationTask,validateMachineRequest} from './claim.js';
import {requireFoundation} from './contracts.js';
export async function readFoundationWorkflow(run,env=process.env){
 const schema=env.COMMANDER_DBOS_SCHEMA??'commander_workflow_dbos';
 requireFoundation(/^[a-z][a-z0-9_]{0,62}$/.test(schema)&&typeof env.COMMANDER_DATABASE_URL==='string','foundation_dbos_unconfigured',503);
 return withWorkflowClient(env.COMMANDER_DATABASE_URL,schema,client=>client?client.getWorkflow(`commander-foundation:${run.run_id}`):null);
}
export function verifyFoundationObservation(job,observed){
 if(!observed||!['SUCCESS','ERROR','CANCELLED','MAX_RECOVERY_ATTEMPTS_EXCEEDED'].includes(observed.status))return null;
 requireFoundation(job.run&&observed.input?.[0]&&digest(normalizeCommanderRun(observed.input[0]))===digest(job.run),'foundation_dbos_identity_conflict');
 requireFoundation(observed.workflowID===`commander-foundation:${job.run_id}`&&observed.applicationVersion===job.run.runtime_revision,'foundation_dbos_identity_conflict');
 if(observed.status!=='SUCCESS')return {status:'blocked',reason:'foundation_dbos_execution_unknown',workflow_status:observed.status};
 const result=observed.output;
 requireFoundation(result?.task_id===job.task_id&&result.run_id===job.run_id&&['completed','failed','needs_review'].includes(result.status),'foundation_result_invalid');
 if(result.status==='completed')requireFoundation(result.business_pass===true&&verifiedFoundationReceipts(job.run.contract,result),'foundation_result_unverified');
 return {status:result.status==='needs_review'?'blocked':result.status,reason:result.reason??null,workflow_status:observed.status,result};
}
export async function reconcileFoundationTask(pool,taskId,input,services={}){
 validateMachineRequest(input,['machine_id','run_id']);
 const before=await foundationTransaction(pool,'foundation-task:'+taskId,db=>loadFoundationTask(db,taskId,input));
 if(before.task.status!=='in_progress')return {task_id:taskId,run_id:input.run_id,status:before.task.status};
 if(!before.job.run)return {task_id:taskId,run_id:input.run_id,status:'in_progress'};
 const observed=await (services.readWorkflow??readFoundationWorkflow)(before.job.run,services.env??process.env);
 const proof=verifyFoundationObservation(before.job,observed);
 if(!proof)return {task_id:taskId,run_id:input.run_id,status:'in_progress'};
 const events=[];
 const out=await foundationTransaction(pool,'foundation-task:'+taskId,async db=>{
  const {task,job}=await loadFoundationTask(db,taskId,input);
  requireFoundation(digest(job.run)===digest(before.job.run),'foundation_manifest_identity_conflict');
  if(task.status!=='in_progress')return {task_id:taskId,run_id:job.run_id,status:task.status};
  const finalRunStatus=proof.status==='completed'?'success':'failed';
  await finishRun({runId:job.run_id,status:finalRunStatus,error:proof.reason??undefined,result:{foundation_result:proof.result??null,dbos_status:proof.workflow_status},artifacts:[{ref:`dbos:commander-foundation:${job.run_id}`}]},{pool:db,strict:true,emit:async(...args)=>events.push(args)});
  const row=(await db.query('SELECT status,ended_at,task_id FROM task_runs WHERE run_id=$1',[job.run_id])).rows[0];
  requireFoundation(row?.task_id===taskId&&row.status===finalRunStatus&&row.ended_at,'foundation_run_closeout_unconfirmed');
  const reconciliation={run_id:job.run_id,definition_sha256:job.run.definition_sha256,dbos_workflow_id:`commander-foundation:${job.run_id}`,dbos_status:proof.workflow_status,status:proof.status,result_sha256:digest(proof.result??null),verified_at:new Date().toISOString()};
  await db.query("UPDATE tasks SET result=COALESCE(result,'{}'::jsonb)||jsonb_build_object('foundation_reconciliation',$2::jsonb),updated_at=NOW() WHERE id=$1",[taskId,JSON.stringify(reconciliation)]);
  const evidence=[{ref:`dbos:commander-foundation:${job.run_id}`,run_id:job.run_id,definition_sha256:job.run.definition_sha256}];
  const merged={actor:'commander-foundation',summary:proof.status==='completed'?'固定Workflow已由DBOS与独立checker确认完成':'固定Workflow未通过，原运行保留待检查',evidence,foundation_result:proof.result??null,handoff:buildHandoff({task_id:taskId,title:task.title,verdict:proof.status==='completed'?'PASS':'FAIL',done:['已核验原DBOS运行并保存冻结版本与结果'],not_done:proof.status==='completed'?[]:['业务未通过或执行状态未知'],next_steps:[],artifacts:{docs:evidence.map(e=>e.ref)}})};
  if(proof.status==='blocked')await db.query("UPDATE tasks SET status='blocked',blocked_at=NOW(),blocked_reason='foundation_needs_review',blocked_detail=$2::jsonb,result=result||$3::jsonb,updated_at=NOW() WHERE id=$1 AND status='in_progress'",[taskId,JSON.stringify({run_id:job.run_id,reason:proof.reason??'foundation_checker_needs_review',evidence}),JSON.stringify(merged)]);
  else{
   const done=await finalizeTask(db,taskId,proof.status,{relay:false,onlyIfStatus:['in_progress'],set:{error_message:proof.reason??null},mergeResult:merged,foundationReconciliation:{runId:job.run_id,definitionSha256:job.run.definition_sha256,status:proof.status}});
   requireFoundation(done.rowCount===1,'foundation_task_closeout_unconfirmed');
  }
  return {task_id:taskId,run_id:job.run_id,status:proof.status};
 });
 for(const args of events)try{await(services.emit??(await import('../event-bus.js')).emit)(...args);}catch{/* 终态已提交，事件总线不得改写结果。 */}
 if(out.status==='completed')await afterTerminalTransition(pool,taskId,'completed',{deps:services.terminalDeps??{}});
 return out;
}
