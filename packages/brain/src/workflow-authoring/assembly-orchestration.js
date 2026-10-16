import {definitionDigest,requireCondition} from './contracts.js';
import {registerWorkflow} from './registration.js';
export const EXECUTION_PROTOCOL='workflow-authoring-execution-v1';
function blocked(code,message){throw Object.assign(Error(message),{code,status:409,statusCode:409,gaps:[{code}]});}
function frozenVersion(row){
 requireCondition(row?.payload&&row.contract_sha256===definitionDigest(row.payload.contract)
  &&row.payload_sha256===definitionDigest({source:{repo:row.source_repo,path:row.source_path,commit:row.source_commit},payload:row.payload}),
 '候选不可变版本摘要不符',409);
}
export async function requireCandidateEnvironment(db){
 const name=(await db.query('SELECT current_database() AS name')).rows[0]?.name;
 if(name!=='cecelia_scratch'&&!(name==='cecelia_test'&&process.env.CI==='true'&&process.env.GITHUB_ACTIONS==='true'))
  blocked('candidate_environment_unsupported','自动候选仅允许实际隔离测试库，生产需现有人工放行');
}
/** 双向回读实际实体、固定版本及管理任务owner；不从result中的自述授予资格。 */
export async function readCandidateOwner(db,authoringTaskId,definition,tenantId){
 const row=(await db.query('SELECT id,tenant_id,payload,result FROM tasks WHERE id=$1',[authoringTaskId])).rows[0];
 const owner=row?.result?.workflow_authoring_candidate;
 if(!owner)return null;
 requireCondition(row.payload?.workflow_authoring===true&&(row.payload?.tenant_id??'default')===tenantId
  &&(!row.tenant_id||row.tenant_id===tenantId)&&owner.protocol===EXECUTION_PROTOCOL&&owner.tenant_id===tenantId
  &&owner.authoring_task_id===authoringTaskId&&owner.definition_sha256===definitionDigest(definition)
  &&definitionDigest(row.result.workflow_authoring?.outputs?.compose?.definition)===owner.definition_sha256,'候选owner或租户已变化',409);
 const claims=(await db.query("SELECT id FROM tasks WHERE result->'workflow_authoring_candidate'->>'workflow_id'=$1",[owner.workflow_id])).rows;
 requireCondition(claims.length===1&&claims[0].id===authoringTaskId,'候选归属不唯一',409);
 const workflow=(await db.query(`SELECT * FROM workflows WHERE id=$1${db.authorityLock?' FOR SHARE':''}`,[owner.workflow_id])).rows[0];
 const version=(await db.query('SELECT * FROM workflow_definition_versions WHERE id=$1 AND workflow_id=$2',[owner.workflow_definition_version_id,owner.workflow_id])).rows[0];
 frozenVersion(version);
 requireCondition(workflow&&workflow.status==='paused'&&version&&workflow.key===definition.key&&workflow.current_definition_version_id===version.id
  &&version.source_repo===definition.source.repo&&version.source_path===definition.source.ref&&version.source_commit===definition.source.revision
  &&definitionDigest(version.payload.contract)===owner.definition_sha256,'候选固定版本或来源不符',409);
 const refs=(await db.query('SELECT id,slot_key,sequence_no,activity_id,activity_definition_version_id FROM workflow_activity_refs WHERE workflow_id=$1 AND active ORDER BY sequence_no',[owner.workflow_id])).rows;
 if(refs.length!==definition.activities.length||refs.length!==owner.slots.length)blocked('fixed_reference_missing','候选固定引用覆盖不足');
 for(const [index,ref] of refs.entries()){
  const slot=owner.slots[index],contract=definition.activities[index];
  requireCondition(ref.slot_key===contract.key&&slot.slot_key===ref.slot_key&&slot.activity_id===ref.activity_id
   &&slot.activity_definition_version_id===ref.activity_definition_version_id,'候选slot固定引用不符',409);
  const a=(await db.query('SELECT * FROM activity_definition_versions WHERE id=$1 AND activity_id=$2',[slot.activity_definition_version_id,slot.activity_id])).rows[0];
  frozenVersion(a);
  const fixed=version.payload.activities[index];
  requireCondition(a&&a.payload.activity_id===ref.activity_id&&fixed.activity_version_id===a.id&&fixed.activity_id===ref.activity_id
   &&fixed.slot_key===ref.slot_key&&fixed.sequence_no===index+1&&ref.sequence_no===index+1&&fixed.reference_id===ref.id,'候选Activity固定版本不存在',409);
  const live=(await db.query(`SELECT id,status,workflow_id,current_definition_version_id,contract,contract_sha256 FROM activities WHERE id=$1${db.authorityLock?' FOR SHARE':''}`,[slot.activity_id])).rows[0];
  requireCondition(live&&(contract.reuse_activity_id?live.status==='active':live.status==='planned'&&live.workflow_id===owner.workflow_id&&live.current_definition_version_id===a.id&&live.contract_sha256===a.contract_sha256&&definitionDigest(live.contract)===a.contract_sha256),'candidate_activity_authority_revoked',409);
  if(!contract.reuse_activity_id){
   const expected={...contract,workflow_authoring:{workflow_key:definition.key,source:definition.source,runtime:definition.runtime}};
   requireCondition(definitionDigest(a.payload.contract)===definitionDigest(expected)&&a.source_repo===definition.source.repo
    &&a.source_path===definition.source.ref&&a.source_commit===definition.source.revision,'候选活动合同或来源不符',409);
  }else requireCondition(a.id===contract.reuse_activity_definition_version_id&&a.activity_id===contract.reuse_activity_id
   &&a.contract_sha256===contract.reuse_contract_sha256,'共享候选固定合同不符',409);
  requireCondition(Array.isArray(a.payload.steps)&&Array.isArray(slot.steps),'候选Step合同缺失',409);
  requireCondition(definitionDigest(a.payload.steps.map(s=>({id:s.step_id,key:s.contract.key})))===definitionDigest(slot.steps),'候选Step映射已变化',409);
 }
 return owner;
}
/** 调用者已有事务。只登记无冲突新对象，绝不更新live/其它管理任务对象。 */
export async function prepareAuthoringCandidate(db,authoringTaskId,state,{freezeProof,tenantId='default'}={}){
 await requireCandidateEnvironment(db);
 if(state.request.operation!=='create')blocked('candidate_isolation_required','更新候选尚无隔离存储，不改动当前正式版本');
 const definition=state.outputs.compose.definition;
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`authoring-candidate-key:${definition.key}`]);
 const existing=(await db.query('SELECT id FROM workflows WHERE key=$1 FOR UPDATE',[definition.key])).rows[0];
 if(existing){
  const owner=await readCandidateOwner(db,authoringTaskId,definition,tenantId);
  if(!owner||owner.workflow_id!==existing.id)blocked('candidate_isolation_required','稳定key已被正式对象或其它候选占用，需要隔离目标');
  return owner;
 }
 const registered=await registerWorkflow(db,definition,{taskId:authoringTaskId,operation:'create',definitionSha256:definitionDigest(definition),
  registrationProtocol:'definition-freeze-v1',assemblyMode:true,tenantId,freezeProof});
 const version=(await db.query('SELECT payload FROM workflow_definition_versions WHERE id=$1',[registered.current_definition_version_id])).rows[0];
 const slots=[];
 for(const ref of version.payload.activities){
  const a=(await db.query('SELECT payload FROM activity_definition_versions WHERE id=$1',[ref.activity_version_id])).rows[0];
  slots.push({slot_key:ref.slot_key,activity_id:ref.activity_id,activity_definition_version_id:ref.activity_version_id,
   steps:a.payload.steps.map(s=>({id:s.step_id,key:s.contract.key}))});
 }
 const owner={protocol:EXECUTION_PROTOCOL,authoring_task_id:authoringTaskId,tenant_id:tenantId,definition_sha256:definitionDigest(definition),
  workflow_id:registered.workflow_id,workflow_definition_version_id:registered.current_definition_version_id,slots};
 await db.query("UPDATE workflows SET status='paused' WHERE id=$1",[owner.workflow_id]);
 await db.query("UPDATE activities SET status='planned' WHERE workflow_id=$1",[owner.workflow_id]);
 await db.query("UPDATE tasks SET result=COALESCE(result,'{}'::jsonb)||jsonb_build_object('workflow_authoring_candidate',$2::jsonb) WHERE id=$1",[authoringTaskId,JSON.stringify(owner)]);
 return readCandidateOwner(db,authoringTaskId,definition,tenantId);
}
