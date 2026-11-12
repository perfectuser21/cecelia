import {afterEach,beforeEach,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {versionsDatabase} from '../fixtures/definition-versions-db.js';
import {minimumMapSchema} from '../fixtures/minimum-map-schema.js';
import {readFixedExistingOpsGitFixture} from '../../lib/__tests__/helpers/fixed-existing-ops-git-fixture.js';
import {EXISTING_OPS_IDENTITIES} from '../../lib/existing-ops-source.js';
import * as registration from '../../lib/existing-ops-registration.js';
import {refreshImplementationSnapshot} from '../../lib/implementation-ci-snapshot.js';
import * as frozenSource from '../../../../../scripts/ci/implementation-snapshot.mjs';
import {appendConsumerEvidence} from '../../lib/consumer-evidence-store.js';
const sourceFixture=readFixedExistingOpsGitFixture('227c14e6ff8970f5c408a8dc87e8b9d0f0d16cfe');
const {revision,paths}=sourceFixture;
const readSource=async path=>sourceFixture.read(path);
const options=extra=>({scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision,paths,readSource,checkMain:async()=>{},actor:'test-retired-factory-source',...extra});
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
async function factoryMap(sourceRevision=revision) {
  const decision=randomUUID(), manifestId=randomUUID(), binding=(entity_type,entity_id)=>({entity_type,entity_id,source_repo:'perfectuser21/cecelia',source_revision:sourceRevision});
  const manifest={scope_key:'cecelia-factory',schema_version:1,source_decision_id:decision,boundaries:[],crosscut_pool:[],shared_prerequisites:{applicable:false,items:[],reason:"两个现存工厂消费者独立验证来源，无共享执行前置"},value_streams:[{key:'factory',name:'研发工厂',perceiver:'主理人',order:1,brain_binding:binding('value_stream','aaaaaaaa-f0f0-4000-8000-000000000001')}],capabilities:EXISTING_OPS_IDENTITIES.map((i,n)=>({key:`F${n+2}`,name:i.workflow_key,order:n+1,value_stream_key:'factory',brain_binding:binding('capability',i.capability_id)}))};
  await fixture.db.query("INSERT INTO decisions(id,category,topic,decision,status) VALUES($1,'feature','test','真实工厂来源隔离测试','active')",[decision]);
  await fixture.db.query("INSERT INTO map_scope_repositories(scope_key,repo,adapter_key,adapter_config) VALUES('cecelia-factory','cecelia-factory-source','legacy-ledger-v1',$1)",[{source_repo:'perfectuser21/cecelia'}]);
  await fixture.db.query("INSERT INTO map_manifest_versions(id,scope_key,version,source_decision_id,manifest,digest,status,activated_at) VALUES($1,'cecelia-factory',1,$2,$3,$4,'active',NOW())",[manifestId,decision,manifest,'a'.repeat(64)]);
  await fixture.db.query("INSERT INTO map_projection_runs(scope_key,manifest_version_id,manifest_digest,fact_revisions,projector_version,projection_digest,status,activated_at) VALUES('cecelia-factory',$1,$2,$3,'fixture',$2,'active',NOW())",[manifestId,'a'.repeat(64),{'cecelia-factory-source':sourceRevision}]);
}
afterEach(async () => { await fixture?.close(); });


it('工厂来源锚点计划保留原字段，外来或不完整owner树拒绝', async()=>{
  await factoryMap();
  const query={scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision:'d'.repeat(40)};
  const before=await registration.readExistingOpsRegistry(fixture.db);
  const plan=await registration.prepareExistingOpsManifestAdvance(fixture.db,query);
  expect(plan.manifest.capabilities.map(n=>n.brain_binding.source_revision)).toEqual([query.revision,query.revision]);
  expect(plan.manifest.shared_prerequisites.reason).toBe('两个现存工厂消费者独立验证来源，无共享执行前置');
  expect(await registration.readExistingOpsRegistry(fixture.db)).toEqual(before);
  for(const change of [m=>m.capabilities[0].brain_binding.source_repo='foreign/repo',m=>m.capabilities[0].brain_binding.entity_id=randomUUID(),m=>m.capabilities[0].value_stream_key='foreign',m=>m.capabilities.pop(),m=>m.value_streams[0].brain_binding.source_revision='main']){
    const db={query:async(sql,args)=>{
      const result=await fixture.db.query(sql,args);
      if(sql.startsWith('SELECT * FROM map_manifest_versions')){const cloned={...result,rows:structuredClone(result.rows)};change(cloned.rows[0].manifest);return cloned;}
      return result;
    }};
    await expect(registration.prepareExistingOpsManifestAdvance(db,query)).rejects.toThrow('OPS_MANIFEST_IDENTITY_INVALID');
  }
});

it('生产refresh拒绝外部proof、scratch旗标及未认证来源；失败不追加历史',async()=>{
 await factoryMap();let reads=0;
 const q={scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision};
 const malformed=[{}, {workspace_revision:revision,brain_revisions:[revision],run_id:1,allowScratch:true},
   {workspace_revision:revision,brain_revisions:[revision],run_id:1,proof:{status:'verified'}},
   {workspace_revision:revision,brain_revisions:[revision,revision],run_id:1},
   {workspace_revision:revision,brain_revisions:[revision],run_id:0}];
 for(const workspace_consumer of malformed)await expect(refreshImplementationSnapshot(fixture.db,{...q,workspace_consumer},
  {resolveToken:async()=>'',fetchFn:async()=>{reads++;return {ok:false};}})).rejects.toMatchObject({code:'IMPLEMENTATION_CI_CONSUMER_REFRESH_INPUT_INVALID'});
 expect(reads).toBe(0);
 expect((await fixture.db.query('SELECT count(*)::int n FROM workflow_definition_versions')).rows[0].n).toBe(0);
});

it('scratch地图推进真实CAS冲突回滚，非scratch与外来scope在写入前拒绝',async()=>{
  await factoryMap();
  const query={scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision:'d'.repeat(40)};
  const before=(await fixture.db.query('SELECT id,digest,status FROM map_manifest_versions')).rows;
  const db={query:fixture.db.query.bind(fixture.db),connect:async()=>{
    // 真实并发登记改变当前冻结指针。
    const old=(await fixture.db.query("SELECT * FROM map_manifest_versions WHERE status='active'")).rows[0];
    const manifest=structuredClone(old.manifest);
    for(const node of [...manifest.value_streams,...manifest.capabilities])node.brain_binding.source_revision='e'.repeat(40);
    const {digestMapManifest}=await import('../../lib/map-manifest-schema.js');
    await fixture.db.query("UPDATE map_manifest_versions SET status='superseded' WHERE id=$1",[old.id]);
    await fixture.db.query("INSERT INTO map_manifest_versions(scope_key,version,source_decision_id,manifest,digest,status,activated_at) VALUES($1,2,$2,$3,$4,'active',NOW())",[old.scope_key,old.source_decision_id,manifest,digestMapManifest(manifest)]);
    return fixture.db.connect();
  }};
  await expect(frozenSource.advanceExistingOpsScratchManifest(db,query)).rejects.toMatchObject({code:'IMPLEMENTATION_CI_SCRATCH_MANIFEST_CONFLICT'});
  const after=(await fixture.db.query('SELECT id,digest,status FROM map_manifest_versions')).rows;
  expect(after).toHaveLength(2);
  expect(after.find(row=>row.id===before[0].id)).toEqual({...before[0],status:'superseded'});
  expect(after.filter(row=>row.status==='active')).toHaveLength(1);
  await expect(frozenSource.advanceExistingOpsScratchManifest(fixture.db,{...query,scope:'foreign'})).rejects.toMatchObject({code:'OPS_MANIFEST_IDENTITY_INVALID'});
  let reads=0;
  await expect(frozenSource.advanceExistingOpsScratchManifest({query:async sql=>{
    expect(sql).toBe('SELECT current_database() name');reads++;return {rows:[{name:'cecelia'}]};
  }},query)).rejects.toMatchObject({code:'IMPLEMENTATION_CI_SCRATCH_REQUIRED'});
  expect(reads).toBe(1);
});

const historyTables=['workflow_definition_versions','activity_definition_versions','map_manifest_versions','map_projection_runs','map_scope_repositories'];
async function state(){return {registry:await registration.readExistingOpsRegistry(fixture.db),tables:await Promise.all(historyTables.map(async table=>(await fixture.db.query(`SELECT * FROM ${table} ORDER BY 1`)).rows))};}
// 直接通过仍由infra来源登记使用的共用写入器建立既存历史；不授予旧F2/F3来源资格。
async function existingHistory(){
 const rows=[];
 for(const identity of EXISTING_OPS_IDENTITIES){
  const source={repo:'perfectuser21/cecelia',path:'legacy/consumer-evidence.json',commit:'a'.repeat(40)};
  const common={definition_scope:'consumer_evidence',contract:{executable:false},verification:{runtime_status:'not_evaluated'}};
  const activity=await appendConsumerEvidence(fixture.db,'activity',identity.activity_id,{...common,activity_id:identity.activity_id},source);
  const workflow=await appendConsumerEvidence(fixture.db,'workflow',identity.workflow_id,{...common,workflow_id:identity.workflow_id,activities:[{activity_id:identity.activity_id,activity_version_id:activity.id}]},source);
  await fixture.db.query('UPDATE activities SET current_definition_version_id=$1 WHERE id=$2',[activity.id,identity.activity_id]);
  await fixture.db.query('UPDATE workflows SET current_definition_version_id=$1 WHERE id=$2',[workflow.id,identity.workflow_id]);
  await fixture.db.query('UPDATE workflow_activity_refs SET activity_definition_version_id=$1 WHERE id=$2',[activity.id,identity.reference_id]);
  rows.push({identity,source,activity,workflow});
 }
 return rows;
}
it('共用历史写入器幂等且不可变，拒绝可执行伪历史并保留全部current',async()=>{
 const rows=await existingHistory(),before=await state();
 for(const {identity,source,activity,workflow} of rows){
  expect((await appendConsumerEvidence(fixture.db,'activity',identity.activity_id,activity.payload,source)).id).toBe(activity.id);
  expect((await appendConsumerEvidence(fixture.db,'workflow',identity.workflow_id,workflow.payload,source)).id).toBe(workflow.id);
  await expect(appendConsumerEvidence(fixture.db,'activity',identity.activity_id,{...activity.payload,contract:{executable:true}},source)).rejects.toMatchObject({code:'OPS_HISTORY_INPUT_INVALID'});
  for(const [table,row] of [['activity_definition_versions',activity],['workflow_definition_versions',workflow]]){
   await expect(fixture.db.query(`UPDATE ${table} SET source_path='forged' WHERE id=$1`,[row.id])).rejects.toMatchObject({code:'P0001'});
   await expect(fixture.db.query(`DELETE FROM ${table} WHERE id=$1`,[row.id])).rejects.toMatchObject({code:'P0001'});
  }
 }
 expect(await state()).toEqual(before);
});
it('当前固定Git缺退休入口时生产登记零写，已有历史与人改slot及current完整保留',async()=>{
 await existingHistory();await factoryMap();
 await fixture.db.query("UPDATE workflow_activity_refs SET slot_key='human_slot' WHERE id=$1",[EXISTING_OPS_IDENTITIES[0].reference_id]);
 const before=await state();
 await expect(registration.registerExistingOpsSources(fixture.db,options({expectedRegistrySha256:before.registry.registry_sha256}))).rejects.toMatchObject({code:'OPS_SOURCE_UNKNOWN'});
 expect(await state()).toEqual(before);
 for(const extra of [{expectedRegistrySha256:undefined},{checkMain:async()=>{throw Error('MAIN_MOVED');}}]){
  await expect(registration.registerExistingOpsSources(fixture.db,options({expectedRegistrySha256:before.registry.registry_sha256,...extra}))).rejects.toThrow();
  expect(await state()).toEqual(before);
 }
},180000);
it('真实PG刷新拒绝浮动main、错配commit和截断tree，不访问候选源码且历史地图零写',async()=>{
 await existingHistory();await factoryMap();const before=await state();
 const query={scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision};
 for(const [mode,code] of [['main','IMPLEMENTATION_CI_MAIN_MOVED'],['commit','IMPLEMENTATION_CI_SOURCE_COMMIT_MISMATCH'],['tree','IMPLEMENTATION_CI_SOURCE_TREE_INCOMPLETE']]){
  let contentReads=0;
  const fetchFn=async(url,request)=>{
   expect(request.redirect).toBe('error');
   if(url.endsWith('/commits/main'))return {ok:true,text:async()=>mode==='main'?'b'.repeat(40):revision};
   if(url.endsWith('/git/commits/'+revision))return {ok:true,json:async()=>({sha:mode==='commit'?'b'.repeat(40):revision,tree:{sha:sourceFixture.tree}})};
   if(url.endsWith('/git/trees/'+sourceFixture.tree+'?recursive=1'))return {ok:true,json:async()=>({sha:sourceFixture.tree,truncated:true,tree:sourceFixture.entries})};
   contentReads++;throw Error('unexpected candidate content read');
  };
  await expect(refreshImplementationSnapshot(fixture.db,query,{fetchFn,resolveToken:async()=>''})).rejects.toMatchObject({code});
  expect(contentReads).toBe(0);expect(await state()).toEqual(before);
 }
});
