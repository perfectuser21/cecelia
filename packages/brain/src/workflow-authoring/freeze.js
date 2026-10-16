import { definitionDigest } from './contracts.js';
import { readFixedGitFile, validateGitSource } from './fixed-git-source.js';
import { validateImplementationBindings } from '../lib/implementation-bindings.js';
import { snapshotDefinitions } from '../lib/definition-versions.js';
import { assertStepsHaveReadback } from '../lib/contract-steps.js';
import { prepareSharedFreeze } from './shared-freeze.js';
import { syncAssemblyActivity,loadAssemblyCatalog,ensureAssemblyWarehouse } from '../lib/workflow-assembly-store.js';
import { compileAssemblyPlan } from './assembly-plan.js';

export const FREEZE_PROTOCOL='definition-freeze-v1';
const prepared=new WeakMap();
const fail=(message,code='definition_freeze_proof_invalid')=>{throw Object.assign(new Error(message),{code,status:422});};

/** 网络核验在事务外完成；源JSON不含source，避免文件自引用commit。 */
export async function prepareDefinitionFreeze(definition, options={}) {
  const source={repo:definition.source?.repo,path:definition.source?.ref,revision:definition.source?.revision};
  validateGitSource(source);
  const readFile=options.readFile||((s)=>readFixedGitFile(s,options)),cache=new Map(),deadline=Math.min(options.deadline??Infinity,Date.now()+60000);
  let totalBytes=0;
  const read=async s=>{
    if(options.signal?.aborted||Date.now()>=deadline)fail('readiness_deadline_exceeded');
    validateGitSource(s);const key=JSON.stringify([s.repo,s.path,s.revision]);
    if(!cache.has(key)){
      if(cache.size>=200||Date.now()>deadline)fail('来源核验超过文件数量或总时限');
      const content=await readFile(s);
      if(options.signal?.aborted||Date.now()>=deadline)fail('readiness_deadline_exceeded');
      if(typeof content!=='string'||Buffer.byteLength(content)>1024*1024)fail('来源文件不是有界文本');
      totalBytes+=Buffer.byteLength(content);if(totalBytes>8*1024*1024||Date.now()>deadline)fail('来源核验超过总字节或时限');
      cache.set(key,content);
    }
    return cache.get(key);
  };
  let document;
  try{document=JSON.parse(await read(source));}catch{fail('冻结来源文件不是JSON','definition_source_invalid');}
  const {source:_source,...expected}=definition;
  if(definitionDigest(document)!==definitionDigest(expected))fail('冻结来源内容与已验收完整定义不一致','definition_source_invalid');
  assertStepsHaveReadback(definition.activities);
  const bindings=new Map(),shared=new Map(),fixed={repo:source.repo,path:source.path,commit:source.revision};
  for(const activity of definition.activities){
    if(activity.reuse_activity_id){
      const pin=await prepareSharedFreeze(activity,options.sharedVersions,read);
      shared.set(activity.key,pin.version);bindings.set(activity.key,pin.bindings);continue;
    }
    const verified=await validateImplementationBindings(activity,read,fixed);
    if(!verified.length||verified.some(b=>b.status!=='verified'))fail(`活动实现无法完整核验：${activity.key}`);
    bindings.set(activity.key,verified);
  }
  const proof={source:fixed,bindings,shared,definition_sha256:definitionDigest(definition)};
  prepared.set(proof,definitionDigest({source:fixed,bindings:[...bindings],shared:[...shared],definition_sha256:proof.definition_sha256}));
  return proof;
}

export function assertPreparedFreeze(definition,proof) {
  if(!proof||!prepared.has(proof)||proof.definition_sha256!==definitionDigest(definition)
    ||prepared.get(proof)!==definitionDigest({source:proof.source,bindings:[...proof.bindings],shared:[...proof.shared],definition_sha256:proof.definition_sha256}))fail('缺少匹配定义的真实来源核验证明');
}

