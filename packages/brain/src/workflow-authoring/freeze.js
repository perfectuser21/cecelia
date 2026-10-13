import { definitionDigest } from './contracts.js';
import { readFixedGitFile, validateGitSource } from './fixed-git-source.js';
import { validateImplementationBindings } from '../lib/implementation-bindings.js';
import { snapshotDefinitions } from '../lib/definition-versions.js';
import { assertStepsHaveReadback, declareStepsFromContract } from '../lib/contract-steps.js';
import { syncSteps } from '../../scripts/sync-steps-from-workspace.mjs';

export const FREEZE_PROTOCOL='definition-freeze-v1';
const prepared=new WeakMap();
const fail=(message,code='definition_freeze_proof_invalid')=>{throw Object.assign(new Error(message),{code,status:422});};

/** 网络核验在事务外完成；源JSON不含source，避免文件自引用commit。 */
export async function prepareDefinitionFreeze(definition, options={}) {
  const source={repo:definition.source?.repo,path:definition.source?.ref,revision:definition.source?.revision};
  validateGitSource(source);
  if(definition.activities.some(a=>a.reuse_activity_id))fail('冻结共享活动必须另有其固定来源核验，本协议仅接受owned活动');
  const readFile=options.readFile||((s)=>readFixedGitFile(s,options)),cache=new Map(),deadline=Date.now()+60000;
  let totalBytes=0;
  const read=async s=>{
    validateGitSource(s);const key=JSON.stringify([s.repo,s.path,s.revision]);
    if(!cache.has(key)){
      if(cache.size>=200||Date.now()>deadline)fail('来源核验超过文件数量或总时限');
      const content=await readFile(s);
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
  const bindings=new Map(),fixed={repo:source.repo,path:source.path,commit:source.revision};
  for(const activity of definition.activities){
    const verified=await validateImplementationBindings(activity,read,fixed);
    if(!verified.length||verified.some(b=>b.status!=='verified'))fail(`活动实现无法完整核验：${activity.key}`);
    bindings.set(activity.key,verified);
  }
  const proof={source:fixed,bindings,definition_sha256:definitionDigest(definition)};
  prepared.set(proof,definitionDigest({source:fixed,bindings:[...bindings],definition_sha256:proof.definition_sha256}));
  return proof;
}

export function assertPreparedFreeze(definition,proof) {
  if(!proof||!prepared.has(proof)||proof.definition_sha256!==definitionDigest(definition)
    ||prepared.get(proof)!==definitionDigest({source:proof.source,bindings:[...proof.bindings],definition_sha256:proof.definition_sha256}))fail('缺少匹配定义的真实来源核验证明');
}

export async function freezeRegisteredWorkflow(client,workflow,definition,activityIds,proof) {
  assertPreparedFreeze(definition,proof);
  const old=(await client.query('SELECT source_repo,source_path,source_workflow,source_capability FROM workflows WHERE id=$1',[workflow.id])).rows[0];
  if(old.source_workflow||old.source_capability||(old.source_repo&&old.source_repo!==proof.source.repo)||(old.source_path&&old.source_path!==proof.source.path))fail('工作流已属于其他来源，不能覆盖');
  await client.query('UPDATE workflows SET source_repo=$2,source_path=$3 WHERE id=$1',[workflow.id,proof.source.repo,proof.source.path]);
  await client.query('UPDATE workflow_activity_refs SET source_repo=$2,source_path=$3 WHERE workflow_id=$1 AND active',[workflow.id,proof.source.repo,proof.source.path]);
  const bindingsByActivity=new Map();
  for(const [index,activity] of definition.activities.entries()){
    bindingsByActivity.set(activityIds[index],proof.bindings.get(activity.key));
    const rows=(await client.query('SELECT id,key FROM steps WHERE activity_id=$1',[activityIds[index]])).rows;
    const registeredActivityKey=`${definition.key}.${activity.key}`;
    const steps=declareStepsFromContract({...activity,key:registeredActivityKey},`${definition.key}.${registeredActivityKey}`,rows);
    const conflicts=(await client.query('SELECT key FROM steps WHERE key=ANY($1::text[]) AND activity_id<>$2',[steps.map(s=>s.key),activityIds[index]])).rows;
    if(conflicts.length)fail('步骤已属于其他活动，不能覆盖');
    if(steps.length)await syncSteps(client,{capability:definition.key,steps},{manageTransaction:false});
    await client.query('UPDATE steps SET active=(key=ANY($2::text[])) WHERE activity_id=$1 AND active IS DISTINCT FROM (key=ANY($2::text[]))',[activityIds[index],steps.map(s=>s.key)]);
  }
  await snapshotDefinitions(client,{workflowIds:[workflow.id],source:proof.source,bindingsByActivity,documentsByWorkflow:new Map([[workflow.id,definition]]),registrationProtocol:FREEZE_PROTOCOL});
  const row=(await client.query('SELECT current_definition_version_id FROM workflows WHERE id=$1',[workflow.id])).rows[0];
  if(!row?.current_definition_version_id)fail('冻结版本回读失败');
  return {registration_protocol:FREEZE_PROTOCOL,current_definition_version_id:row.current_definition_version_id};
}
