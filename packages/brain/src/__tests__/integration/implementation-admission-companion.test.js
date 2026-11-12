import {beforeEach,afterEach,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {versionsDatabase} from '../fixtures/definition-versions-db.js';
import {minimumMapSchema} from '../fixtures/minimum-map-schema.js';
import {EXISTING_OPS_IDENTITIES} from '../../lib/existing-ops-source.js';
import * as snapshotApi from '../../lib/implementation-ci-snapshot.js';
import {stepSha256} from '../../../scripts/sync-steps-from-workspace.mjs';
const revision='227c14e6ff8970f5c408a8dc87e8b9d0f0d16cfe';
const query=()=>({scope:'cecelia-kr',repo:'perfectuser21/cecelia',revision});
function rehash(s){const {snapshot_sha256,...body}=s;s.snapshot_sha256=stepSha256(body);return s;}
let fixture;
beforeEach(async () => {
  fixture = await versionsDatabase(); await fixture.migrate(); await minimumMapSchema(fixture.db);
  await fixture.db.query("INSERT INTO value_streams(id,name) VALUES('aaaaaaaa-f0f0-4000-8000-000000000001','Factory')");
  for (const identity of EXISTING_OPS_IDENTITIES) {
    await fixture.db.query("INSERT INTO capabilities(id,name,parent_journey_id) VALUES($1,$2,'aaaaaaaa-f0f0-4000-8000-000000000001')", [identity.capability_id, identity.workflow_key]);
    await fixture.db.query("INSERT INTO workflows(id,capability_id,key,name,channel,status) VALUES($1,$2,$3,$3,'ops','paused')", [identity.workflow_id, identity.capability_id, identity.workflow_key]);
    for (const [i, reference] of [identity.reference_id, ...identity.unverified_reference_ids].entries()) {
      const activity = i === 0 ? identity.activity_id : reference;
      await fixture.db.query("INSERT INTO activities(id,name,status,workflow_id) VALUES($1,$2,'planned',$3)", [activity, `旧活动${i}`, identity.workflow_id]);
      await fixture.db.query("INSERT INTO workflow_activity_refs(id,workflow_id,activity_id,slot_key,sequence_no) VALUES($1,$2,$3,$4,$5)", [reference, identity.workflow_id, activity, `step_${i + 1}`, i + 1]);
    }
  }
});
async function factoryMap() {
  const decision=randomUUID(), manifestId=randomUUID(), binding=(entity_type,entity_id)=>({entity_type,entity_id,source_repo:'perfectuser21/cecelia',source_revision:revision});
  const manifest={scope_key:'cecelia-factory',schema_version:1,source_decision_id:decision,boundaries:[],crosscut_pool:[],shared_prerequisites:{applicable:false,items:[],reason:"两个现存工厂消费者独立验证来源，无共享执行前置"},value_streams:[{key:'factory',name:'研发工厂',perceiver:'主理人',order:1,brain_binding:binding('value_stream','aaaaaaaa-f0f0-4000-8000-000000000001')}],capabilities:EXISTING_OPS_IDENTITIES.map((i,n)=>({key:`F${n+2}`,name:i.workflow_key,order:n+1,value_stream_key:'factory',brain_binding:binding('capability',i.capability_id)}))};
  await fixture.db.query("INSERT INTO decisions(id,category,topic,decision,status) VALUES($1,'feature','test','真实工厂来源隔离测试','active')",[decision]);
  await fixture.db.query("INSERT INTO map_scope_repositories(scope_key,repo,adapter_key,adapter_config) VALUES('cecelia-factory','cecelia-factory-source','legacy-ledger-v1',$1)",[{source_repo:'perfectuser21/cecelia'}]);
  await fixture.db.query("INSERT INTO map_manifest_versions(id,scope_key,version,source_decision_id,manifest,digest,status,activated_at) VALUES($1,'cecelia-factory',1,$2,$3,$4,'active',NOW())",[manifestId,decision,manifest,'a'.repeat(64)]);
  await fixture.db.query("INSERT INTO map_projection_runs(scope_key,manifest_version_id,manifest_digest,fact_revisions,projector_version,projection_digest,status,activated_at) VALUES('cecelia-factory',$1,$2,$3,'fixture',$2,'active',NOW())",[manifestId,'a'.repeat(64),{'cecelia-factory-source':revision}]);
}
afterEach(async () => { await fixture?.close(); });
async function registerKr(){
 const rootId=randomUUID(),cap=randomUUID(),workflow=randomUUID(),decision=randomUUID(),manifestId=randomUUID();
 await fixture.db.query("INSERT INTO value_streams(id,name) VALUES($1,'公司KR')",[rootId]);
 await fixture.db.query("INSERT INTO capabilities(id,name,parent_journey_id) VALUES($1,'KR测试能力',$2)",[cap,rootId]);
 await fixture.db.query("INSERT INTO workflows(id,capability_id,key,name,channel,source_repo) VALUES($1,$2,'company_kr','KR','ops','perfectuser21/cecelia')",[workflow,cap]);
 const payload={workflow_id:workflow,capability_id:cap,key:'company_kr',contract:{key:'company_kr'},activities:[]},source={repo:'perfectuser21/cecelia',path:'packages/brain/config/company-kr-workflow.json',commit:revision};
 const row=(await fixture.db.query('INSERT INTO workflow_definition_versions(workflow_id,payload,payload_sha256,source_repo,source_path,source_commit,contract_sha256) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[workflow,payload,stepSha256({source,payload}),source.repo,source.path,revision,'a'.repeat(64)])).rows[0];
 await fixture.db.query('UPDATE workflows SET current_definition_version_id=$2 WHERE id=$1',[workflow,row.id]);
 const binding=(entity_type,entity_id)=>({entity_type,entity_id,source_repo:source.repo,source_revision:revision});
 const manifest={scope_key:'cecelia-kr',schema_version:1,source_decision_id:decision,value_streams:[{key:'kr',brain_binding:binding('value_stream',rootId)}],capabilities:[{key:'KR',value_stream_key:'kr',brain_binding:binding('capability',cap)}]};
 await fixture.db.query("INSERT INTO decisions(id,category,topic,decision,status) VALUES($1,'feature','test','KR隔离测试','active')",[decision]);
 await fixture.db.query("INSERT INTO map_scope_repositories(scope_key,repo,adapter_key,adapter_config) VALUES('cecelia-kr','cecelia-kr-source','legacy-ledger-v1',$1)",[{source_repo:source.repo}]);
 await fixture.db.query("INSERT INTO map_manifest_versions(id,scope_key,version,source_decision_id,manifest,digest,status,activated_at) VALUES($1,'cecelia-kr',1,$2,$3,$4,'active',NOW())",[manifestId,decision,manifest,'a'.repeat(64)]);
 await fixture.db.query("INSERT INTO map_projection_runs(scope_key,manifest_version_id,manifest_digest,fact_revisions,projector_version,projection_digest,status,activated_at) VALUES('cecelia-kr',$1,$2,$3,'fixture',$2,'active',NOW())",[manifestId,'a'.repeat(64),{'cecelia-kr-source':revision}]);
}
it('子来源缺失保留UNKNOWN，独立父来源可读取，跨scope联合提取必须拒绝',async()=>{
 await factoryMap();await registerKr();
 const snapshot=await snapshotApi.exportImplementationSnapshot(fixture.db,query());
 expect(snapshot.status).toBe('verified');expect(snapshot.admission_companion.snapshot.status).toBe('unknown');
 expect(snapshotApi.validateImplementationSnapshot(snapshot)).toBe(snapshot);
 expect(snapshotApi.extractImplementationAdmissionSnapshots(snapshot,['cecelia-kr'])).toEqual([snapshot]);
 expect(()=>snapshotApi.extractImplementationAdmissionSnapshots(snapshot,['cecelia-kr','cecelia-factory'])).toThrow(/UNKNOWN/);
});

it('未知子来源的companion身份、嵌套和执行资格不能由重算外层摘要伪造',async()=>{
 await factoryMap();await registerKr();
 const snapshot=await snapshotApi.exportImplementationSnapshot(fixture.db,query());
 for(const mutate of [c=>c.schema_version=2,c=>c.scope='foreign',c=>c.repo='attacker/repo',c=>c.revision='a'.repeat(40),c=>c.snapshot.admission_companion={},c=>c.snapshot.execution_status='verified']){
  const forged=structuredClone(snapshot);mutate(forged.admission_companion);rehash(forged.admission_companion.snapshot);
  const {companion_sha256,...body}=forged.admission_companion;forged.admission_companion.companion_sha256=stepSha256(body);rehash(forged);
  expect(()=>snapshotApi.validateImplementationSnapshot(forged)).toThrow();
 }
});
