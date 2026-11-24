import {resolveStandaloneDiscoveryRelease,validateStandaloneDiscoveryInput} from './standalone-release.js';
import {createRoutedTask} from '../work-routing-store.js';
import {getRelease,getReleaseGate} from '../lib/release-index.js';
import {digest} from '../orchestrator/commander-decision.js';
import {FOUNDATION_PROTOCOL,UUID,onlyKeys,requireFoundation,validateFoundationRuntime,validateFoundationInput,assertProfileComponent} from './contracts.js';
export async function foundationTransaction(pool,key,fn){
 const db=await pool.connect();try{await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,716))',[key]);const result=await fn(db);await db.query('COMMIT');return result;}catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
export async function resolveFoundationRelease(db,{workflow_id,release_id},{allowPaused=false}={}){
 requireFoundation(UUID.test(workflow_id??'')&&UUID.test(release_id??''),'foundation_identity_invalid',400);
 const row=(await db.query('SELECT id,key,name,status,current_definition_version_id FROM workflows WHERE id=$1',[workflow_id])).rows[0];
 requireFoundation(row,'foundation_workflow_missing',404);
 requireFoundation(allowPaused||row.status==='active','foundation_workflow_not_active');
 const release=await getRelease(db,release_id),workflow=release.payload.workflows.find(w=>w.workflow_id===workflow_id);
 requireFoundation(workflow,'foundation_release_workflow_missing');
 const runtime=validateFoundationRuntime(workflow.payload.contract?.runtime);
 assertProfileComponent(runtime,release.payload.components);
 const target=String(release.target).split('/');
 requireFoundation(release.payload.workflows.length===1&&target.length===2&&/^[a-zA-Z0-9_.-]{1,100}$/.test(target[0])&&target[1]===row.key,'foundation_target_invalid');
 const gate=await getReleaseGate(db,release_id);
 requireFoundation(gate.deployed===true&&gate.current_observation_id,'foundation_release_not_ready');
 const expected_path=workflow.payload.activities.flatMap(ref=>{
  const activity=release.payload.activities.find(a=>a.id===ref.activity_version_id&&a.activity_id===ref.activity_id);
  requireFoundation(activity,'foundation_activity_version_missing');
  const entry={reference_id:ref.reference_id,activity_id:ref.activity_id,activity_definition_version_id:ref.activity_version_id,required:true};
  return [entry,...(activity.payload.steps??[]).filter(s=>s.step_id).map(s=>({...entry,step_id:s.step_id}))];
 });
 const definition={release_id,observation_id:gate.current_observation_id,workflow_id,workflow_definition_version_id:workflow.id,snapshot_sha256:workflow.payload_sha256,runtime_snapshot_sha256:digest({profile_ref:runtime.profile_ref,release_id,workflow_definition_version_id:workflow.id}),expected_path};
 return {row,workflow,release,runtime,definition,machine_id:target[0]};
}
export async function listFoundationCatalog(pool){
 const releases=(await pool.query(`SELECT id,payload FROM release_versions WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'workflows') w WHERE w#>>'{payload,contract,runtime,kind}'=$1) ORDER BY created_at DESC LIMIT 100`,[FOUNDATION_PROTOCOL])).rows;
 const workflows=[];
 for(const release of releases)for(const w of release.payload.workflows){
  if(w.payload.contract?.runtime?.kind!==FOUNDATION_PROTOCOL)continue;
  const item={workflow_id:w.workflow_id,release_id:release.id,workflow_definition_version_id:w.id,key:w.payload.contract.key??w.payload.key,name:w.payload.contract.name??w.payload.key,status:'blocked'};
  try{const resolved=await resolveFoundationRelease(pool,{workflow_id:w.workflow_id,release_id:release.id});Object.assign(item,{key:resolved.row.key,name:resolved.row.name,status:'ready',machine_id:resolved.machine_id,runtime:resolved.runtime});}catch(error){item.reason=error.code??'foundation_unavailable';}
  workflows.push(item);
 }
 return {workflows};
}
export async function createFoundationTask(pool,input,services={}){
 onlyKeys(input,['workflow_id','release_id','input','idempotency_key','title']);
 requireFoundation(typeof input.idempotency_key==='string'&&input.idempotency_key.length>0&&input.idempotency_key.length<=128,'foundation_idempotency_key_invalid',400);
 requireFoundation(input.title===undefined||typeof input.title==='string'&&input.title.length>0&&input.title.length<=200,'foundation_title_invalid',400);
 const {notionPageId,notionTenantId}=services;
 if(notionPageId!==undefined)requireFoundation(UUID.test(notionPageId)&&typeof notionTenantId==='string'&&notionTenantId.length>0,'foundation_notion_binding_invalid',400);
 const requestHash=digest(input),sourceId=notionPageId?'foundation:notion:'+notionPageId:'foundation:'+digest({workflow_id:input.workflow_id,key:input.idempotency_key});
 return foundationTransaction(pool,sourceId,async db=>{
  const existing=(await db.query("SELECT * FROM tasks WHERE payload->'foundation_request'->>'source_id'=$1 LIMIT 1",[sourceId])).rows[0];
  if(existing){requireFoundation(existing.payload.foundation_request.request_sha256===requestHash&&(!notionPageId||existing.payload.notion_page_id===notionPageId&&existing.tenant_id===notionTenantId),'foundation_idempotency_conflict');return {task:existing,created:false};}
  const fixed=await (notionPageId?resolveStandaloneDiscoveryRelease:resolveFoundationRelease)(db,input);
  if(notionPageId)validateStandaloneDiscoveryInput(input.input);else validateFoundationInput(fixed.runtime,input.input);
  const metadata={commander_protocol:FOUNDATION_PROTOCOL,workflow_key:fixed.row.key,workflow_input:input.input,workflow_definition:fixed.definition,foundation_request:{source_id:sourceId,request_sha256:requestHash,machine_id:fixed.machine_id,runtime:fixed.runtime},
   ...(notionPageId?{notion_page_id:notionPageId,tenant_id:notionTenantId,source:'notion_leadgen_101'}:{})};
  const createTask=services.createTask??createRoutedTask;
  const routed=await createTask(db,{source:'api',source_id:sourceId,title:input.title??fixed.row.name,description:'执行已发布的固定Workflow版本',requested_task_type:'workflow_dispatch',artifact_kind:'execution',mutation_intent:'none',metadata,task:{kind:'workflow',status:'queued',priority:'P2'}},null,{transaction:'existing'});
  const task=routed.task??routed;
  requireFoundation(task?.id&&task.payload?.commander_protocol===FOUNDATION_PROTOCOL,'foundation_task_registration_failed');
  if(!notionPageId)return {task,created:true};
  const updated=(await db.query('UPDATE tasks SET tenant_id=$2 WHERE id=$1 RETURNING *',[task.id,notionTenantId])).rows[0];
  requireFoundation(updated?.id===task.id,'foundation_notion_task_binding_failed');
  return {task:updated,created:true};
 });
}
