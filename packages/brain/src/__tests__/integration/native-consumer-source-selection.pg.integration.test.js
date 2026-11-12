import {afterEach,beforeEach,expect,it} from 'vitest';
import {versionsDatabase} from '../fixtures/definition-versions-db.js';
import {minimumMapSchema} from '../fixtures/minimum-map-schema.js';
import {EXISTING_OPS_IDENTITIES,buildExistingOpsSources as buildCurrentSources} from '../../lib/existing-ops-source.js';
import {readFixedExistingOpsGitFixture,fixtureGit} from '../../lib/__tests__/helpers/fixed-existing-ops-git-fixture.js';
import {isolatedExistingOpsGitFixture} from '../../lib/__tests__/helpers/isolated-existing-ops-git-fixture.js';
import * as registration from '../../lib/existing-ops-registration.js';
import * as currentRegistration from '../../lib/existing-ops-registration.js';
import {exportImplementationSnapshot} from '../../lib/implementation-ci-snapshot.js';
import {prepareNativeConsumerSelection,selectNativeConsumerDefinition} from '../../lib/native-consumer-source-selection.js';
import {readNativeConsumerRuntime} from '../../lib/native-consumer-runtime.js';
import {appendConsumerEvidence} from '../../lib/consumer-evidence-store.js';
import {createImplementationCiRouter} from '../../routes/implementation-ci.js';
import {randomUUID} from 'node:crypto';
import express from 'express';
import request from 'supertest';
const sourceFixture=readFixedExistingOpsGitFixture(fixtureGit('rev-parse','HEAD').trim());
const {revision,paths,tree:treeSha,entries}=sourceFixture;
const readSource=async path=>sourceFixture.read(path);
import yaml from 'js-yaml';
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
const options = extra => ({ scope: 'cecelia-factory', repo: 'perfectuser21/cecelia', revision, paths, readSource, checkMain: async () => {}, actor: 'test-real-main', ...extra });

