import {validateRevalidationRequest,authoringRequestKey} from './revalidation.js';
import {budgetDatabase} from './query-budget.js';
import {definitionDigest,uuid,requireCondition} from './contracts.js';
import {EXECUTION_PROTOCOL,readCandidateOwner,requireCandidateEnvironment} from './assembly-orchestration.js';
import {verifyInvocationLedger} from './execution-ledger.js';
import {candidateSlotTarget} from '../invocations/candidate-target.js';
import {resolveInvocation} from '../invocations/resolve.js';
import {readinessAdmission} from './readiness-admission.js';
const fail=code=>{throw Object.assign(Error(code),{code});};
const same=(a,b)=>definitionDigest(a)===definitionDigest(b);
async function snapshot(pool,options,action){
 const deadline=options.deadline??Date.now()+15000;
 const check=()=>{if(options.signal?.aborted||Date.now()>=deadline)fail('readiness_deadline_exceeded');};
 if(options.transactionClient)return action({query:(...args)=>options.transactionClient.query(...args),authorityLock:true},check);
 check();const client=await budgetDatabase(pool,{deadline,signal:options.signal}).connect();
 try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const db={query:async(sql,args)=>{
   check();await client.query("SELECT set_config('statement_timeout',$1,true)",[String(Math.max(1,deadline-Date.now()))]);
   const value=await client.query({text:sql,values:args,query_timeout:Math.max(1,deadline-Date.now())});check();return value;
  }};
  let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error('readiness deadline'),{code:'readiness_deadline_exceeded'})),Math.max(1,deadline-Date.now()));});
  let value;try{value=await Promise.race([action(db,check),timeout]);}finally{clearTimeout(timer);}
  check();await client.query('COMMIT');return value;
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
 finally{client.release();}
}
export async function readInvocationLedger(db,taskId){
 const task=(await db.query('SELECT * FROM tasks WHERE id=$1',[taskId])).rows[0];
 requireCondition(task?.payload?.invocation,'调用任务不存在',404);
 const runId=task.payload.invocation.dispatch?.run_id;
 const runs=(await db.query('SELECT * FROM task_runs WHERE task_id=$1 ORDER BY started_at',[taskId])).rows;
 const events=(await db.query("SELECT event_type,payload,created_at FROM task_events WHERE task_id=$1 AND event_type LIKE 'invocation_%' ORDER BY created_at,event_type,payload::text",[taskId])).rows;
 const spans=runId?(await db.query('SELECT * FROM spans WHERE run_id=$1 ORDER BY started_at,id',[runId])).rows:[];
 return {task,runs,events,spans};
}
async function proofInSnapshot(db,{authoringTaskId,tenantId='default',definitionSha256,invocationTaskIds},base){
 uuid(authoringTaskId,'authoringTaskId');
 const row=(await db.query('SELECT id,tenant_id,status,payload,result FROM tasks WHERE id=$1',[authoringTaskId])).rows[0];
 if(!row||row.payload?.workflow_authoring!==true||(row.payload.tenant_id??'default')!==tenantId
  ||row.tenant_id&&row.tenant_id!==tenantId)fail('readiness_identity_mismatch');
 const state=row.result?.workflow_authoring;
 if(state?.request?.execution_protocol!==EXECUTION_PROTOCOL)fail('execution_protocol_required');
 if(row.status==='failed'||row.status==='cancelled')fail('authoring_authority_revoked');
 await requireCandidateEnvironment(db);
 const definition=state.outputs?.compose?.definition;
 if(!definition)fail('compose_definition_missing');
 const digest=definitionDigest(definition);base.definition_sha256=digest;base.target_version=`candidate:${digest}`;
 if(definitionSha256&&definitionSha256!==digest)fail('definition_changed');
 const owner=await readCandidateOwner(db,authoringTaskId,definition,tenantId);
 if(!owner)fail('candidate_owner_missing');base.candidate_owner=owner;
 const execution=row.result.workflow_authoring_execution;
 if(!execution||execution.protocol!==EXECUTION_PROTOCOL||execution.definition_sha256!==digest
  ||execution.tenant_id!==tenantId||definitionDigest(execution.input)!==execution.input_sha256||!same(execution.input,state.request.validation_input))fail('candidate_execution_missing');
 const revalidation=validateRevalidationRequest(row,owner,tenantId);
 if(revalidation?.attempt_id!==execution.attempt_id&&(revalidation||execution.attempt_id))fail('revalidation_required');
 const refs=execution.invocations;
 if(!Array.isArray(refs)||refs.length!==definition.activities.length+1||new Set(refs.map(r=>r.task_id)).size!==refs.length)fail('candidate_execution_coverage_missing');
 if(invocationTaskIds&&!same(invocationTaskIds,refs.map(r=>r.task_id)))fail('candidate_execution_identity_mismatch');
 const ledgers=[];
 for(const ref of refs){
  uuid(ref.task_id,'invocation_task_id');const ledger=await readInvocationLedger(db,ref.task_id),inv=ledger.task.payload.invocation,e=inv.envelope;
  if(inv.tenant_id!==tenantId||ledger.task.tenant_id&&ledger.task.tenant_id!==tenantId
   ||e.authoring_task_id!==authoringTaskId||e.compose_sha256!==digest||inv.mode!=='candidate')fail('candidate_execution_identity_mismatch');
  const expected=ref.kind==='workflow'?{kind:'workflow',id:authoringTaskId,definition_version_id:`candidate:${digest}`}:
   candidateSlotTarget({authoringTaskId,composeSha256:digest,slotKey:ref.slot_key,tenantId});
  const expectedKey=authoringRequestKey({authoringTaskId,definitionSha256:digest,kind:ref.kind,slotKey:ref.slot_key,input:e.input,attemptId:execution.attempt_id??null});
  if(!same(expected,e.target)||inv.request_key!==ref.request_key||ref.request_key!==expectedKey)fail('candidate_execution_identity_mismatch');
  const trace={...owner,slots:ref.kind==='workflow'?owner.slots:owner.slots.filter(s=>s.slot_key===ref.slot_key)};
  if(!same(e.candidate_trace??null,trace))fail('candidate_frozen_trace_mismatch');
  if(trace.slots.some(s=>s.steps.length))fail('step_execution_unverified');
  if(revalidation&&ledger.runs.some(r=>new Date(r.started_at).getTime()<new Date(revalidation.requested_at).getTime()))fail('revalidation_run_stale');
  const verified=verifyInvocationLedger(ledger,{requireSpans:true});ledgers.push({ref,ledger,verified});
 }
 const skillIds=[...new Set(ledgers.flatMap(v=>v.ledger.task.payload.invocation.envelope.activities.map(a=>a.implementation.skill_id)))];
 const skills=(await db.query(`SELECT id,status FROM skill_registry WHERE id=ANY($1::uuid[])${db.authorityLock?' FOR SHARE':''}`,[skillIds])).rows;
 if(skills.length!==skillIds.length||skills.some(s=>s.status!=='active'))fail('skill_authority_revoked');
 const resourceKeys=[...new Set(definition.activities.flatMap(a=>(a.warehouse_dependencies??[]).map(r=>r.key)))];
 if(resourceKeys.length){const resources=(await db.query(`SELECT key,active FROM warehouse_items WHERE key=ANY($1::text[])${db.authorityLock?' FOR SHARE':''}`,[resourceKeys])).rows;
  if(resources.length!==resourceKeys.length||resources.some(r=>!r.active))fail('resource_authority_revoked');}
 const workflows=ledgers.filter(v=>v.ref.kind==='workflow');
 if(workflows.length!==1||!same(workflows[0].ledger.task.payload.invocation.envelope.input,execution.input))fail('workflow_execution_missing');
 for(const slot of owner.slots){
  const selected=ledgers.filter(v=>v.ref.kind==='activity'&&v.ref.slot_key===slot.slot_key);
  const expectedInput=workflows[0].verified.slot_inputs.find(v=>v.key===slot.slot_key);
  if(selected.length!==1||!expectedInput||selected[0].verified.input_sha256!==expectedInput.input_sha256)fail('activity_execution_input_mismatch');
  const workflowOutput=workflows[0].verified.activities.find(a=>a.key===slot.slot_key)?.outputs;
  if(!same(selected[0].verified.activities[0].outputs,workflowOutput))fail('activity_execution_output_mismatch');
 }
 base.evidence={tasks:ledgers.map(v=>v.verified.task_id),runs:ledgers.map(v=>v.verified.run_id),
  events:ledgers.flatMap(v=>v.ledger.events),spans:ledgers.flatMap(v=>v.ledger.spans),outputs:ledgers.map(v=>v.verified)};
 base.latest_run_finished_at=new Date(Math.max(...ledgers.map(v=>new Date(v.ledger.runs.find(r=>r.run_id===v.verified.run_id).ended_at).getTime()))).toISOString();
 base.verification_at=base.latest_run_finished_at;
 return {row,state,definition,execution,ledgers};
}
async function readProof(pool,identity,options,readiness){
 options=readinessAdmission(options);
 let qualification;
 const base={protocol:EXECUTION_PROTOCOL,status:'blocked',gaps:[],tenant_id:identity.tenantId??'default',
  definition_sha256:null,target_version:null,verification_id:null,resource_condition:'unknown',candidate_owner:null,evidence:{tasks:[],runs:[],events:[],spans:[],outputs:[]}};
 try{
  await snapshot(pool,options,async(db,check)=>{
   const value=await proofInSnapshot(db,identity,base);qualification=value.state.outputs?.register?.test_qualification;
   if(readiness)for(const item of value.ledgers){
    check();const e=item.ledger.task.payload.invocation.envelope;
    const sourceOptions=options;
    const resolution=await resolveInvocation(db,{mode:'candidate',authoring_task_id:identity.authoringTaskId,compose_sha256:base.definition_sha256,target:e.target,input:e.input},base.tenant_id,sourceOptions);
    check();if(resolution.readiness!=='ready'){
     base.gaps.push(...resolution.gaps);base.resource_condition=resolution.gaps.some(g=>g.code==='transport_resource_unavailable')?'safe_stop':'unknown';
    }else if(!same(resolution.envelope,e))fail('implementation_or_authority_changed');
   }
  });
  if(!base.gaps.length){base.status='verified';if(readiness)base.resource_condition='ready';}
 }catch(error){base.gaps.push({code:error.code==='57014'?'readiness_deadline_exceeded':error.code??'execution_evidence_unverified'});}
 base.evidence=JSON.parse(JSON.stringify(base.evidence));
 const {resource_condition:_resource,gaps:_gaps,verification_id:_id,...stable}=base;
 base.proof_sha256=definitionDigest(stable);base.verification_id=base.status==='verified'?base.proof_sha256:null;
 const q=qualification;
 base.qualified=base.status==='verified'&&q?.protocol===EXECUTION_PROTOCOL&&q.status==='verified'&&q.formal_release===false
  &&q.tenant_id===base.tenant_id&&q.proof_sha256===base.proof_sha256&&same(q.candidate_owner,base.candidate_owner);
 base.test_qualification=base.qualified?q:null;
 return base;
}
export async function readAuthoringExecutionProof(pool,identity,options={}){return readProof(pool,identity,options,false);}
export async function readAuthoringReadiness(pool,authoringTaskId,options={}){
 return readProof(pool,{authoringTaskId,tenantId:options.tenantId??'default'},options,true);
}
