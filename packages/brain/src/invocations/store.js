/** tasks + 原有 routing receipt 为唯一调用账本；事务级锁防并发同键启动。 */
import { createRoutedTask } from '../work-routing-store.js';
import { resolveInvocation } from './resolve.js';
import { definitionDigest,requireCondition,uuid } from '../workflow-authoring/contracts.js';
import { validateSkillReceipt } from '../orchestrator/skill-activity-adapter.js';
import { canonicalInvocationTarget } from './candidate-target.js';
const KEY=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
export const publicResolution=({envelope:_envelope,plan:_plan,...result})=>result;
function tenantOf(task){return task.payload?.invocation?.tenant_id;}
export async function findInvocation(db,{taskId,requestKey,tenantId}){
  if(taskId)uuid(taskId,'task_id');else requireCondition(KEY.test(requestKey??''),'request_key 格式错误');
  const row=(await db.query(`SELECT * FROM tasks WHERE ${taskId?'id=$1':"payload->'invocation'->>'request_key'=$1"}
    AND payload->'invocation'->>'tenant_id'=$2 ORDER BY created_at DESC LIMIT 1`,[taskId??requestKey,tenantId])).rows[0];
  requireCondition(row&&tenantOf(row)===tenantId,'调用不存在',404);return row;
}
export async function invocationReadback(db,identity){
  const task=await findInvocation(db,identity),inv=task.payload.invocation;
  const runs=(await db.query('SELECT * FROM task_runs WHERE task_id=$1 ORDER BY started_at',[task.id])).rows;
  const events=(await db.query("SELECT event_type,payload,created_at FROM task_events WHERE task_id=$1 AND event_type LIKE 'invocation_%' ORDER BY created_at",[task.id])).rows;
  const runId=inv.dispatch?.run_id??task.payload.current_run_id??runs.at(-1)?.run_id??null;
  const evidence={runs: runs.map(r=>({id:r.id,run_id:r.run_id,status:r.status,context:r.context,result:r.result})),events};
  const gaps=[];let outputs=null,status=task.status;
  if(['completed','completed_no_pr'].includes(status)){
    try{
      const raw=task.result?.skill_invocation??task.payload.last_run_result?.result_summary;
      const receipt=validateSkillReceipt(inv.envelope,raw,task.id,runId);
      requireCondition(runs.some(r=>r.run_id===runId&&r.status==='success'
        &&r.context?.tenant_id===inv.tenant_id&&r.context?.input_sha256===inv.input_sha256
        &&r.context?.envelope_sha256===inv.envelope.envelope_sha256
        &&definitionDigest(r.context?.target)===definitionDigest(inv.target)),'运行账缺少匹配成功回执');
      requireCondition(events.some(e=>e.event_type==='invocation_result_verified'&&e.payload.run_id===runId),'调用证据事件缺失');
      outputs=receipt.outputs;status='completed';
    }catch{status='result_pending';gaps.push({code:'execution_evidence_incomplete'});}
  }
  if(inv.dispatch&&!runs.length)gaps.push({code:'run_ledger_missing'});
  return {task_id:task.id,status,target:inv.target,request_key:inv.request_key,run_id:runId,outputs,evidence,gaps,
    input_sha256:inv.input_sha256,envelope_sha256:inv.envelope.envelope_sha256,mode:inv.mode};
}
export async function invoke(db,body,tenantId='default',options={}){
  requireCondition(KEY.test(body.request_key??''),'request_key 格式错误');
  const canonicalTarget=await canonicalInvocationTarget(db,body,tenantId);
  const requestHash=definitionDigest({target:canonicalTarget,input:body.input,mode:body.mode,authoring_task_id:body.authoring_task_id??null,compose_sha256:body.compose_sha256??null});
  const client=await db.connect();
  try{
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`invocation:${tenantId}:${body.request_key}`]);
    const existing=(await client.query("SELECT * FROM tasks WHERE payload->'invocation'->>'tenant_id'=$1 AND payload->'invocation'->>'request_key'=$2 LIMIT 1",[tenantId,body.request_key])).rows[0];
    if(existing){
      requireCondition(existing.payload.invocation.request_sha256===requestHash,'同一 request_key 已绑定其他版本或输入',409);
      await client.query('COMMIT');return {task_id:existing.id,status:existing.status,target:existing.payload.invocation.target,deduplicated:true};
    }
    const resolution=await resolveInvocation(client,body,tenantId,options);
    if(resolution.readiness!=='ready'){
      const error=Object.assign(new Error('调用前置条件尚不满足'),{status:409,code:'INVOCATION_BLOCKED',resolution:publicResolution(resolution)});throw error;
    }
    const invocation={protocol:'invocation-request-v1',tenant_id:tenantId,request_key:body.request_key,
      request_sha256:requestHash,target:resolution.target,mode:body.mode,input_sha256:definitionDigest(body.input),
      envelope:resolution.envelope,operator:options.operator??'internal-operator'};
    const routed=await (options.createTask??createRoutedTask)(client,{
      source:'api',source_id:`invocation:${tenantId}:${body.request_key}`,title:`调用 ${resolution.target.kind} ${resolution.target.id} [${tenantId}:${body.request_key}]`,
      description:'执行服务端固定纯 Skill 快照并返回结构化产物',mutation_intent:'none',declared_domain:'research',artifact_kind:'execution',requested_task_type:'research',
      task:{status:'queued',payload:{tenant_id:tenantId,invocation},phase:'exploratory',delivery_type:'artifact'},
    },null,{transaction:'existing'});
    await client.query("INSERT INTO task_events(task_id,event_type,payload) VALUES($1,'invocation_accepted',$2::jsonb)",[routed.task_id,JSON.stringify({actor:invocation.operator,tenant_id:tenantId,target:resolution.target,input_sha256:invocation.input_sha256,envelope_sha256:resolution.envelope.envelope_sha256})]);
    await client.query('COMMIT');return {task_id:routed.task_id,status:routed.task.status,target:resolution.target};
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally{client.release();}
}
