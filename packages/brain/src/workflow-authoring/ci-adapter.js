import { FREEZE_PROTOCOL, prepareDefinitionFreeze } from './freeze.js';
import { definitionDigest } from './contracts.js';
const KEYS=/^[a-z][a-z0-9_.-]{0,99}$/;
const fail=message=>{throw Object.assign(new Error(message),{code:'IMPLEMENTATION_CI_AUTHORING_SOURCE_INVALID',status:409});};
export function validateAuthoringAdapterConfig(config){
  return config?.definition_protocol===FREEZE_PROTOCOL
    && ['perfectuser21/cecelia','perfectuser21/zenithjoy-workspace'].includes(config.source_repo)
    && Object.keys(config).sort().join(',')==='definition_protocol,source_repo,workflow_keys'
    && Array.isArray(config.workflow_keys)&&config.workflow_keys.length>0&&config.workflow_keys.length<=100
    && config.workflow_keys.every(key=>KEYS.test(key))&&new Set(config.workflow_keys).size===config.workflow_keys.length;
}
export function selectAuthoringDefinitions(config,rows){
  if(!validateAuthoringAdapterConfig(config))fail('authoring适配登记不合法');
  return rows.filter(row=>config.workflow_keys.includes(row.payload?.key));
}
export function checkAuthoringSnapshot(config,definitions,canonical,query,gap){
  if(!validateAuthoringAdapterConfig(config)){gap('authoring_adapter_invalid');return;}
  for(const key of config.workflow_keys){
    const versions=definitions.filter(w=>w.payload.key===key),owner=canonical.find(w=>w.key===key);
    if(versions.length!==1||!owner||owner.id!==versions[0]?.workflow_id||owner.status==='retired'){
      gap('authoring_definition_missing',{key});continue;
    }
    const row=versions[0],source=row.payload.contract?.source;
    if(row.source_repo!==config.source_repo||row.source_commit!==query.revision||row.source_path!==source?.ref
      ||source?.repo!==row.source_repo||source?.revision!==row.source_commit||owner.source_repo!==row.source_repo||owner.source_path!==row.source_path
      ||row.payload.contract?.capability_id!==owner.capability_id||row.payload.contract?.key!==key)gap('authoring_definition_source_mismatch',{key});
  }
}
export function isAuthoringReleaseSnapshot(snapshot){
  const rows=snapshot.map?.repositories;
  if(!Array.isArray(rows)||rows.length!==1||rows[0].scope_key!==snapshot.scope
    ||!validateAuthoringAdapterConfig(rows[0].adapter_config)||rows[0].adapter_config.source_repo!==snapshot.repo)return false;
  const config=rows[0].adapter_config,definitions=snapshot.definitions?.workflows;
  if(!Array.isArray(definitions)||definitions.length!==config.workflow_keys.length)return false;
  const gaps=[];checkAuthoringSnapshot(config,definitions,snapshot.canonical?.workflows||[],snapshot,code=>gaps.push(code));
  return gaps.length===0;
}
/** 只核验已正式authoring登记的版本；CI不能另行登记未验收的新版本。 */
export async function verifyAuthoringSnapshotSources(snapshot,options={}){
  if(!isAuthoringReleaseSnapshot(snapshot)||snapshot.status!=='verified')fail('authoring快照或地图尚未核验');
  for(const workflow of snapshot.definitions.workflows){
    const definition=workflow.payload.contract,proof=await prepareDefinitionFreeze(definition,options);
    if(workflow.source_repo!==proof.source.repo||workflow.source_path!==proof.source.path||workflow.source_commit!==proof.source.commit)fail('冻结定义来源与实际文件不一致');
    for(const ref of workflow.payload.activities){
      const activity=snapshot.definitions.activities.find(a=>a.id===ref.activity_version_id&&a.activity_id===ref.activity_id);
      const expected=proof.bindings.get(ref.slot_key);
      if(!activity||!expected||definitionDigest(activity.payload.implementation_bindings)!==definitionDigest(expected))fail('冻结实现绑定与实际字节不一致');
    }
  }
}
