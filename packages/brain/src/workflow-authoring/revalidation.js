import {definitionDigest,requireCondition} from './contracts.js';
import {EXECUTION_PROTOCOL,readCandidateOwner} from './assembly-orchestration.js';
const same=(a,b)=>definitionDigest(a)===definitionDigest(b);
/** 只消费服务器原task的修复状态，浏览器参数不能授予新执行轮次。 */
export function validateRevalidationRequest(row,owner,tenantId){
 const state=row.result.workflow_authoring,reconcile=row.result.workflow_assembly_reconcile,request=reconcile?.revalidation_request;
 if(!request)return null;
 const fail=condition=>requireCondition(condition,'revalidation_authority_mismatch',409);
 fail(reconcile.protocol==='workflow-assembly-reconcile-v1'&&Number.isSafeInteger(reconcile.repair_sequence)&&reconcile.repair_sequence>0);
 fail(request.protocol==='workflow-authoring-revalidation-v1'&&request.tenant_id===tenantId&&request.authoring_task_id===row.id
  &&request.definition_sha256===state.outputs.compose.definition_sha256&&request.input_sha256===definitionDigest(state.request.validation_input)&&same(request.candidate_owner,owner));
 const repaired=Object.values(reconcile.issues??{}).filter(i=>i.repaired_at&&i.definition_sha256===request.definition_sha256
  &&i.target_version===`candidate:${request.definition_sha256}`&&Number(i.repaired_at)===new Date(request.requested_at).getTime());
 fail(repaired.length>0&&request.gap_id===definitionDigest(repaired.map(i=>i.key).sort()));
 const {tenant_id,authoring_task_id,definition_sha256,input_sha256,candidate_owner,gap_id,repair_id}=request;
 fail(repair_id===definitionDigest({protocol:'workflow-assembly-repair-v1',tenant_id,authoring_task_id,definition_sha256,input_sha256,candidate_owner,gap_id,sequence:reconcile.repair_sequence}));
 fail(request.attempt_id===definitionDigest({protocol:request.protocol,tenant_id,authoring_task_id,definition_sha256,input_sha256,candidate_owner,gap_id,repair_id}));
 return request;
}
export async function beginRevalidation(pool,row,tenantId){
 const definition=row.result.workflow_authoring.outputs.compose.definition;
 const owner=await readCandidateOwner(pool,row.id,definition,tenantId),request=validateRevalidationRequest(row,owner,tenantId);
 if(!request||row.result.workflow_authoring_execution?.attempt_id===request.attempt_id)return row;
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const fresh=(await client.query('SELECT * FROM tasks WHERE id=$1 FOR UPDATE',[row.id])).rows[0];
  requireCondition(fresh&&(fresh.payload?.tenant_id??'default')===tenantId&&(!fresh.tenant_id||fresh.tenant_id===tenantId)
   &&(fresh.status==='completed'||fresh.status==='in_progress'&&fresh.claimed_by),'authoring_authority_revoked',409);
  const currentOwner=await readCandidateOwner(client,row.id,definition,tenantId),current=validateRevalidationRequest(fresh,currentOwner,tenantId);
  requireCondition(current?.attempt_id===request.attempt_id,'revalidation_authority_mismatch',409);
  if(fresh.result.workflow_authoring_execution?.attempt_id===request.attempt_id){await client.query('COMMIT');return fresh;}
  const state=fresh.result.workflow_authoring;
  const event=(await client.query("INSERT INTO task_events(task_id,event_type,payload) VALUES($1,'authoring_revalidation_started',$2) RETURNING id",[row.id,{actor:'brain',request,
   previous_execution:fresh.result.workflow_authoring_execution??null,previous_verify:state.outputs.verify??null,previous_qualification:state.outputs.register??null}])).rows[0];
  delete state.outputs.verify;delete state.outputs.register;state.stage='verify';state.revision++;
  const execution={protocol:EXECUTION_PROTOCOL,tenant_id:tenantId,definition_sha256:request.definition_sha256,input:state.request.validation_input,
   input_sha256:request.input_sha256,attempt_id:request.attempt_id,previous_event_id:event.id,invocations:[]};
  fresh.result={...fresh.result,workflow_authoring:state,workflow_authoring_execution:execution};
  await client.query('UPDATE tasks SET result=$2,updated_at=NOW() WHERE id=$1',[row.id,fresh.result]);await client.query('COMMIT');return fresh;
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}

export function authoringRequestKey({authoringTaskId,definitionSha256,kind,slotKey,input,attemptId=null}){
 return `authoring:${authoringTaskId}:${definitionDigest({digest:definitionSha256,kind,slotKey:slotKey??null,input,attempt_id:attemptId}).slice(0,40)}`;
}
