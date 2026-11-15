import {buildHandoff} from '../handoff.js';
import {finishRun} from '../lib/task-run.js';
import {finalizeTask} from '../lib/task-terminal.js';
import {foundationTransaction} from './registry.js';
import {loadFoundationTask,validateMachineRequest} from './claim.js';
import {requireFoundation} from './contracts.js';
/** 未ready意味着服务端从未授予副作用执行权；已ready只能保留未知状态。 */
export async function failFoundationPreflight(pool,taskId,input){
 validateMachineRequest(input,['machine_id','run_id','reason_code']);
 requireFoundation(/^[a-z][a-z0-9_]{1,100}$/.test(input.reason_code??''),'foundation_reason_invalid',400);
 return foundationTransaction(pool,'foundation-task:'+taskId,async db=>{
  const {task,job}=await loadFoundationTask(db,taskId,input);
  if(task.status!=='in_progress')return {task_id:taskId,run_id:job.run_id,status:task.status};
  if(job.run){
   await db.query("UPDATE tasks SET status='blocked',blocked_at=NOW(),blocked_reason='foundation_execution_unknown',blocked_detail=$2::jsonb,updated_at=NOW() WHERE id=$1 AND status='in_progress'",[taskId,JSON.stringify({run_id:job.run_id,reason_code:input.reason_code,execution_unknown:true})]);
   return {task_id:taskId,run_id:job.run_id,status:'blocked'};
  }
  await finishRun({runId:job.run_id,status:'failed',error:input.reason_code,result:{launch_state:'not_started'}},{pool:db,strict:true});
  const proof={run_id:job.run_id,status:'failed',dbos_status:'NOT_STARTED',reason_code:input.reason_code};
  await db.query("UPDATE tasks SET result=result||jsonb_build_object('foundation_reconciliation',$2::jsonb),updated_at=NOW() WHERE id=$1",[taskId,JSON.stringify(proof)]);
  const done=await finalizeTask(db,taskId,'failed',{relay:false,onlyIfStatus:['in_progress'],set:{error_message:input.reason_code},foundationReconciliation:{mode:'preflight',runId:job.run_id,status:'failed'},mergeResult:{actor:'commander-foundation',summary:'执行前验证失败，未发放启动授权',evidence:[{run_id:job.run_id,reason_code:input.reason_code,launch_state:'not_started'}],handoff:buildHandoff({task_id:taskId,title:task.title,verdict:'FAIL',done:['执行前验证完成'],not_done:['未授权启动业务'],next_steps:[]})}});
  requireFoundation(done.rowCount===1,'foundation_task_closeout_unconfirmed');return {task_id:taskId,run_id:job.run_id,status:'failed'};
 });
}
