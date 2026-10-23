/** 只初始化原有infra桶的缺失关系，不建立可执行定义、调度或current指针。 */
import {readInfraConsumerRegistry,validateInfraConsumerRegistry,INFRA_CONSUMER_IDENTITY as I} from './infra-consumer-source.js';
import {withConsumerEvidenceTransaction} from './consumer-evidence-store.js';
import {prepareInfraBootstrapSource,consumeInfraBootstrapSource} from './infra-bootstrap-source.js';
import {stepSha256} from '../../scripts/sync-steps-from-workspace.mjs';
const TASK='a6aa895d-f91e-4eb4-bdc6-242119ca46ce',PARENT='3362c876-447a-49ef-a2df-b0773d880d88',ROUTE='0c0eb3b2-7361-406a-ad9f-11e1b59e3fb1';
const CLAIM='interactive-dev-skill:infra-bootstrap-20261022';
const fail=(code,status=409)=>{throw Object.assign(Error(code),{code,status});};
function inputValid(x){
 if(!x||['task_id','client_request_id','expected_registry_sha256','revision'].some(k=>typeof x[k]!=='string')||Object.keys(x).sort().join(',')!=='client_request_id,expected_registry_sha256,revision,task_id'||x.task_id!==TASK||!/^[-A-Za-z0-9._:]{1,100}$/.test(x.client_request_id)||!/^[a-f0-9]{64}$/.test(x.expected_registry_sha256)||!/^[a-f0-9]{40}$/.test(x.revision))fail('INFRA_BOOTSTRAP_INPUT_INVALID',400);
}
async function authorize(db,lock=false){
 const task=(await db.query(`SELECT * FROM tasks WHERE id=$1${lock?' FOR UPDATE':''}`,[TASK])).rows[0];
 const p=task?.payload;
 if(!task||task.status!=='in_progress'||task.claimed_by!==CLAIM||task.parent_task_id!==PARENT||p?.repo!=='cecelia'||p.routing_receipt_id!==ROUTE||stepSha256(p.map_scope)!==stepSha256(['F2']))fail('INFRA_BOOTSTRAP_TASK_FORBIDDEN',403);
 const parent=(await db.query(`SELECT status FROM tasks WHERE id=$1${lock?' FOR SHARE':''}`,[PARENT])).rows[0];
 const route=(await db.query('SELECT * FROM work_routing_receipts WHERE id=$1 AND task_id=$2',[ROUTE,TASK])).rows[0];
 if(parent?.status!=='in_progress'||!route||route.repo!=='cecelia'||route.work_kind!=='coding_mutation'||route.change_kind!=='bugfix'||route.orchestrator!=='skill-relay'||route.impact_contract_required!==true||stepSha256(route.map_scope)!==stepSha256(['F2']))fail('INFRA_BOOTSTRAP_TASK_FORBIDDEN',403);
 return task;
}
function identity(r){
 const w=r.workflows[0],cap=r.capabilities[0],root=r.value_streams[0],skill=r.skills[0];
 if(r.workflows.length!==1||w.id!==I.workflow_id||w.key!==I.workflow_key||w.capability_id!==I.capability_id||w.status!=='active'||w.current_definition_version_id!==null||r.capabilities.length!==1||cap.id!==I.capability_id||cap.parent_journey_id!==I.root||cap.status!=='active'||r.value_streams.length!==1||root.id!==I.root||root.parent_journey_id!==null||root.status!=='active'||r.skills.length!==1||skill.id!==I.skill_id||skill.name!=='janitor'||skill.status!=='active'||skill.location!=='/Users/administrator/perfect21/cecelia-deploy-main/scripts/ops/janitor.sh')fail('INFRA_BOOTSTRAP_REGISTRY_CONFLICT');
}
export async function bootstrapInfraRegistry(pool,input,options={}){
 inputValid(input);await authorize(pool);
 const prepared=consumeInfraBootstrapSource(await prepareInfraBootstrapSource(input,options),input);
 return withConsumerEvidenceTransaction(pool,'infra-consumer-evidence',async db=>{
  await db.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'");
  const task=await authorize(db,true);
  await db.query('SELECT id FROM workflows WHERE id=$1 FOR UPDATE',[I.workflow_id]);
  await db.query('SELECT id FROM workflow_activity_refs WHERE workflow_id=$1 FOR UPDATE',[I.workflow_id]);
  const owned=(await db.query('SELECT * FROM activities WHERE workflow_id=$1 OR (capability_key=$2 AND activity_key=$3) FOR UPDATE',[I.workflow_id,I.workflow_key,I.slot_key])).rows;
  await db.query('SELECT id FROM capabilities WHERE id=$1 FOR SHARE',[I.capability_id]);
  await db.query('SELECT id FROM value_streams WHERE id=$1 FOR SHARE',[I.root]);
  await db.query('SELECT id FROM skill_registry WHERE id=$1 FOR SHARE',[I.skill_id]);
  const before=await readInfraConsumerRegistry(db);identity(before);
  if(task.result!==null&&task.result!==undefined&&(typeof task.result!=='object'||Array.isArray(task.result)))fail('INFRA_BOOTSTRAP_RECEIPT_CONFLICT');
  const old=task.result?.infra_registry_bootstrap;
  if(Object.hasOwn(task.result??{},'infra_registry_bootstrap')){
   if(!old||typeof old!=='object'||!old.request||typeof old.after_registry_sha256!=='string'||old.task_id!==TASK||old.before_registry_sha256!==input.expected_registry_sha256||old.metadata_only!==true||old.executable!==false||old.runtime_status!=='not_evaluated'||!old.source||stepSha256(old.source)!==stepSha256(prepared.source)||Object.keys(old).sort().join(',')!=='activity_id,after_registry_sha256,before_registry_sha256,executable,metadata_only,reference_id,request,runtime_status,source,task_id')fail('INFRA_BOOTSTRAP_RECEIPT_CONFLICT');
   if(stepSha256(old.request)!==stepSha256(input)||old.after_registry_sha256!==before.registry_sha256)fail('INFRA_BOOTSTRAP_REPLAY_CONFLICT');
   const valid=validateInfraConsumerRegistry(before);
   if(valid.activity_id!==old.activity_id||valid.reference_id!==old.reference_id||owned.length!==1||owned[0].id!==old.activity_id)fail('INFRA_BOOTSTRAP_REPLAY_CONFLICT');
   await prepared.check();return {receipt:old,replayed:true};
  }
  if(before.registry_sha256!==input.expected_registry_sha256)fail('INFRA_BOOTSTRAP_CAS_CONFLICT');
  if(before.references.length||before.activities.length||before.steps.length||owned.length)fail('INFRA_BOOTSTRAP_EXISTING_RELATION');
  const activity=(await db.query(`INSERT INTO activities(name,status,workflow_id,capability_key,activity_key,executor_kind)
   VALUES('Janitor孤儿进程核对','planned',$1,$2,$3,'code') RETURNING id`,[I.workflow_id,I.workflow_key,I.slot_key])).rows[0];
  const ref=(await db.query(`INSERT INTO workflow_activity_refs(workflow_id,slot_key,activity_id,sequence_no,source_ref,source_repo,source_path,source_commit,active)
   VALUES($1,$2,$3,1,$4,'perfectuser21/cecelia','scripts/ops/janitor.sh',$5,true) RETURNING id`,[I.workflow_id,I.slot_key,activity.id,I.skill_id,input.revision])).rows[0];
  const after=await readInfraConsumerRegistry(db),valid=validateInfraConsumerRegistry(after);
  if(valid.activity_id!==activity.id||valid.reference_id!==ref.id||stepSha256(before.workflows)!==stepSha256(after.workflows))fail('INFRA_BOOTSTRAP_READBACK_CONFLICT');
  const receipt={request:input,task_id:TASK,activity_id:activity.id,reference_id:ref.id,before_registry_sha256:before.registry_sha256,after_registry_sha256:after.registry_sha256,source:prepared.source,metadata_only:true,executable:false,runtime_status:'not_evaluated'};
  const updated=(await db.query("UPDATE tasks SET result=COALESCE(result,'{}'::jsonb)||jsonb_build_object('infra_registry_bootstrap',$2::jsonb) WHERE id=$1 RETURNING result",[TASK,receipt])).rows[0];
  if(stepSha256(updated?.result)!==stepSha256({...task.result,infra_registry_bootstrap:receipt}))fail('INFRA_BOOTSTRAP_READBACK_CONFLICT');
  await prepared.check();return {receipt,replayed:false};
 },{lockTimeoutMs:5000});
}
