/** 单一有界推进器：HTTP首次触发，现有reconcile scheduler恢复；不执行CLI、不另建poller。 */
import {definitionDigest,requireCondition} from './contracts.js';
import {EXECUTION_PROTOCOL,requireCandidateEnvironment,readCandidateOwner} from './assembly-orchestration.js';
import {submitAuthoring} from './store.js';
import {validateDefinition,validateReferences,registerWorkflow} from './registration.js';
import {invoke} from '../invocations/store.js';
import {readInvocationLedger,readAuthoringReadiness} from './execution-proof.js';
import {verifyInvocationLedger} from './execution-ledger.js';
import {candidateSlotTarget} from '../invocations/candidate-target.js';
async function control(db,id,tenantId){
 const row=(await db.query('SELECT id,tenant_id,status,claimed_by,payload,result FROM tasks WHERE id=$1',[id])).rows[0];
 requireCondition(row?.payload?.workflow_authoring===true&&(row.payload.tenant_id??'default')===tenantId
  &&(!row.tenant_id||row.tenant_id===tenantId),'readiness_identity_mismatch',404);
 requireCondition(row.status==='in_progress'&&row.claimed_by,'authoring_authority_revoked',409);
 requireCondition(row.result?.workflow_authoring?.request?.execution_protocol===EXECUTION_PROTOCOL,'execution_protocol_required',409);
 await requireCandidateEnvironment(db);return row;
}
async function recordInvocation(pool,id,definitionSha,input,ref){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');const row=(await client.query('SELECT result FROM tasks WHERE id=$1 FOR UPDATE',[id])).rows[0];
  requireCondition(row.result.workflow_authoring.outputs.compose.definition_sha256===definitionSha,'定义已变化',409);
  const prior=row.result.workflow_authoring_execution;
  requireCondition(!prior||prior.definition_sha256===definitionSha&&prior.input_sha256===definitionDigest(input),'候选输入已固定，不能覆盖',409);
  const state=prior??{protocol:EXECUTION_PROTOCOL,definition_sha256:definitionSha,tenant_id:'default',input,input_sha256:definitionDigest(input),invocations:[]};
  if(!state.invocations.some(v=>v.task_id===ref.task_id))state.invocations.push(ref);
  await client.query("UPDATE tasks SET result=COALESCE(result,'{}'::jsonb)||jsonb_build_object('workflow_authoring_execution',$2::jsonb) WHERE id=$1",[id,JSON.stringify(state)]);
  await client.query('COMMIT');return state;
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}
async function enqueue(pool,row,kind,slotKey,input,options){
 const id=row.id,state=row.result.workflow_authoring,digest=state.outputs.compose.definition_sha256,tenantId=options.tenantId;
 const target=kind==='workflow'?{kind,id}:candidateSlotTarget({authoringTaskId:id,composeSha256:digest,slotKey,tenantId});
 const requestKey=`authoring:${id}:${definitionDigest({digest,kind,slotKey:slotKey??null,input}).slice(0,40)}`;
 const accepted=await invoke(pool,{mode:'candidate',authoring_task_id:id,compose_sha256:digest,target,input,request_key:requestKey},tenantId,options.invocationOptions??options);
 return recordInvocation(pool,id,digest,state.request.validation_input,{task_id:accepted.task_id,kind,slot_key:slotKey??null,request_key:requestKey});
}
export async function advanceAuthoringAssembly(pool,authoringTaskId,options={}){
 const tenantId=options.tenantId??'default',deadline=options.deadline??Date.now()+15000;
 const check=()=>requireCondition(!options.signal?.aborted&&Date.now()<deadline,'readiness_deadline_exceeded',503);
 try{
  check();let row=await control(pool,authoringTaskId,tenantId),state=row.result.workflow_authoring;
  if(state.stage==='completed')return {status:'completed',qualification:state.outputs.register};
  if(state.stage==='build'){
   const digest=state.outputs.compose.definition_sha256;
   await submitAuthoring(pool,authoringTaskId,{stage:'build',revision:state.revision,submission_id:`auto-build:${digest}`,output:{reuse_only:true,implementation_task_ids:[],evidence_refs:[`git:${state.outputs.compose.definition.source.revision}`]}},
    {validateDefinition,validateReferences,registerWorkflow,freezeOptions:{...options.freezeOptions,deadline}});
   check();row=await control(pool,authoringTaskId,tenantId);state=row.result.workflow_authoring;
  }
  if(state.stage!=='verify'&&state.stage!=='register')return {status:'blocked',gaps:[{code:'compose_required'}]};
  const owner=await readCandidateOwner(pool,row.id,state.outputs.compose.definition,tenantId);
  requireCondition(owner,'candidate_owner_missing',409);
  requireCondition(state.request.validation_input&&typeof state.request.validation_input==='object','validation_input_missing');
  if(owner.slots.some(s=>s.steps.length))return {status:'blocked',gaps:[{code:'step_execution_unverified'}]};
  let execution=row.result.workflow_authoring_execution;
  if(!execution?.invocations?.some(v=>v.kind==='workflow')){
   check();execution=await enqueue(pool,row,'workflow',null,state.request.validation_input,{...options,tenantId});
  }
  const workflowRef=execution.invocations.find(v=>v.kind==='workflow'),ledger=await readInvocationLedger(pool,workflowRef.task_id);
  if(!['completed','completed_no_pr'].includes(ledger.task.status))return {status:'awaiting_execution',task_ids:execution.invocations.map(v=>v.task_id)};
  const verified=verifyInvocationLedger(ledger,{requireSpans:true});
  for(const slot of owner.slots)if(!execution.invocations.some(v=>v.kind==='activity'&&v.slot_key===slot.slot_key)){
   check();execution=await enqueue(pool,row,'activity',slot.slot_key,verified.slot_inputs.find(v=>v.key===slot.slot_key).input,{...options,tenantId});
  }
  check();const readiness=await readAuthoringReadiness(pool,row.id,{...options,...options.invocationOptions,tenantId,deadline});
  if(readiness.status!=='verified')return {status:'awaiting_execution',task_ids:execution.invocations.map(v=>v.task_id),gaps:readiness.gaps};
  return {status:'verified',readiness};
 }catch(error){return {status:'blocked',gaps:[{code:error.code==='WORKFLOW_AUTHORING_INVALID'?error.message:error.code??'authoring_advance_failed'}]};}
}
