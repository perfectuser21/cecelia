import { afterEach, beforeEach, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { versionsDatabase } from '../fixtures/definition-versions-db.js';
import { EXISTING_OPS_IDENTITIES } from '../../lib/existing-ops-source.js';
import * as registration from '../../lib/existing-ops-registration.js';
import { minimumMapSchema } from '../fixtures/minimum-map-schema.js';
import { exportImplementationSnapshot,refreshImplementationSnapshot } from '../../lib/implementation-ci-snapshot.js';
import { randomUUID,createHash } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import {createImplementationCiRouter} from '../../routes/implementation-ci.js';
import {prepareNativeConsumerSelection,selectNativeConsumerDefinition} from '../../lib/native-consumer-source-selection.js';
import {stepSha256} from '../../../scripts/sync-steps-from-workspace.mjs';

const root = fileURLToPath(new URL('../../../../../', import.meta.url));
// 一次冻结真实 checkout；CI 浅历史不依赖旧提交，也不授予候选 main 身份。
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const paths = execFileSync('git', ['ls-tree', '-rz', '--name-only', revision], { cwd: root, encoding: 'utf8' }).replace(/\0$/, '').split('\0');
const cache = new Map();
const readSource = async path => {
  if (!cache.has(path)) cache.set(path, execFileSync('git', ['show', `${revision}:${path}`], { cwd: root, encoding: 'utf8', maxBuffer: 16000000 }));
  return cache.get(path);
};
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

// 真实固定 Git 内容经模拟 GitHub transport 传递；不向生产发请求、不注入 proof。
const treeSha=execFileSync('git',['rev-parse',`${revision}^{tree}`],{cwd:root,encoding:'utf8'}).trim();
const entries=execFileSync('git',['ls-tree','-rz',revision],{cwd:root,encoding:'utf8',maxBuffer:16e6}).split('\0').filter(Boolean).map(line=>{
 const [meta,path]=line.split('\t'),[mode,type,sha]=meta.split(' ');return {mode,type,sha,path};
});
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
function withoutBuildSelector(text){
 const marker='export const EXISTING_OPS_BUILD_SELECTOR_SCHEMA = 1;';
 expect(text.split(marker)).toHaveLength(2);
 const changed=text.replace(marker,'export const EXISTING_OPS_BUILD_SELECTOR_SCHEMA = 0;');
 expect(changed).not.toBe(text);
 return changed;
}
async function twoGenerations(extra={}){
 const before=await registration.readExistingOpsRegistry(fixture.db);
 // 当前协议下用真实 build 选择器关闭生成完整旧代；原52a的535/644事故证据保留在历史回放。
 const old=await registration.registerExistingOpsSources(fixture.db,options({expectedRegistrySha256:before.registry_sha256,
  readSource:async path=>path==='packages/brain/src/lib/existing-ops-source.js'
   ?withoutBuildSelector(await readSource(path)):readSource(path)}));
 const fresh=await registration.registerExistingOpsSources(fixture.db,options({expectedRegistrySha256:before.registry_sha256,...extra}));
 await factoryMap();
 return {old,fresh};
}
async function history(){return {
 registry:await registration.readExistingOpsRegistry(fixture.db),
 workflows:(await fixture.db.query('SELECT * FROM workflow_definition_versions ORDER BY id')).rows,
 maps:(await fixture.db.query('SELECT * FROM map_manifest_versions ORDER BY id')).rows,
 projections:(await fixture.db.query('SELECT * FROM map_projection_runs ORDER BY id')).rows,
 activities:(await fixture.db.query('SELECT * FROM activity_definition_versions ORDER BY id')).rows,
};}
it('same-SHA 两代完整链：唯一固定Git匹配导出且不改历史/current/登记',async()=>{
 const {old,fresh}=await twoGenerations();
 const oldF3=old.definitions.activities.find(a=>a.payload.contract.key==='factory_f3_ops');
 const newF3=fresh.definitions.activities.find(a=>a.payload.contract.key==='factory_f3_ops');
 expect(newF3.payload.implementation_bindings.length).toBeGreaterThan(oldF3.payload.implementation_bindings.length);
 expect(newF3.id).not.toBe(oldF3.id);
 const before=await history(),source=transport();
 const snapshot=await exportImplementationSnapshot(fixture.db,{scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision},{nativeConsumerSourceOptions:source});
 expect(snapshot.status,JSON.stringify(snapshot.gaps)).toBe('verified');
 expect(snapshot.definitions.activities.map(a=>a.id)).toContain(newF3.id);
 expect(snapshot.definitions.activities.map(a=>a.id)).not.toContain(oldF3.id);
 expect(await history()).toEqual(before);
 expect(source.calls.length).toBeGreaterThan(100);
},120000);

it('factory refresh实际collector不匹配目标源码时409且任何历史/current/地图均零写',async()=>{
 await factoryMap();const before=await history();
 const changed=withoutBuildSelector(await readSource('packages/brain/src/lib/existing-ops-source.js'));
 const source=transport((url,value)=>url.includes('/contents/packages/brain/src/lib/existing-ops-source.js')
  ?changed:value);
 await expect(refreshImplementationSnapshot(fixture.db,{scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision},source))
  .rejects.toMatchObject({code:'IMPLEMENTATION_CI_SOURCE_RUNTIME_MISMATCH',status:409});
 expect(await history()).toEqual(before);
},120000);

const query={scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision};
function server(source){const app=express();app.use(express.json());app.use('/ci',createImplementationCiRouter({pool:fixture.db,refreshOptions:source}));return app;}
it('HTTP GET/refresh与KR companion同一选版，重复GET只复用纯Git且不持有网络DB事务',async()=>{
 const {fresh}=await twoGenerations(),source=transport(),before=await history();
 let inTx=false;const realConnect=fixture.db.connect;
 fixture.db.connect=async()=>{const c=await realConnect();return {...c,query:async(sql,...args)=>{if(sql.startsWith('BEGIN'))inTx=true;if(['COMMIT','ROLLBACK'].includes(sql))inTx=false;return c.query(sql,...args);}};};
 const original=source.fetchFn;source.fetchFn=async(...args)=>{if(!args[0].endsWith('/commits/main'))expect(inTx).toBe(false);return original(...args);};
 const app=server(source),first=await request(app).get('/ci/snapshot').query(query);
 expect(first.status).toBe(200);expect(first.body.snapshot.status).toBe('verified');
 const calls=source.calls.length,second=await request(app).get('/ci/snapshot').query(query);
 expect(second.body.snapshot).toEqual(first.body.snapshot);expect(source.calls.length).toBe(calls);
 const companion=await request(app).get('/ci/snapshot').query({...query,scope:'cecelia-kr'});
 expect(companion.body.snapshot.admission_companion.snapshot).toEqual(first.body.snapshot);
 expect(source.calls.length).toBe(calls);
 const refreshed=await request(app).post('/ci/refresh').send(query);
 expect(refreshed.status,refreshed.body).toBe(200);expect(refreshed.body.snapshot).toEqual(first.body.snapshot);
 expect(refreshed.body.snapshot.definitions.workflows.map(w=>w.id).sort()).toEqual(fresh.definitions.workflows.map(w=>w.id).sort());
 expect(await history()).toEqual(before);
},120000);
it('认证runtime-source只返回当前固定十六hash，客户端路径/伪proof不影响身份',async()=>{
 const source=transport(),response=await request(server(source)).get('/ci/runtime-source').query({paths:'/etc/passwd',proof:'fake'});
 expect(response.status).toBe(200);expect(Object.keys(response.body).sort()).toEqual(['files','git_sha','repo','schema_version']);
 expect(response.body.repo).toBe(query.repo);expect(response.body.files).toHaveLength(16);
 expect(response.body.files.map(file=>file.path)).toEqual(['source','runtime-source','us-compose-source','build-source','build-envelopes','workspace-source',
  'provenance-envelope','provenance-core-envelope','provenance-entry-envelopes','provenance-local-envelopes','stage-source','stage-envelopes','stage-modes','native-evidence-source','native-evidence-envelopes']
  .map(name=>`packages/brain/src/lib/existing-ops-${name}.js`).concat('packages/brain/src/lib/workspace-ci-source-bundle.js').sort());
 for(const file of response.body.files)expect(file.sha256).toBe(createHash('sha256').update(await readSource(file.path)).digest('hex'));
 expect(source.calls).toEqual([]);
});
it('非歧义旧定义与显式current保持原路径，零联网且不依据created_at择一',async()=>{
 const before=await registration.readExistingOpsRegistry(fixture.db);
 const receipt=await registration.registerExistingOpsSources(fixture.db,options({expectedRegistrySha256:before.registry_sha256}));await factoryMap();
 const source={fetchFn:()=>{throw Error('must not fetch');},resolveToken:()=>{throw Error('must not resolve');}};
 expect((await exportImplementationSnapshot(fixture.db,query,{nativeConsumerSourceOptions:source})).status).toBe('verified');
 const old=await registration.registerExistingOpsSources(fixture.db,options({expectedRegistrySha256:before.registry_sha256,
  readSource:async path=>path==='packages/brain/src/lib/existing-ops-source.js'?withoutBuildSelector(await readSource(path)):readSource(path)}));
 // 旧错误代更晚追加，唯一正确源仍不靠时间选择。
 const fixed=await exportImplementationSnapshot(fixture.db,query,{nativeConsumerSourceOptions:transport()});
 expect(fixed.definitions.workflows.map(w=>w.id).sort()).toEqual(receipt.definitions.workflows.map(w=>w.id).sort());
 const oldF3=old.definitions.workflows.find(w=>w.payload.key==='factory_f3_ops');
 await fixture.db.query('UPDATE workflows SET current_definition_version_id=$1 WHERE id=$2',[oldF3.id,oldF3.workflow_id]);
 const explicit=await exportImplementationSnapshot(fixture.db,query,{nativeConsumerSourceOptions:source});
 expect(explicit.definitions.workflows.map(w=>w.id)).toContain(oldF3.id);
 expect(explicit.gaps.some(g=>g.code==='definition_snapshot_ambiguous')).toBe(false);
},120000);
it('零个完整匹配继续UNKNOWN，旧完整封印不能代替固定Git来源',async()=>{
 await twoGenerations({readSource:async path=>(await readSource(path))+(path==='.github/workflows/nightly-regression.yml'?'\n# changed source\n':'')});
 const snapshot=await exportImplementationSnapshot(fixture.db,query,{nativeConsumerSourceOptions:transport()});
 expect(snapshot.status).toBe('unknown');expect(snapshot.gaps).toContainEqual(expect.objectContaining({code:'definition_snapshot_ambiguous'}));
},120000);
it('完整payload/ref/source/contract/registry都必须匹配，重复完整匹配仍拒绝',async()=>{
 const {fresh,old}=await twoGenerations(),source=transport(),proof=await prepareNativeConsumerSelection(fixture.db,query,source);
 const good=fresh.definitions.workflows.find(w=>w.payload.key==='factory_f3_ops'),bad=old.definitions.workflows.find(w=>w.payload.key==='factory_f3_ops');
 expect((await selectNativeConsumerDefinition(fixture.db,query,[good,bad],proof))?.id).toBe(good.id);
 expect(await selectNativeConsumerDefinition(fixture.db,query,[good,{...good,id:randomUUID()}],proof)).toBeNull();
 const changes=[w=>{w.payload.extra='unreviewed';},w=>{w.payload.activities[0].reference_id=randomUUID();},
  w=>{w.payload.coverage.verified_reference_ids=[];},w=>{w.payload.registration_sha256='0'.repeat(64);},w=>{w.payload.contract.executable=true;},
  w=>{w.source_path='.github/workflows/ci.yml';},w=>{w.source_commit='a'.repeat(40);},w=>{w.payload.source_set=[];}];
 for(const change of changes){const candidate=structuredClone(good);change(candidate);
  candidate.contract_sha256=stepSha256(candidate.payload.contract);candidate.payload_sha256=stepSha256({source:{repo:candidate.source_repo,path:candidate.source_path,commit:candidate.source_commit},payload:candidate.payload});
  expect(await selectNativeConsumerDefinition(fixture.db,query,[candidate,bad],proof)).toBeNull();
 }
 await fixture.db.query("UPDATE workflows SET name='changed during proof' WHERE id=$1",[good.workflow_id]);
 expect(await selectNativeConsumerDefinition(fixture.db,query,[good,bad],proof)).toBeNull();
},120000);
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
it.each(invalidSources)('固定Git读取失败 %s 仍UNKNOWN且不缓存失败',async(_name,change)=>{
 await twoGenerations();let broken=true;const source=transport((url,value)=>broken?change(url,value):value);
 const first=await exportImplementationSnapshot(fixture.db,query,{nativeConsumerSourceOptions:source});expect(first.status).toBe('unknown');
 broken=false;
 expect((await exportImplementationSnapshot(fixture.db,query,{nativeConsumerSourceOptions:source})).status).toBe('verified');
},120000);

it('目标Git实际collector闭包不同（blob封印正确）仍UNKNOWN',async()=>{
 await twoGenerations();const path='packages/brain/src/lib/existing-ops-source.js',changed=withoutBuildSelector(await readSource(path));
 const sha=createHash('sha1').update(`blob ${Buffer.byteLength(changed)}\0`).update(changed).digest('hex');
 const source=transport((url,value)=>url.includes('/git/trees/')?{...value,tree:value.tree.map(e=>e.path===path?{...e,sha}:e)}:url.includes(`/contents/${path}`)?changed:value);
 expect((await exportImplementationSnapshot(fixture.db,query,{nativeConsumerSourceOptions:source})).status).toBe('unknown');
},120000);
it('并发GET只单飞固定Git，证明完成后新registry必须重核',async()=>{
 await twoGenerations();const source=transport(),pool=fixture.createPool(3);
 const results=await Promise.all([1,2].map(()=>exportImplementationSnapshot(pool,query,{nativeConsumerSourceOptions:source})));
 expect(results.map(r=>r.status)).toEqual(['verified','verified']);expect(new Set(source.calls).size).toBe(source.calls.length);
 await fixture.db.query("UPDATE workflows SET name='new registry' WHERE key='factory_f3_ops'");
 const after=await exportImplementationSnapshot(pool,query,{nativeConsumerSourceOptions:source});
 expect(after.status).toBe('unknown');expect(after.gaps).toContainEqual(expect.objectContaining({code:'definition_snapshot_ambiguous'}));
},120000);

it.each(['registry','current'])('proof完成到RR开始之间%s变化用事务重读结果，不缓存预选ID',async(kind)=>{
 const {old}=await twoGenerations(),source=transport(),oldF3=old.definitions.workflows.find(w=>w.payload.key==='factory_f3_ops');
 const wrapper={query:fixture.db.query,connect:async()=>{
  expect(source.calls.length).toBeGreaterThan(100);
  if(kind==='registry')await fixture.db.query("UPDATE workflows SET name='between proof and RR' WHERE id=$1",[oldF3.workflow_id]);
  else await fixture.db.query('UPDATE workflows SET current_definition_version_id=$1 WHERE id=$2',[oldF3.id,oldF3.workflow_id]);
  return fixture.db.connect();
 }};
 const result=await exportImplementationSnapshot(wrapper,query,{nativeConsumerSourceOptions:source});
 if(kind==='registry'){expect(result.status).toBe('unknown');expect(result.gaps).toContainEqual(expect.objectContaining({code:'definition_snapshot_ambiguous'}));}
 else expect(result.definitions.workflows.map(w=>w.id)).toContain(oldF3.id);
},120000);