function transport(change=()=>{}){
 const calls=[];
 const fetchFn=async(url)=>{
  calls.push(url); let value;
  if(url.endsWith('/commits/main'))value=revision;
  else if(url.endsWith(`/git/commits/${revision}`))value={sha:revision,tree:{sha:treeSha}};
  else if(url.endsWith(`/git/trees/${treeSha}?recursive=1`))value={sha:treeSha,truncated:false,tree:structuredClone(entries)};
  else if(url.includes('/contents/')){
   const u=new URL(url),path=decodeURIComponent(u.pathname.split('/contents/')[1]);
   if(u.searchParams.get('ref')!==revision)throw Error('fixture revision mismatch');
   value=await readSource(path);
  }else throw Error(`unexpected GitHub request: ${url}`);
  value=change(url,value)??value;
  return {ok:true,json:async()=>value,text:async()=>typeof value==='string'?value:JSON.stringify(value)};
 };
 return {calls,fetchFn,resolveToken:async()=> 'fixture-only'};
}
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
it('唯一既有历史零联网读出，仍明确不代表Workflow执行成功',async()=>{
 const one=await generation('only');await factoryMap();const before=await history();
 const source={fetchFn:()=>{throw Error('must not fetch');},resolveToken:()=>{throw Error('must not resolve');}};
 const snapshot=await exportImplementationSnapshot(fixture.db,query,{nativeConsumerSourceOptions:source});
 expect(snapshot.status,JSON.stringify(snapshot.gaps)).toBe('verified');expect(snapshot.execution_status).toBe('unknown');
 expect(snapshot.definitions.workflows.map(w=>w.id).sort()).toEqual(one.workflows.map(w=>w.id).sort());expect(await history()).toEqual(before);
});
it('同SHA两代歧义不能按时间或历史条目数选版，失败不改历史current地图',async()=>{
 await twoGenerations();const before=await history(),source=transport(()=>{throw Error('offline');});
 const snapshot=await exportImplementationSnapshot(fixture.db,query,{nativeConsumerSourceOptions:source});
 expect(snapshot.status).toBe('unknown');expect(snapshot.gaps).toContainEqual(expect.objectContaining({code:'definition_snapshot_ambiguous'}));
 expect(snapshot.definitions.workflows).toEqual([]);expect(await history()).toEqual(before);
});
it('显式current优先于更新历史且零联网，不改既有current',async()=>{
 const {old}=await twoGenerations();
 for(const row of old.workflows)await fixture.db.query('UPDATE workflows SET current_definition_version_id=$1 WHERE id=$2',[row.id,row.workflow_id]);
 const before=await history(),source={fetchFn:()=>{throw Error('must not fetch');},resolveToken:()=>{throw Error('must not resolve');}};
 const snapshot=await exportImplementationSnapshot(fixture.db,query,{nativeConsumerSourceOptions:source});
 expect(snapshot.definitions.workflows.map(w=>w.id).sort()).toEqual(old.workflows.map(w=>w.id).sort());expect(await history()).toEqual(before);
});
it('缺少有效固定Git证明和跨repo/scope不能选择同SHA历史',async()=>{
 const {old,fresh}=await twoGenerations();const rows=[old.workflows[0],fresh.workflows[0]],before=await history();
 for(const q of [query,{...query,scope:'foreign'},{...query,repo:'foreign/repo'}])
  expect(await selectNativeConsumerDefinition(fixture.db,q,rows,null)).toBeNull();
 expect(await history()).toEqual(before);
});
const invalidSources=[
 ['commit drift',(url,v)=>url.includes('/git/commits/')?{...v,sha:'a'.repeat(40)}:v],
 ['truncated',(url,v)=>url.includes('/git/trees/')?{...v,truncated:true}:v],
 ['tree drift',(url,v)=>url.includes('/git/trees/')?{...v,sha:'a'.repeat(40)}:v],
 ['duplicate path',(url,v)=>url.includes('/git/trees/')?{...v,tree:[...v.tree,v.tree[0]]}:v],
 ['missing file',(url,v)=>url.includes('/git/trees/')?{...v,tree:v.tree.filter(e=>!e.path.endsWith('existing-ops-source.js'))}:v],
 ['symlink',(url,v)=>url.includes('/git/trees/')?{...v,tree:v.tree.map(e=>e.path.endsWith('existing-ops-source.js')?{...e,mode:'120000'}:e)}:v],
 ['blob mismatch',(url,v)=>url.includes('/contents/packages/brain/src/lib/existing-ops-source.js')?v+'\n':v],
 ['unavailable',()=>{throw Error('offline');}],
];

