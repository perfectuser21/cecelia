/** 复用真实异步Bridge；每Activity独立任务/运行账，只有匹配终态读回才返回。 */
import {randomUUID} from 'node:crypto';
import {createRoutedTask} from '../work-routing-store.js';
import {startRun} from '../lib/task-run.js';
import {definitionDigest,requireCondition} from '../workflow-authoring/contracts.js';
import {activityInvocationPrompt} from '../orchestrator/skill-activity-adapter.js';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function createInvocationActivityExecutor(db,{task,runId,submitActivity,createTask=createRoutedTask,start=startRun,id=randomUUID,pollMs=1000}={}){
 return async(request,{signal,budget,onAgentEvent=async()=>{},onHeartbeat=async()=>{}}={})=>{
  requireCondition(request.identity.task_id===task.id&&request.identity.run_id===runId,'子Activity父身份不匹配');
  let childRunId=id();const identity=request.identity,client=await db.connect();let child;
  try{
   await client.query('BEGIN');
   child=await createTask(client,{source:'api',source_id:`invocation-activity:${runId}:${identity.activity}:${identity.attempt}`,title:`调用活动 ${identity.activity}`,
    description:'公共Runner固定单Activity，禁止自行编排',mutation_intent:'none',declared_domain:'research',artifact_kind:'execution',requested_task_type:'research',
    task:{status:'dispatched',parent_task_id:task.id,delivery_type:'artifact',phase:'exploratory',payload:{tenant_id:identity.tenant_id,current_run_id:childRunId,
     invocation_activity:{...identity,request_key:task.payload.invocation.request_key,child_run_id:childRunId,skill:request.skill.implementation,skill_sha256:request.skill.sha256}}}},null,{transaction:'existing'});
   if(child.deduplicated){
    const prior=child.task?.payload?.invocation_activity;
    requireCondition(prior?.child_run_id&&prior.skill_sha256===request.skill.sha256
     &&Object.entries(identity).every(([key,value])=>definitionDigest(prior[key])===definitionDigest(value)),'子Activity幂等身份冲突',409);
    childRunId=prior.child_run_id;
   }else{
    const run=await start({taskId:child.task_id,runId:childRunId,source:'skill-invocation-activity',context:{tenant_id:identity.tenant_id,invocation_activity:identity,parent_task_id:task.id,request_key:task.payload.invocation.request_key}},{pool:client});
    requireCondition(run?.id,'子运行账不可写',503);
    await client.query("INSERT INTO task_events(task_id,event_type,payload) VALUES($1,'invocation_activity_dispatched',$2::jsonb)",[task.id,JSON.stringify({...identity,child_task_id:child.task_id,child_run_id:childRunId,skill:request.skill.implementation,skill_sha256:request.skill.sha256})]);
   }
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
  const deadline=Date.now()+budget.max_duration_s*1000;
  if(signal?.aborted)throw Object.assign(Error('activity_child_abort_before_submit'),{executionStopped:false});
  // commit先预留；HTTP错误也只读回，不重复/run。
  try{if(!child.deduplicated)await submitActivity({task_id:child.task_id,run_id:childRunId,prompt:activityInvocationPrompt(request),task_type:'research',timeout_ms:Math.max(1,Math.floor(budget.max_duration_s*1000))});}
  catch(error){await onAgentEvent({type:'error',message:error.message,child_task_id:child.task_id,dispatch:'submitted_or_unknown'});}
  let progressAt=Date.now(),stallAt=0,heartbeatAt=Date.now();const observed=new Set();
  try{
  while(Date.now()<deadline&&!signal?.aborted){
   const row=(await db.query('SELECT status,payload,result FROM tasks WHERE id=$1',[child.task_id])).rows[0];
   const run=(await db.query('SELECT run_id,status,ended_at,context FROM task_runs WHERE task_id=$1 AND run_id=$2',[child.task_id,childRunId])).rows[0];
   if(run?.ended_at&&run.run_id===childRunId&&definitionDigest(run.context?.invocation_activity)===definitionDigest(identity)){
    if(run.status!=='success')throw Object.assign(Error('activity_child_failed'),{executionStopped:true});
    // callback先finishRun、再原子更新task；两份读回必须最终对齐同一child run。
    if(['completed','completed_no_pr'].includes(row?.status)&&row.payload?.last_run_result?.run_id===childRunId){
     const result=row.payload.last_run_result.result_summary;
     await onAgentEvent({type:'progress',message:'原子运行终态已独立读回',child_task_id:child.task_id,child_run_id:childRunId});
     return result;
    }
   }
   const events=(await db.query('SELECT event_type,payload,created_at FROM task_events WHERE task_id=$1 ORDER BY created_at DESC LIMIT 100',[child.task_id])).rows;
   for(const event of events.reverse()){
    const type=event.payload?.type??event.event_type;
    if(!['progress','question','error'].includes(type))continue;
    const key=definitionDigest(event);if(observed.has(key))continue;observed.add(key);
    if(type==='progress')progressAt=Date.now();
    const action=await onAgentEvent({type,detail:event.payload,child_task_id:child.task_id,child_run_id:childRunId});
    if(action?.action==='abort')throw Object.assign(Error('activity_child_abort_unconfirmed'),{executionStopped:false});
   }
   if(Date.now()-progressAt>=60000&&Date.now()-stallAt>=60000){
    stallAt=Date.now();const action=await onAgentEvent({type:'stall',message:'60秒没有可验证进展',child_task_id:child.task_id,child_run_id:childRunId});
    if(action?.action==='abort')throw Object.assign(Error('activity_child_abort_unconfirmed'),{executionStopped:false});
   }
   if(Date.now()-heartbeatAt>=5000){heartbeatAt=Date.now();await onHeartbeat({stage:'waiting_child_readback',child_task_id:child.task_id,child_run_id:childRunId});}
   await wait(Math.min(pollMs,Math.max(1,deadline-Date.now())));
  }
  }catch(error){if(error.executionStopped!==true)error.executionStopped=false;throw error;}
  // 现役Bridge没有安全的停止RPC；不得假称CLI退出或重启下一Activity。
  throw Object.assign(Error(signal?.aborted?'activity_child_abort_unconfirmed':'activity_child_timeout_unconfirmed'),{executionStopped:false});
 };
}
