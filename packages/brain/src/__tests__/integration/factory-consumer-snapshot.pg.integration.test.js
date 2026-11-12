import {afterEach,beforeEach,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {versionsDatabase} from '../fixtures/definition-versions-db.js';
import {minimumMapSchema} from '../fixtures/minimum-map-schema.js';
import {EXISTING_OPS_IDENTITIES} from '../../lib/existing-ops-source.js';
import {readExistingOpsRegistry} from '../../lib/existing-ops-registration.js';
import {exportImplementationSnapshot,validateImplementationSnapshot,validateImplementationSnapshotForDatabase} from '../../lib/implementation-ci-snapshot.js';
import {stepSha256} from '../../../scripts/sync-steps-from-workspace.mjs';

// 明确保存历史数据模型；不调用已经退役的源码收集器，也不赋予当前代码资格。
const revision='a68df7e48781bc38875d8581249049f57c4fe5de';
const workspaceRevision='08c546027494496014690982354aba617a6490d0';
const brainRepo='perfectuser21/cecelia',workspaceRepo='perfectuser21/zenithjoy-workspace';
const stream='aaaaaaaa-f0f0-4000-8000-000000000001';
let fixture;
beforeEach(async()=>{
 fixture=await versionsDatabase();await fixture.migrate();await minimumMapSchema(fixture.db);
 await fixture.db.query("INSERT INTO value_streams(id,name) VALUES($1,'历史来源')",[stream]);
 for(const identity of EXISTING_OPS_IDENTITIES){
  await fixture.db.query('INSERT INTO capabilities(id,name,parent_journey_id) VALUES($1,$2,$3)',[identity.capability_id,identity.workflow_key,stream]);
  await fixture.db.query("INSERT INTO workflows(id,capability_id,key,name,channel,status) VALUES($1,$2,$3,$3,'ops','paused')",[identity.workflow_id,identity.capability_id,identity.workflow_key]);
  for(const [index,reference]of [identity.reference_id,...identity.unverified_reference_ids].entries()){
   const activity=index===0?identity.activity_id:reference;
   await fixture.db.query("INSERT INTO activities(id,name,status,workflow_id) VALUES($1,$2,'planned',$3)",[activity,'历史活动'+index,identity.workflow_id]);
   await fixture.db.query('INSERT INTO workflow_activity_refs(id,workflow_id,activity_id,slot_key,sequence_no) VALUES($1,$2,$3,$4,$5)',[reference,identity.workflow_id,activity,'step_'+(index+1),index+1]);
  }
 }
});
afterEach(async()=>{await fixture?.close();});
async function storedHistory(){
 const registry=await readExistingOpsRegistry(fixture.db),source={repo:brainRepo,path:'history/factory-consumer.json',commit:revision};
 const sourceSet=[{repo:brainRepo,revision},{repo:workspaceRepo,revision:workspaceRevision}];
 const bindings=[{kind:'code',repo:workspaceRepo,revision:workspaceRevision,path:'.github/workflows/implementation-impact.yml',content_sha256:'b'.repeat(64),digest:'sha256:'+'b'.repeat(64),scope:'activity',validation_scope:'consumer_source',status:'verified'}];
 for(const identity of EXISTING_OPS_IDENTITIES){
  const common={definition_scope:'consumer_evidence',source_scope:'cecelia-factory',registration_sha256:registry.registry_sha256,contract:{key:identity.workflow_key,executable:false,definition_scope:'consumer_evidence',source_basis:'fixed_git_tree'}};
  const payload={...common,activity_id:identity.activity_id,implementation_bindings:[],...(identity.workflow_key==='factory_f3_ops'?{
   source_set:sourceSet,implementation_bindings:bindings,source_set_sha256:stepSha256({source_set:sourceSet,implementation_bindings:bindings}),source_set_admission:{status:'verified',source_basis:'scratch_candidate',purpose:'admission_only'},
  }:{})};
  const activity=(await fixture.db.query('INSERT INTO activity_definition_versions(activity_id,payload,payload_sha256,source_repo,source_path,source_commit,contract_sha256) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[identity.activity_id,payload,stepSha256({source,payload}),source.repo,source.path,source.commit,'a'.repeat(64)])).rows[0];
  const workflowPayload={...common,workflow_id:identity.workflow_id,capability_id:identity.capability_id,key:identity.workflow_key,activities:[{activity_id:identity.activity_id,activity_version_id:activity.id,reference_id:identity.reference_id}],coverage:{status:'unknown',verified_reference_ids:[identity.reference_id],unverified_reference_ids:identity.unverified_reference_ids}};
  await fixture.db.query('INSERT INTO workflow_definition_versions(workflow_id,payload,payload_sha256,source_repo,source_path,source_commit,contract_sha256) VALUES($1,$2,$3,$4,$5,$6,$7)',[identity.workflow_id,workflowPayload,stepSha256({source,payload:workflowPayload}),source.repo,source.path,source.commit,'a'.repeat(64)]);
 }
 const decision=randomUUID(),manifestId=randomUUID(),binding=(entity_type,entity_id)=>({entity_type,entity_id,source_repo:brainRepo,source_revision:revision});
 const manifest={scope_key:'cecelia-factory',schema_version:1,source_decision_id:decision,value_streams:[{key:'factory',brain_binding:binding('value_stream',stream)}],capabilities:EXISTING_OPS_IDENTITIES.map((i,n)=>({key:'F'+(n+2),value_stream_key:'factory',brain_binding:binding('capability',i.capability_id)}))};
 await fixture.db.query("INSERT INTO decisions(id,category,topic,decision,status) VALUES($1,'feature','历史数据','只读快照夹具','active')",[decision]);
 await fixture.db.query("INSERT INTO map_scope_repositories(scope_key,repo,adapter_key,adapter_config) VALUES('cecelia-factory','cecelia-factory-source','legacy-ledger-v1',$1)",[{source_repo:brainRepo}]);
 await fixture.db.query("INSERT INTO map_manifest_versions(id,scope_key,version,source_decision_id,manifest,digest,status,activated_at) VALUES($1,'cecelia-factory',1,$2,$3,$4,'active',NOW())",[manifestId,decision,manifest,'a'.repeat(64)]);
 await fixture.db.query("INSERT INTO map_projection_runs(scope_key,manifest_version_id,manifest_digest,fact_revisions,projector_version,projection_digest,status,activated_at) VALUES('cecelia-factory',$1,$2,$3,'fixture',$2,'active',NOW())",[manifestId,'a'.repeat(64),{'cecelia-factory-source':revision}]);
 return {scope:'cecelia-factory',repo:workspaceRepo,revision:workspaceRevision};
}
async function historyRows(){
 const result=await fixture.db.query("SELECT 'activity' kind,id,payload,payload_sha256 FROM activity_definition_versions UNION ALL SELECT 'workflow',id,payload,payload_sha256 FROM workflow_definition_versions ORDER BY kind,id");
 return result.rows;
}
it('历史定义真实入库后仍可只读导出，原文与注册状态不变且不升级执行资格',async()=>{
 const query=await storedHistory(),before=await historyRows(),registry=await readExistingOpsRegistry(fixture.db);
 const snapshot=await exportImplementationSnapshot(fixture.db,query);
 expect(snapshot.status,JSON.stringify(snapshot.gaps)).toBe('verified');
 expect(snapshot.registry_source).toEqual({repo:brainRepo,revision});
 expect(snapshot.execution_status).toBe('unknown');
 expect(snapshot.definitions.activities).toHaveLength(2);
 expect(snapshot.definitions.activities.every(row=>row.payload.contract.executable===false)).toBe(true);
 await expect(validateImplementationSnapshotForDatabase(fixture.db,snapshot)).resolves.toEqual(snapshot);
 expect(await historyRows()).toEqual(before);
 expect(await readExistingOpsRegistry(fixture.db)).toEqual(registry);
});
it('scratch准入由真实数据库身份派生，生产默认校验和外部allowScratch旗标均不能授信',async()=>{
 const query=await storedHistory(),before=await historyRows();
 const name=(await fixture.db.query('SELECT current_database() name')).rows[0].name;
 expect(['cecelia_scratch','cecelia_test']).toContain(name);
 const snapshot=await exportImplementationSnapshot(fixture.db,query);
 await expect(validateImplementationSnapshotForDatabase(fixture.db,snapshot)).resolves.toEqual(snapshot);
 expect(()=>validateImplementationSnapshot(snapshot)).toThrow();
 expect(()=>validateImplementationSnapshot(snapshot,{allowScratch:true})).toThrow();
 const productionIdentity={query:async(sql,args)=>sql==='SELECT current_database() name'?fixture.db.query("SELECT 'cecelia'::text name"):fixture.db.query(sql,args)};
 await expect(validateImplementationSnapshotForDatabase(productionIdentity,snapshot)).rejects.toThrow();
 expect(await historyRows()).toEqual(before);
});
it('历史快照篡改即拒绝，真实数据库阻止改写不可变定义并保留原文',async()=>{
 const query=await storedHistory(),before=await historyRows(),snapshot=await exportImplementationSnapshot(fixture.db,query);
 const altered=structuredClone(snapshot),activity=altered.definitions.activities.find(row=>row.payload.source_set);
 activity.payload.source_set_admission.status='unknown';
 activity.payload_sha256=stepSha256({source:{repo:activity.source_repo,path:activity.source_path,commit:activity.source_commit},payload:activity.payload});
 const {snapshot_sha256,...body}=altered;altered.snapshot_sha256=stepSha256(body);
 await expect(validateImplementationSnapshotForDatabase(fixture.db,altered)).rejects.toThrow();
 await expect(fixture.db.query("UPDATE activity_definition_versions SET payload=payload||'{\"mutated\":true}'::jsonb WHERE id=$1",[activity.id])).rejects.toThrow('定义快照不可变');
 expect(await historyRows()).toEqual(before);
});