export async function freezeRegisteredWorkflow(client,workflow,definition,activityIds,proof,{strictAssembly=false,tenantId='default'}={}) {
  assertPreparedFreeze(definition,proof);
  const old=(await client.query('SELECT source_repo,source_path,source_workflow,source_capability FROM workflows WHERE id=$1',[workflow.id])).rows[0];
  if(old.source_workflow||old.source_capability||(old.source_repo&&old.source_repo!==proof.source.repo)||(old.source_path&&old.source_path!==proof.source.path))fail('工作流已属于其他来源，不能覆盖');
  await client.query('UPDATE workflows SET source_repo=$2,source_path=$3 WHERE id=$1',[workflow.id,proof.source.repo,proof.source.path]);
  await client.query('UPDATE workflow_activity_refs SET source_repo=$2,source_path=$3 WHERE workflow_id=$1 AND active',[workflow.id,proof.source.repo,proof.source.path]);
  if(strictAssembly)await ensureAssemblyWarehouse(client,definition,proof.source);
  const catalog=strictAssembly?await loadAssemblyCatalog(client,definition):null;
  const plan=strictAssembly?compileAssemblyPlan(definition,catalog,{tenantId}):null;
  if(plan&&!plan.structurally_complete)fail(`装配合同不完整: ${plan.gaps.map(g=>g.code).join(',')}`,'workflow_assembly_blocked');
  const bindingsByActivity=new Map(),pinnedReferences=new Map();
  for(const [index,activity] of definition.activities.entries()){
    const activityId=activityIds[index];
    if(activity.reuse_activity_id){
      const version=proof.shared.get(activity.key);pinnedReferences.set(`${workflow.id}:${activity.key}`,version);
      await syncAssemblyActivity(client,{activityId,contract:version.payload.contract,source:{repo:version.source_repo,path:version.source_path},readOnly:true});
      continue;
    }
    if(strictAssembly){
      const stored=(await client.query('SELECT workflow_id,contract,contract_sha256,contract_source FROM activities WHERE id=$1',[activityId])).rows[0];
      const expected={...activity,workflow_authoring:{workflow_key:definition.key,source:definition.source,runtime:definition.runtime}};
      const location=`https://github.com/${proof.source.repo}/blob/${proof.source.commit}/${proof.source.path}`;
      if(!stored||stored.workflow_id!==workflow.id||definitionDigest(stored.contract)!==definitionDigest(expected)
        ||stored.contract_sha256!==definitionDigest(expected)||stored.contract_source!==location)fail('已登记活动合同或来源与装配定义不一致');
    }
    bindingsByActivity.set(activityId,proof.bindings.get(activity.key));
    const activityKey=`${definition.key}.${activity.key}`;
    await syncAssemblyActivity(client,{activityId,contract:activity,activityKey,canonical:`${definition.key}.${activityKey}`,capabilityKey:definition.key,source:proof.source,synchronizeSteps:true,strict:strictAssembly});
  }
  await snapshotDefinitions(client,{workflowIds:[workflow.id],source:proof.source,bindingsByActivity,documentsByWorkflow:new Map([[workflow.id,definition]]),registrationProtocol:FREEZE_PROTOCOL,strictAssembly,pinnedReferences});
  const row=(await client.query('SELECT current_definition_version_id FROM workflows WHERE id=$1',[workflow.id])).rows[0];
  if(!row?.current_definition_version_id)fail('冻结版本回读失败');
  if(strictAssembly){
    const version=(await client.query('SELECT payload FROM workflow_definition_versions WHERE id=$1 AND workflow_id=$2',[row.current_definition_version_id,workflow.id])).rows[0];
    const refs=(await client.query('SELECT slot_key,sequence_no,activity_id FROM workflow_activity_refs WHERE workflow_id=$1 AND active ORDER BY sequence_no',[workflow.id])).rows;
    if(!version||definitionDigest(version.payload.contract)!==definitionDigest(definition)||refs.length!==activityIds.length
      ||refs.some((r,i)=>r.slot_key!==definition.activities[i].key||r.sequence_no!==i+1||r.activity_id!==activityIds[i]))fail('装配定义版本或有序引用最终回读失败');
  }
  return {registration_protocol:FREEZE_PROTOCOL,current_definition_version_id:row.current_definition_version_id,...(plan?{assembly_plan:plan,assembly_mode:true,callable:false}: {})};
}
