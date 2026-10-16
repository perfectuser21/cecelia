/** 单一有界推进器：HTTP首次触发，现有reconcile scheduler恢复；不执行CLI、不另建poller。 */
import {beginRevalidation,authoringRequestKey} from './revalidation.js';
import {budgetDatabase} from './query-budget.js';
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
 requireCondition((row.status==='in_progress'&&row.claimed_by||row.status==='completed'&&row.result?.workflow_assembly_reconcile?.revalidation_request),'authoring_authority_revoked',409);
 requireCondition(row.result?.workflow_authoring?.request?.execution_protocol===EXECUTION_PROTOCOL,'execution_protocol_required',409);
 await requireCandidateEnvironment(db);return row;
}
async function recordInvocation(pool,id,definitionSha,input,ref,tenantId,expectedAttempt){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');const row=(await client.query('SELECT id,tenant_id,status,claimed_by,payload,result FROM tasks WHERE id=$1 FOR UPDATE',[id])).rows[0];
  requireCondition((row?.status==='in_progress'&&row.claimed_by||row?.status==='completed'&&row.result?.workflow_assembly_reconcile?.revalidation_request)&&(row.payload?.tenant_id??'default')===tenantId&&(!row.tenant_id||row.tenant_id===tenantId),'authoring_authority_revoked',409);
  requireCondition(row.payload?.workflow_authoring===true&&row.result.workflow_authoring.request.execution_protocol===EXECUTION_PROTOCOL&&row.result.workflow_authoring.outputs.compose.definition_sha256===definitionSha&&definitionDigest(row.result.workflow_authoring.request.validation_input)===definitionDigest(input),'定义或输入已变化',409);
  const prior=row.result.workflow_authoring_execution;
  requireCondition((prior?.attempt_id??null)===expectedAttempt,'revalidation_attempt_changed',409);
  requireCondition(!prior||prior.protocol===EXECUTION_PROTOCOL&&prior.tenant_id===tenantId&&prior.definition_sha256===definitionSha&&prior.input_sha256===definitionDigest(input),'候选输入已固定，不能覆盖',409);
  const state=prior??{protocol:EXECUTION_PROTOCOL,definition_sha256:definitionSha,tenant_id:tenantId,input,input_sha256:definitionDigest(input),invocations:[]};
  if(!state.invocations.some(v=>v.task_id===ref.task_id))state.invocations.push(ref);
  await client.query("UPDATE tasks SET result=COALESCE(result,'{}'::jsonb)||jsonb_build_object('workflow_authoring_execution',$2::jsonb) WHERE id=$1",[id,JSON.stringify(state)]);
  await client.query('COMMIT');return state;
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}
async function enqueue(pool,row,kind,slotKey,input,options){
 const id=row.id,state=row.result.workflow_authoring,digest=state.outputs.compose.definition_sha256,tenantId=options.tenantId;
 const target=kind==='workflow'?{kind,id}:candidateSlotTarget({authoringTaskId:id,composeSha256:digest,slotKey,tenantId});
 const attemptId=row.result.workflow_authoring_execution?.attempt_id??null;
 const requestKey=authoringRequestKey({authoringTaskId:id,definitionSha256:digest,kind,slotKey,input,attemptId});
 await control(pool,id,tenantId);
 const accepted=await invoke(pool,{mode:'candidate',authoring_task_id:id,compose_sha256:digest,target,input,request_key:requestKey},tenantId,{...options,...options.invocationOptions});
 return recordInvocation(pool,id,digest,state.request.validation_input,{task_id:accepted.task_id,kind,slot_key:slotKey??null,request_key:requestKey},tenantId,attemptId);
}
export async function advanceAuthoringAssembly(pool,authoringTaskId,options={}){
 const tenantId=options.tenantId??'default',deadline=options.deadline??Date.now()+15000;
 pool=budgetDatabase(pool,{deadline,signal:options.signal});
 const check=()=>requireCondition(!options.signal?.aborted&&Date.now()<deadline,'readiness_deadline_exceeded',503);
 try{
  check();let row=await control(pool,authoringTaskId,tenantId);
  if(row.result?.workflow_assembly_reconcile?.revalidation_request)row=await beginRevalidation(pool,row,tenantId);
  let state=row.result.workflow_authoring;
  if(state.stage==='completed'){const current=await readAuthoringReadiness(pool,row.id,{...options,...options.invocationOptions,tenantId,deadline});
   return current.qualified?{status:'completed',qualification:current.test_qualification}:{status:'blocked',gaps:current.gaps.length?current.gaps:[{code:'test_qualification_stale'}]};}
  if(state.stage==='build'){
   const digest=state.outputs.compose.definition_sha256;
   await submitAuthoring(pool,authoringTaskId,{stage:'build',revision:state.revision,submission_id:`auto-build:${digest}`,output:{reuse_only:true,implementation_task_ids:[],evidence_refs:[`git:${state.outputs.compose.definition.source.revision}`]}},
    {validateDefinition,validateReferences,registerWorkflow,freezeOptions:{...options.freezeOptions,deadline,signal:options.signal}});
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
  if(['failed','cancelled'].includes(ledger.task.status))return {status:'blocked',gaps:[{code:ledger.task.status==='failed'?'candidate_execution_failed':'authoring_authority_revoked',task_id:ledger.task.id}],task_ids:execution.invocations.map(v=>v.task_id)};
  if(!['completed','completed_no_pr'].includes(ledger.task.status))return {status:'awaiting_execution',task_ids:execution.invocations.map(v=>v.task_id)};
  const verified=verifyInvocationLedger(ledger,{requireSpans:true});
  for(const slot of owner.slots)if(!execution.invocations.some(v=>v.kind==='activity'&&v.slot_key===slot.slot_key)){
   check();execution=await enqueue(pool,row,'activity',slot.slot_key,verified.slot_inputs.find(v=>v.key===slot.slot_key).input,{...options,tenantId});
  }
  for(const ref of execution.invocations){const current=(await pool.query('SELECT status,payload FROM tasks WHERE id=$1',[ref.task_id])).rows[0];
   if(['failed','cancelled'].includes(current?.status))return {status:'blocked',gaps:[{code:current.status==='failed'?'candidate_execution_failed':'authoring_authority_revoked',task_id:ref.task_id}]};
   if(!['queued','in_progress','dispatched','completed','completed_no_pr'].includes(current?.status))return {status:'result_pending',gaps:[{code:'candidate_execution_result_unknown',task_id:ref.task_id}]};}
  check();const readiness=await readAuthoringReadiness(pool,row.id,{...options,...options.invocationOptions,tenantId,deadline});
  if(readiness.status!=='verified')return {status:'awaiting_execution',task_ids:execution.invocations.map(v=>v.task_id),gaps:readiness.gaps};
  const deps={validateDefinition,validateReferences,registerWorkflow,internalRevalidation:true,invocationOptions:{...options,...options.invocationOptions,deadline}};
  row=await control(pool,authoringTaskId,tenantId);state=row.result.workflow_authoring;
  if(state.stage==='verify'){
   check();await submitAuthoring(pool,row.id,{stage:'verify',revision:state.revision,submission_id:`auto-verify:${readiness.proof_sha256}`,output:{validation_task_id:workflowRef.task_id}},deps);
   row=await control(pool,authoringTaskId,tenantId);state=row.result.workflow_authoring;
  }
  check();const registered=await submitAuthoring(pool,row.id,{stage:'register',revision:state.revision,submission_id:`auto-register:${readiness.proof_sha256}`,output:{}},deps);
  return {status:'completed',qualification:registered.state.outputs.register};
 }catch(error){return {status:'blocked',gaps:[{code:error.code==='WORKFLOW_AUTHORING_INVALID'?error.message:error.code??'authoring_advance_failed'}]};}
}
