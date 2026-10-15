/** 复用现有派发/回执进程；未知派发不重发，回执先核身份和结构再允许完成。 */
import { definitionDigest, requireCondition } from '../workflow-authoring/contracts.js';
import { assertSkillEnvelope,validateSkillReceipt,invocationPrompt } from '../orchestrator/skill-activity-adapter.js';
import { probeInvocationRuntime } from './resolve.js';
import { startRun } from '../lib/task-run.js';
import { normalizeCallbackStatus } from '../lib/callback-utils.js';
export function invocationBridgeRequired(task){
  if(!task?.payload?.invocation)return false;
  requireCondition(task.task_type==='research','调用任务类型与固定transport不匹配',409);
  return true;
}
export async function assertInvocationAuthority(db,inv,{probeRuntime=probeInvocationRuntime}={}){
  const e=inv.envelope;assertSkillEnvelope(e);
  requireCondition(e.tenant_id===inv.tenant_id&&definitionDigest(e.target)===definitionDigest(inv.target),'调用租户或目标不匹配');
  if(e.mode==='candidate'){
    const row=(await db.query('SELECT payload,result,status FROM tasks WHERE id=$1',[e.authoring_task_id])).rows[0];
    requireCondition(row?.payload?.workflow_authoring===true&&(row.payload.tenant_id??'default')===e.tenant_id
      &&!['cancelled','failed'].includes(row.status)
      &&definitionDigest(row.result?.workflow_authoring?.outputs?.compose?.definition)===e.compose_sha256,'候选授权或组装摘要已撤销',409);
  }else{
    requireCondition(e.release_id&&(await (await import('../lib/release-index.js')).getReleaseGate(db,e.release_id)).deployed,'发布资格已失效',409);
  }
  const ids=e.activities.map(a=>a.implementation.skill_id).filter(Boolean);
  const active=ids.length?(await db.query("SELECT id FROM skill_registry WHERE id=ANY($1::uuid[]) AND status='active'",[ids])).rows:[];
  requireCondition(ids.every(id=>active.some(a=>a.id===id)),'Skill 已停用',409);
  const dependencies=e.activities.flatMap(a=>a.warehouse_dependencies??[]);
  if(dependencies.length){
    const live=(await db.query('SELECT id FROM warehouse_items WHERE id=ANY($1::uuid[]) AND active',[dependencies.map(d=>d.item_id)])).rows;
    requireCondition(dependencies.every(d=>live.some(v=>v.id===d.item_id)),'仓库资源已停用',409);
  }
  requireCondition((await probeRuntime()).ready,'执行体离线或资源不足',409);
}
export async function prepareInvocationDispatch(db,task,proposedRunId,options={}){
  if(!task.payload?.invocation)return null;
  const client=await db.connect();
  try{
    await client.query('BEGIN');
    const row=(await client.query('SELECT id,payload,status FROM tasks WHERE id=$1 FOR UPDATE',[task.id])).rows[0];
    const inv=row?.payload?.invocation;requireCondition(inv,'调用记录缺失',409);
    if(inv.dispatch){await client.query('COMMIT');return {runId:inv.dispatch.run_id,already:true};}
    requireCondition(['queued','in_progress','dispatched'].includes(row.status),'调用不是可执行状态',409);
    await assertInvocationAuthority(client,inv,options);
    const run=await startRun({taskId:task.id,runId:proposedRunId,source:'skill-invocation',context:{tenant_id:inv.tenant_id,target:inv.target,input_sha256:inv.input_sha256,envelope_sha256:inv.envelope.envelope_sha256}},{pool:client});
    requireCondition(run?.id,'运行账不可写，禁止派发',503);
    const dispatch={run_id:proposedRunId,at:new Date().toISOString(),state:'submitted_or_unknown'};
    await client.query("UPDATE tasks SET payload=jsonb_set(payload,'{invocation,dispatch}',$2::jsonb),updated_at=NOW() WHERE id=$1",[task.id,JSON.stringify(dispatch)]);
    await client.query("INSERT INTO task_events(task_id,event_type,payload) VALUES($1,'invocation_dispatch_reserved',$2::jsonb)",[task.id,JSON.stringify({actor:'brain',run_id:proposedRunId,target:inv.target,tenant_id:inv.tenant_id,input_sha256:inv.input_sha256,envelope_sha256:inv.envelope.envelope_sha256})]);
    await client.query('COMMIT');return {runId:proposedRunId,already:false,envelope:inv.envelope};
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally{client.release();}
}
export function invocationTaskPrompt(task,runId){
  return task.payload?.invocation?invocationPrompt(task.payload.invocation.envelope,task.id,runId):null;
}
export async function guardInvocationCallback(db,{task_id,run_id,status,result}){
  const row=(await db.query('SELECT id,payload,status FROM tasks WHERE id=$1',[task_id])).rows[0];
  const inv=row?.payload?.invocation;if(!inv)return null;
  requireCondition(run_id&&inv.dispatch?.run_id===run_id,'调用 run 身份不匹配',409);
  if(!['completed','completed_no_pr'].includes(normalizeCallbackStatus(status)))return null;
  const receipt=validateSkillReceipt(inv.envelope,result,task_id,run_id);
  // 结构合法的真实执行回执进入原任务及事件账；相同回执重放不覆盖结果。
  const client=await db.connect();
  try{
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`invocation-result:${task_id}:${run_id}`]);
    const prior=(await client.query("SELECT payload FROM task_events WHERE task_id=$1 AND event_type='invocation_result_verified' AND payload->>'run_id'=$2 LIMIT 1",[task_id,run_id])).rows[0];
    const digest=definitionDigest(receipt);
    if(prior)requireCondition(prior.payload.receipt_sha256===digest,'同一 run 回执内容冲突',409);
    else{
      await client.query("UPDATE tasks SET result=COALESCE(result,'{}'::jsonb)||jsonb_build_object('skill_invocation',$2::jsonb) WHERE id=$1",[task_id,JSON.stringify(receipt)]);
      for(const activity of receipt.activities)await client.query("INSERT INTO task_events(task_id,event_type,payload) VALUES($1,'invocation_activity_completed',$2::jsonb)",[task_id,JSON.stringify({actor:'codex-bridge',run_id,tenant_id:inv.tenant_id,target:inv.target,input_sha256:inv.input_sha256,...activity})]);
      await client.query("INSERT INTO task_events(task_id,event_type,payload) VALUES($1,'invocation_result_verified',$2::jsonb)",[task_id,JSON.stringify({actor:'brain',run_id,tenant_id:inv.tenant_id,target:inv.target,input_sha256:inv.input_sha256,envelope_sha256:inv.envelope.envelope_sha256,receipt_sha256:digest})]);
    }
    await client.query('COMMIT');return receipt;
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally{client.release();}
}
