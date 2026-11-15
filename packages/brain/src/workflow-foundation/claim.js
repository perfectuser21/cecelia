import {randomUUID} from 'node:crypto';
import {startRun} from '../lib/task-run.js';
import {getRelease} from '../lib/release-index.js';
import {digest} from '../orchestrator/commander-decision.js';
import {FOUNDATION_PROTOCOL,UUID,onlyKeys,requireFoundation,validateFoundationInput,parseFoundationProfile,preparedFoundationRun} from './contracts.js';
import {foundationTransaction,resolveFoundationRelease} from './registry.js';
export function validateMachineRequest(input,keys){onlyKeys(input,keys);requireFoundation(typeof input.machine_id==='string'&&/^[a-zA-Z0-9_.-]{1,100}$/.test(input.machine_id),'foundation_machine_invalid',400);}
export async function loadFoundationTask(db,taskId,input){
 requireFoundation(UUID.test(taskId??'')&&UUID.test(input.run_id??''),'foundation_identity_invalid',400);
 const task=(await db.query('SELECT * FROM tasks WHERE id=$1 FOR UPDATE',[taskId])).rows[0],job=task?.result?.foundation_runner;
 requireFoundation(task?.task_type==='workflow_dispatch'&&task.payload?.commander_protocol===FOUNDATION_PROTOCOL&&job?.task_id===taskId&&job.run_id===input.run_id&&job.machine_id===input.machine_id,'foundation_task_owner_conflict');
 return {task,job};
}
export async function claimFoundationTask(pool,input,services={}){
 validateMachineRequest(input,['machine_id','task_id']);if(input.task_id!==undefined)requireFoundation(UUID.test(input.task_id),'foundation_identity_invalid',400);
 return foundationTransaction(pool,'foundation-claim:'+input.machine_id,async db=>{
  const row=(await db.query(`SELECT * FROM tasks WHERE task_type='workflow_dispatch' AND payload->>'commander_protocol'=$1
   AND payload->'foundation_request'->>'machine_id'=$2 AND status IN ('queued','in_progress')
   AND ($3::uuid IS NULL OR id=$3::uuid) ORDER BY (status='in_progress') DESC,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`,[FOUNDATION_PROTOCOL,input.machine_id,input.task_id??null])).rows[0];
  if(!row)return {job:null};
  if(row.result?.foundation_runner){
   const job=row.result.foundation_runner;requireFoundation(row.status==='in_progress'&&row.claimed_by==='foundation:'+input.machine_id&&job.task_id===row.id&&job.machine_id===input.machine_id,'foundation_task_owner_conflict');return {job};
  }
  requireFoundation(row.status==='queued'&&!row.claimed_by,'foundation_task_owner_conflict');
  const original=row.payload.workflow_definition;
  const fixed=await resolveFoundationRelease(db,{workflow_id:original?.workflow_id,release_id:original?.release_id});
  requireFoundation(fixed.machine_id===input.machine_id&&fixed.definition.workflow_definition_version_id===original.workflow_definition_version_id&&fixed.definition.snapshot_sha256===original.snapshot_sha256&&digest(fixed.runtime)===digest(row.payload.foundation_request.runtime),'foundation_definition_changed');
  requireFoundation(row.payload.workflow_key===fixed.row.key,'foundation_definition_changed');
  validateFoundationInput(fixed.runtime,row.payload.workflow_input);
  const runId=randomUUID(),now=(services.now??Date.now)();
  const definition={...fixed.definition,attempt_key:`${row.id}:1`,actor:'commander-foundation'};
  const job={task_id:row.id,run_id:runId,machine_id:input.machine_id,runtime:fixed.runtime,definition,release:fixed.release,input:{...row.payload.workflow_input,run_tag:runId},deadline_ms:now+fixed.runtime.timeout_ms,...(fixed.runtime.cleanup_timeout_ms?{cleanup_deadline_ms:now+fixed.runtime.timeout_ms+fixed.runtime.cleanup_timeout_ms}:{})};
  const registered=await (services.startRun??startRun)({taskId:row.id,runId,source:'commander-foundation',definition,context:{workflow_key:row.payload.workflow_key}},{pool,transactionClient:db});
  requireFoundation(registered?.binding?.run_id===runId,'foundation_run_registration_failed');
  await db.query("UPDATE tasks SET result=COALESCE(result,'{}'::jsonb)||jsonb_build_object('foundation_runner',$2::jsonb),status='in_progress',claimed_by=$3,claimed_at=NOW(),executor_kind='script',started_at=COALESCE(started_at,NOW()),updated_at=NOW() WHERE id=$1",[row.id,JSON.stringify(job),'foundation:'+input.machine_id]);
  return {job};
 });
}
export async function prepareFoundationTask(pool,taskId,input){
 validateMachineRequest(input,['machine_id','run_id','profile_document','runtime_revision','definition_sha256']);
 return foundationTransaction(pool,'foundation-task:'+taskId,async db=>{
  const {task,job}=await loadFoundationTask(db,taskId,input);
  requireFoundation(task.status==='in_progress','foundation_task_not_running');
  const release=await getRelease(db,job.definition.release_id),workflow=release.payload.workflows.find(w=>w.id===job.definition.workflow_definition_version_id&&w.workflow_id===job.definition.workflow_id);
  requireFoundation(workflow&&workflow.payload_sha256===job.definition.snapshot_sha256,'foundation_definition_changed');
  const doc=parseFoundationProfile(input.profile_document,job.runtime,release,workflow);
  const run=preparedFoundationRun(job,doc.contract,input.runtime_revision);
  requireFoundation(run.definition_sha256===input.definition_sha256,'foundation_manifest_identity_conflict');
  if(job.run){requireFoundation(digest(job.run)===digest(run),'foundation_manifest_identity_conflict');return {run:job.run};}
  requireFoundation(Date.now()<job.deadline_ms,'foundation_deadline_exceeded');
  const next={...job,run,profile_sha256:job.runtime.profile_ref.digest};
  await db.query("UPDATE tasks SET result=jsonb_set(result,'{foundation_runner}',$2::jsonb),updated_at=NOW() WHERE id=$1",[taskId,JSON.stringify(next)]);
  return {run};
 });
}
