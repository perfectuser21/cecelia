import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {versionsDatabase} from '../fixtures/definition-versions-db.js';
import {minimumMapSchema} from '../fixtures/minimum-map-schema.js';
import {EXISTING_OPS_IDENTITIES} from '../../lib/existing-ops-source.js';
import * as registration from '../../lib/existing-ops-registration.js';
import {appendConsumerEvidence} from '../../lib/consumer-evidence-store.js';
import {createImplementationCiRouter} from '../../routes/implementation-ci.js';
import {randomUUID} from 'node:crypto';
import express from 'express';
import request from 'supertest';
const forbiddenNetwork=vi.hoisted(()=>({credentials:0}));
vi.mock('../../github-credentials.js',()=>({resolveGitHubToken:async()=>{forbiddenNetwork.credentials++;throw Error('retired source must not load credentials');}}));
const revision='b'.repeat(40);
let fixture;
beforeEach(async () => {
  forbiddenNetwork.credentials=0;
  vi.spyOn(globalThis,'fetch').mockImplementation(()=>{throw Error('retired source must not use global network');});
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
async function factoryMap(sourceRevision=revision) {
  const decision=randomUUID(), manifestId=randomUUID(), binding=(entity_type,entity_id)=>({entity_type,entity_id,source_repo:'perfectuser21/cecelia',source_revision:sourceRevision});
  const manifest={scope_key:'cecelia-factory',schema_version:1,source_decision_id:decision,boundaries:[],crosscut_pool:[],shared_prerequisites:{applicable:false,items:[],reason:"两个现存工厂消费者独立验证来源，无共享执行前置"},value_streams:[{key:'factory',name:'研发工厂',perceiver:'主理人',order:1,brain_binding:binding('value_stream','aaaaaaaa-f0f0-4000-8000-000000000001')}],capabilities:EXISTING_OPS_IDENTITIES.map((i,n)=>({key:`F${n+2}`,name:i.workflow_key,order:n+1,value_stream_key:'factory',brain_binding:binding('capability',i.capability_id)}))};
  await fixture.db.query("INSERT INTO decisions(id,category,topic,decision,status) VALUES($1,'feature','test','真实工厂来源隔离测试','active')",[decision]);
  await fixture.db.query("INSERT INTO map_scope_repositories(scope_key,repo,adapter_key,adapter_config) VALUES('cecelia-factory','cecelia-factory-source','legacy-ledger-v1',$1)",[{source_repo:'perfectuser21/cecelia'}]);
  await fixture.db.query("INSERT INTO map_manifest_versions(id,scope_key,version,source_decision_id,manifest,digest,status,activated_at) VALUES($1,'cecelia-factory',1,$2,$3,$4,'active',NOW())",[manifestId,decision,manifest,'a'.repeat(64)]);
  await fixture.db.query("INSERT INTO map_projection_runs(scope_key,manifest_version_id,manifest_digest,fact_revisions,projector_version,projection_digest,status,activated_at) VALUES('cecelia-factory',$1,$2,$3,'fixture',$2,'active',NOW())",[manifestId,'a'.repeat(64),{'cecelia-factory-source':sourceRevision}]);
}
afterEach(async () => {
 try{expect(forbiddenNetwork.credentials).toBe(0);expect(globalThis.fetch).not.toHaveBeenCalled();}finally{vi.restoreAllMocks();await fixture?.close();}
});
async function history(){return {
 registry:await registration.readExistingOpsRegistry(fixture.db),
 workflows:(await fixture.db.query('SELECT * FROM workflow_definition_versions ORDER BY id')).rows,
 maps:(await fixture.db.query('SELECT * FROM map_manifest_versions ORDER BY id')).rows,
 projections:(await fixture.db.query('SELECT * FROM map_projection_runs ORDER BY id')).rows,
 activities:(await fixture.db.query('SELECT * FROM activity_definition_versions ORDER BY id')).rows,
};}

const query={scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision};
// 直接建立已存在的不可变历史行，测试选版/隔离；不运行退休collector、不声称Git来源已审。
async function generation(label){
 const registry=await registration.readExistingOpsRegistry(fixture.db),definitions={workflows:[],activities:[]};
 for(const identity of EXISTING_OPS_IDENTITIES){
  const workflow=registry.workflows.find(w=>w.id===identity.workflow_id),source={repo:query.repo,commit:revision,path:identity.workflow_key==='factory_f2_ops'?'.github/workflows/brain-ci-deploy.yml':'.github/workflows/nightly-regression.yml'};
  const contract={key:identity.workflow_key,definition_scope:'consumer_evidence',executable:false,source_basis:'fixed_git_tree'};
  const common={source_scope:query.scope,definition_scope:'consumer_evidence',registration_sha256:registry.registry_sha256,contract};
  const activity=await appendConsumerEvidence(fixture.db,'activity',identity.activity_id,{...common,activity_id:identity.activity_id,definition_key:identity.workflow_key+'.'+identity.slot_key,steps:[],implementation_bindings:[],input_relations:[],verification:{runtime_status:'not_evaluated',historical_label:label}},source);
  const row=await appendConsumerEvidence(fixture.db,'workflow',identity.workflow_id,{...common,workflow_id:workflow.id,key:workflow.key,name:workflow.name,capability_id:workflow.capability_id,channel:workflow.channel,form:workflow.form,
   coverage:{status:'unknown',verified_reference_ids:[identity.reference_id],unverified_reference_ids:identity.unverified_reference_ids},
   activities:[{reference_id:identity.reference_id,slot_key:identity.slot_key,sequence_no:identity.sequence_no,activity_id:identity.activity_id,activity_version_id:activity.id,source_ref:registry.references.find(r=>r.id===identity.reference_id).source_ref}]},source);
  definitions.activities.push(activity);definitions.workflows.push(row);
 }
 return definitions;
}
async function twoGenerations(){const old=await generation('old'),fresh=await generation('fresh');await factoryMap();return {old,fresh};}
function server(source){const app=express();app.use(express.json());app.use('/ci',createImplementationCiRouter({pool:fixture.db,refreshOptions:source}));return app;}
const noSource = () => {
 const calls=[];
 return {calls,fetchFn:async url=>{calls.push(['fetch',url]);throw Error('retired source must not fetch');},resolveToken:async()=>{calls.push(['token']);throw Error('retired source must not resolve credentials');}};
};
it('HTTP退休factory refresh在凭据网络和PG写入前返回410',async()=>{
 await factoryMap();const before=await history(),source=noSource(),app=server(source);
 for(const body of [query,{...query,workspace_consumer:{workspace_revision:revision,brain_revisions:[revision],run_id:1}}]){
  const response=await request(app).post('/ci/refresh').send(body);
  expect(response.status,response.body).toBe(410);
  expect(response.body.error.code).toBe('IMPLEMENTATION_CI_FACTORY_COLLECTION_RETIRED');
 }
 expect(source.calls).toEqual([]);expect(await history()).toEqual(before);
});
it('HTTP退休runtime-source不返回旧collector身份',async()=>{
 const response=await request(server(noSource())).get('/ci/runtime-source').query({paths:'/etc/passwd',proof:'fake'});
 expect(response.status).toBe(410);expect(response.body.error.code).toBe('IMPLEMENTATION_CI_FACTORY_COLLECTION_RETIRED');
 expect(response.body.files).toBeUndefined();
});
it('HTTP同SHA歧义保持unknown且不再请求token或Git，无历史或current改写',async()=>{
 const {fresh}=await twoGenerations(),before=await history(),source=noSource(),app=server(source);
 for(const scope of [query.scope,'cecelia-kr']){
  const response=await request(app).get('/ci/snapshot').query({...query,scope,definition_id:fresh.workflows[0].id});
  expect(response.status,response.body).toBe(200);expect(response.body.snapshot.status).toBe('unknown');
  const snapshot=scope==='cecelia-kr'?response.body.snapshot.admission_companion.snapshot:response.body.snapshot;
  expect(snapshot.gaps).toContainEqual(expect.objectContaining({code:'definition_snapshot_ambiguous'}));
  expect(snapshot.definitions.workflows).toEqual([]);
 }
 expect(source.calls).toEqual([]);expect(await history()).toEqual(before);
});
it('HTTP唯一既有历史及显式current仍可读，consumer证据仍不能声称执行',async()=>{
 const one=await generation('only');await factoryMap();const source=noSource(),app=server(source);
 let response=await request(app).get('/ci/snapshot').query(query);
 expect(response.status,response.body).toBe(200);expect(response.body.snapshot.status).toBe('verified');
 expect(response.body.snapshot.execution_status).toBe('unknown');
 expect(response.body.snapshot.definitions.workflows.map(w=>w.id).sort()).toEqual(one.workflows.map(w=>w.id).sort());
 await generation('newer');
 for(const row of one.workflows)await fixture.db.query('UPDATE workflows SET current_definition_version_id=$1 WHERE id=$2',[row.id,row.workflow_id]);
 const before=await history();response=await request(app).get('/ci/snapshot').query(query);
 expect(response.body.snapshot.definitions.workflows.map(w=>w.id).sort()).toEqual(one.workflows.map(w=>w.id).sort());
 expect(source.calls).toEqual([]);expect(await history()).toEqual(before);
});