it.each(invalidSources)('固定Git读取失败 %s 不缓存失败且历史current地图零写',async(_name,change)=>{
 await twoGenerations();const before=await history(),source=transport(change);
 expect(await prepareNativeConsumerSelection(fixture.db,query,source)).toBeNull();const calls=source.calls.length;
 expect(calls).toBeGreaterThan(0);expect(await prepareNativeConsumerSelection(fixture.db,query,source)).toBeNull();
 expect(source.calls.length).toBeGreaterThan(calls);expect(await history()).toEqual(before);
},120000);
it('HTTP歧义GET和KR companion保持UNKNOWN，客户端不能强行选择历史ID',async()=>{
 const {fresh}=await twoGenerations(),source=transport(()=>{throw Error('offline');}),before=await history(),app=server(source);
 for(const scope of [query.scope,'cecelia-kr']){
  const response=await request(app).get('/ci/snapshot').query({...query,scope,definition_id:fresh.workflows[0].id});
  expect(response.status).toBe(200);expect(response.body.snapshot.status).toBe('unknown');
  if(scope==='cecelia-kr')expect(response.body.snapshot.admission_companion.snapshot.status).toBe('unknown');
 }
 expect(await history()).toEqual(before);
});
it('认证runtime-source只返回当前固定hash，客户端路径或伪proof不影响身份',async()=>{
 const response=await request(server({})).get('/ci/runtime-source').query({paths:'/etc/passwd',proof:'fake'}),runtime=readNativeConsumerRuntime();
 expect(response.status).toBe(200);expect(Object.keys(response.body).sort()).toEqual(['files','git_sha','repo','schema_version']);
 expect(response.body.files).toEqual(runtime.files);
});
it('并发失败证明不写数据库，registry变化不被缓存掩盖',async()=>{
 await twoGenerations();const source=transport(()=>{throw Error('offline');}),pool=fixture.createPool(3),before=await history();
 const results=await Promise.all([1,2].map(()=>exportImplementationSnapshot(pool,query,{nativeConsumerSourceOptions:source})));
 expect(results.map(r=>r.status)).toEqual(['unknown','unknown']);expect(await history()).toEqual(before);
 await fixture.db.query("UPDATE workflows SET name='new registry' WHERE key='factory_f3_ops'");
 const snapshot=await exportImplementationSnapshot(pool,query,{nativeConsumerSourceOptions:source});
 expect(snapshot.status).toBe('unknown');expect(snapshot.consumer_registry.workflows.some(w=>w.name==='new registry')).toBe(true);
});
it.each(['registry','current'])('进入RR前%s变化以数据库重读为准，不复用预选历史ID',async kind=>{
 const {old}=await twoGenerations(),source=transport(()=>{throw Error('offline');}),row=old.workflows[0];
 const wrapper={query:fixture.db.query,connect:async()=>{
  if(kind==='registry')await fixture.db.query("UPDATE workflows SET name='changed before RR' WHERE id=$1",[row.workflow_id]);
  else await fixture.db.query('UPDATE workflows SET current_definition_version_id=$1 WHERE id=$2',[row.id,row.workflow_id]);
  return fixture.db.connect();
 }};
 const snapshot=await exportImplementationSnapshot(wrapper,query,{nativeConsumerSourceOptions:source});
 if(kind==='registry')expect(snapshot.consumer_registry.workflows.some(w=>w.name==='changed before RR')).toBe(true);
 else expect(snapshot.definitions.workflows.map(w=>w.id)).toContain(row.id);
});

it('私有Git篡改实际workflow权限不能继承历史资格，当前登记拒绝且历史current和地图全部零写',async()=>{
 const current=readFixedExistingOpsGitFixture(fixtureGit('rev-parse','HEAD').trim()),before=await history();
 const workflow='.github/workflows/ci.yml',original=current.read(workflow),doc=yaml.load(original);
 const permission='permissions:\n  contents: read';expect(original.split(permission)).toHaveLength(2);
 expect(doc.permissions.contents).toBe('read');doc.permissions.contents='write';
 const changed=original.replace(permission,permission.replace('contents: read','contents: write'));
 expect(yaml.load(changed)).toEqual(doc);
 const bad=isolatedExistingOpsGitFixture({revision:current.revision,changes:{[workflow]:changed}});
 try{
  expect(bad.git('diff','--name-only',current.revision,bad.revision).trim().split('\n')).toEqual([workflow]);
  expect(bad.git('diff','--numstat',current.revision,bad.revision).trim()).toBe(`1\t1\t${workflow}`);
  const badOptions=options({revision:bad.revision,paths:bad.paths,readSource:async path=>bad.read(path),expectedRegistrySha256:before.registry.registry_sha256});
  const proof=await buildCurrentSources(badOptions),unknown=proof.consumers.find(c=>c.workflow_key==='factory_f3_ops');
  expect(unknown.status).toBe('unknown');expect(unknown.bindings).toEqual([]);expect(unknown.input_relations).toEqual([]);
  expect(unknown.gaps).toContainEqual(expect.objectContaining({code:'source_structure_unproven'}));
  await expect(currentRegistration.registerExistingOpsSources(fixture.db,badOptions)).rejects.toMatchObject({code:'OPS_SOURCE_UNKNOWN'});
  expect(await history()).toEqual(before);
 }finally{bad.close();}
});
