/** 跨版本实现仅凭完整固定Git核验放行；调用方不能用布尔值或序列化对象自证。 */
import {definitionDigest} from './contracts.js';
import {FREEZE_PROTOCOL} from './freeze.js';
import {isAuthoringReleaseSnapshot,verifyAuthoringSnapshotSources} from './ci-adapter.js';

const verified=new WeakMap();
const fail=()=>{throw Object.assign(Error('authoring发布来源证明不匹配'),{code:'AUTHORING_RELEASE_PROOF_INVALID'});};
export async function prepareAuthoringReleaseProof(snapshot,options={}){
 const {snapshot_sha256,...body}=snapshot;
 if(snapshot_sha256!==definitionDigest(body)||snapshot.status!=='verified'||snapshot.gaps?.length
   ||!isAuthoringReleaseSnapshot(snapshot))fail();
 const required=new Set(snapshot.definitions.workflows.flatMap(w=>w.payload.activities.map(r=>r.activity_version_id)));
 if(required.size!==snapshot.definitions.activities.length||snapshot.definitions.activities.some(a=>!required.has(a.id)
   ||a.payload?.registration_protocol!==FREEZE_PROTOCOL))fail();
 // refs/steps不能靠自洽删减缩小回归计划；完整有序集合须与真实Git合同一致。
 for(const workflow of snapshot.definitions.workflows){
  const declared=workflow.payload.contract.activities,refs=workflow.payload.activities;
  if(refs.length!==declared.length)fail();
  for(const [index,contract] of declared.entries()){
   const ref=refs[index],activity=snapshot.definitions.activities.find(a=>a.id===ref.activity_version_id&&a.activity_id===ref.activity_id);
   if(!activity||ref.slot_key!==contract.key||ref.sequence_no!==index+1)fail();
   const steps=activity.payload.steps,expected=contract.steps||[];
   if(!Array.isArray(steps)||steps.length!==expected.length||new Set(steps.map(step=>step.step_id)).size!==steps.length)fail();
   for(const [i,step] of steps.entries())if(step.locator?.activity_id!==activity.activity_id
     ||step.locator.step_key!==expected[i].key||definitionDigest(step.contract)!==definitionDigest(expected[i]))fail();
  }
 }
 const snapshotDigest=definitionDigest(snapshot);
 await verifyAuthoringSnapshotSources(snapshot,options);
 if(definitionDigest(snapshot)!==snapshotDigest)fail();
 const sources=snapshot.definitions.activities.flatMap(a=>(a.payload.implementation_bindings||[]).map(b=>({
  activity_id:a.activity_id,activity_definition_version_id:a.id,
  ...Object.fromEntries(['kind','repo','path','revision','digest','scope','step_key','field','index','resolved_source'].filter(k=>b[k]!==undefined).map(k=>[k,b[k]])),
 })));
 sources.sort((a,b)=>definitionDigest(a).localeCompare(definitionDigest(b)));
 const proof={snapshot_sha256,implementation_source_set:sources};
 verified.set(proof,{snapshot:snapshotDigest,proof:definitionDigest(proof)});
 return proof;
}
export function assertAuthoringReleaseProof(snapshot,proof){
 const expected=proof&&verified.get(proof);
 if(!expected||expected.snapshot!==definitionDigest(snapshot)||expected.proof!==definitionDigest(proof))fail();
 return proof.implementation_source_set;
}
