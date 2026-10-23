import {stepSha256} from '../../../../packages/brain/scripts/sync-steps-from-workspace.mjs';
import {EXISTING_OPS_IDENTITIES as identities} from '../../../../packages/brain/src/lib/existing-ops-source.js';
const repo='perfectuser21/cecelia';
const seal=(body,key='snapshot_sha256')=>({...body,[key]:stepSha256(body)});
export function bundle(revision,{parentMissing=false,childMissing=false,parentGaps=null,parentManifest=null}={}){
 const registry={workflows:[],references:[],activities:[],steps:[],capabilities:[],value_streams:[{id:'aaaaaaaa-f0f0-4000-8000-000000000001'}]};
 const definitions={workflows:[],activities:[]};
 for(const i of identities){
  registry.workflows.push({id:i.workflow_id,key:i.workflow_key,capability_id:i.capability_id});
  registry.capabilities.push({id:i.capability_id,parent_journey_id:registry.value_streams[0].id});
  for(const [n,id] of [i.reference_id,...i.unverified_reference_ids].entries()){
   const activity_id=n===0?i.activity_id:id;
   registry.references.push({id,workflow_id:i.workflow_id,activity_id,slot_key:`step_${n+1}`,sequence_no:n+1,active:true});registry.activities.push({id:activity_id});
  }
 }
 const frozen=seal(registry,'registry_sha256');
 for(const i of identities){
  const common={definition_scope:'consumer_evidence',source_scope:'cecelia-factory',registration_sha256:frozen.registry_sha256,contract:{key:i.workflow_key,executable:false,definition_scope:'consumer_evidence',source_basis:'fixed_git_tree'}};
  const source={repo,path:'fixed-fixture.json',commit:revision};
  const activity={id:i.activity_id,activity_id:i.activity_id,source_repo:repo,source_path:source.path,source_commit:revision,payload:{...common,implementation_bindings:[]}};
  activity.payload_sha256=stepSha256({source,payload:activity.payload});definitions.activities.push(activity);
  const workflow={id:i.workflow_id,workflow_id:i.workflow_id,source_repo:repo,source_path:source.path,source_commit:revision,payload:{...common,capability_id:i.capability_id,coverage:{status:'unknown',verified_reference_ids:[i.reference_id],unverified_reference_ids:i.unverified_reference_ids},activities:[{reference_id:i.reference_id,activity_id:i.activity_id,activity_version_id:activity.id}]}};
  workflow.payload_sha256=stepSha256({source,payload:workflow.payload});definitions.workflows.push(workflow);
 }
 const child=seal({schema_version:1,scope:'cecelia-factory',repo,revision,status:childMissing?'unknown':'verified',gaps:childMissing?[{code:'definition_snapshot_missing'},{code:'scope_manifest_missing'}]:[],snapshot_scope:'consumer_evidence',execution_status:'unknown',consumer_registry:frozen,unverified_reference_ids:identities.flatMap(i=>i.unverified_reference_ids),canonical:{...registry,journeys:[]},definitions:childMissing?{workflows:[],activities:[]}:definitions,map:{},assertions:[]});
 const companion=seal({schema_version:1,purpose:'admission_only',scope:child.scope,repo,revision,snapshot:child},'companion_sha256');
 return {snapshot:seal({schema_version:1,scope:'cecelia-kr',repo,revision,status:parentMissing?'unknown':'verified',gaps:parentMissing?(parentGaps??[{code:'definition_snapshot_missing'}]):[],map:{manifest:parentManifest},canonical:{workflows:[],journeys:[]},definitions:{workflows:[],activities:[]},admission_companion:companion})};
}
