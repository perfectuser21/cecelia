import { afterEach, beforeEach, expect, it } from 'vitest';
import { execFileSync,spawnSync } from 'node:child_process';
import {mkdtempSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import { fileURLToPath } from 'node:url';
import { versionsDatabase } from '../fixtures/definition-versions-db.js';
import { EXISTING_OPS_IDENTITIES } from '../../lib/existing-ops-source.js';
import * as registration from '../../lib/existing-ops-registration.js';
import { minimumMapSchema } from '../fixtures/minimum-map-schema.js';
import { exportImplementationSnapshot,validateImplementationSnapshot } from '../../lib/implementation-ci-snapshot.js';
import {loadHistoricalImplementationContext} from '../../lib/implementation-context.js';
import * as snapshots from '../../lib/implementation-ci-snapshot.js';
import {stepSha256} from '../../../scripts/sync-steps-from-workspace.mjs';
import { randomUUID } from 'node:crypto';

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
async function factoryMap() {
  const decision=randomUUID(), manifestId=randomUUID(), binding=(entity_type,entity_id)=>({entity_type,entity_id,source_repo:'perfectuser21/cecelia',source_revision:revision});
  const manifest={scope_key:'cecelia-factory',schema_version:1,source_decision_id:decision,boundaries:[],crosscut_pool:[],shared_prerequisites:{applicable:false,items:[],reason:"两个现存工厂消费者独立验证来源，无共享执行前置"},value_streams:[{key:'factory',name:'研发工厂',perceiver:'主理人',order:1,brain_binding:binding('value_stream','aaaaaaaa-f0f0-4000-8000-000000000001')}],capabilities:EXISTING_OPS_IDENTITIES.map((i,n)=>({key:`F${n+2}`,name:i.workflow_key,order:n+1,value_stream_key:'factory',brain_binding:binding('capability',i.capability_id)}))};
  await fixture.db.query("INSERT INTO decisions(id,category,topic,decision,status) VALUES($1,'feature','test','真实工厂来源隔离测试','active')",[decision]);
  await fixture.db.query("INSERT INTO map_scope_repositories(scope_key,repo,adapter_key,adapter_config) VALUES('cecelia-factory','cecelia-factory-source','legacy-ledger-v1',$1)",[{source_repo:'perfectuser21/cecelia'}]);
  await fixture.db.query("INSERT INTO map_manifest_versions(id,scope_key,version,source_decision_id,manifest,digest,status,activated_at) VALUES($1,'cecelia-factory',1,$2,$3,$4,'active',NOW())",[manifestId,decision,manifest,'a'.repeat(64)]);
  await fixture.db.query("INSERT INTO map_projection_runs(scope_key,manifest_version_id,manifest_digest,fact_revisions,projector_version,projection_digest,status,activated_at) VALUES('cecelia-factory',$1,$2,$3,'fixture',$2,'active',NOW())",[manifestId,'a'.repeat(64),{'cecelia-factory-source':revision}]);
}
afterEach(async () => { await fixture?.close(); });
const options = extra => ({ scope: 'cecelia-factory', repo: 'perfectuser21/cecelia', revision, paths, readSource, checkMain: async () => {}, actor: 'test-real-main', ...extra });

// 固定08c/913/323真实字节摘要；323非main祖先，仅作scratch来源负边界，不授予生产准入。
const frozenWorkspace={"source_set": [{"repo": "perfectuser21/zenithjoy-workspace", "revision": "08c546027494496014690982354aba617a6490d0"}, {"repo": "perfectuser21/cecelia", "revision": "91317659645e4ff6aae1fb3d5dcdde77a5948330"}, {"repo": "perfectuser21/cecelia", "revision": "32363a5d1e1ba0f259ebc63ba14e9e6580bc691a"}], "bindings": [{"kind": "code", "repo": "perfectuser21/zenithjoy-workspace", "revision": "08c546027494496014690982354aba617a6490d0", "path": ".github/workflows/implementation-impact.yml", "content_sha256": "f565ae0255755d6a376b53c05479d9b039de4b35fa7cfb4a90dc71f33c10a956", "digest": "sha256:f565ae0255755d6a376b53c05479d9b039de4b35fa7cfb4a90dc71f33c10a956", "scope": "activity", "validation_scope": "consumer_source", "status": "verified"}, {"kind": "code", "repo": "perfectuser21/zenithjoy-workspace", "revision": "08c546027494496014690982354aba617a6490d0", "path": "scripts/ci/__tests__/implementation-impact-workflow.test.mjs", "content_sha256": "ec88e3896be0338a2ebadde2d33c7d0421c05b222a1a983ba2639156216b685d", "digest": "sha256:ec88e3896be0338a2ebadde2d33c7d0421c05b222a1a983ba2639156216b685d", "scope": "activity", "validation_scope": "consumer_source", "status": "verified"}, {"kind": "code", "repo": "perfectuser21/cecelia", "revision": "91317659645e4ff6aae1fb3d5dcdde77a5948330", "path": ".github/workflows/implementation-impact.yml", "content_sha256": "f5cc9005046be3e79d51d4c848001b4e85b075ec71323e7e68ab3aeceda82a92", "digest": "sha256:f5cc9005046be3e79d51d4c848001b4e85b075ec71323e7e68ab3aeceda82a92", "scope": "activity", "validation_scope": "consumer_source", "status": "verified"}, {"kind": "code", "repo": "perfectuser21/cecelia", "revision": "91317659645e4ff6aae1fb3d5dcdde77a5948330", "path": "packages/brain/src/migrate.js", "content_sha256": "f9aeea3f265c674050b6f64bfc1660495d9d309f280be179ebf80a77b2686567", "digest": "sha256:f9aeea3f265c674050b6f64bfc1660495d9d309f280be179ebf80a77b2686567", "scope": "activity", "validation_scope": "consumer_source", "status": "verified"}, {"kind": "code", "repo": "perfectuser21/cecelia", "revision": "91317659645e4ff6aae1fb3d5dcdde77a5948330", "path": "scripts/ci/implementation-pr-gate.mjs", "content_sha256": "83e71f5418bcfc989eeaf68027f3fd56a2e235a9f72bb5b816573fa614994c53", "digest": "sha256:83e71f5418bcfc989eeaf68027f3fd56a2e235a9f72bb5b816573fa614994c53", "scope": "activity", "validation_scope": "consumer_source", "status": "verified"}, {"kind": "code", "repo": "perfectuser21/zenithjoy-workspace", "revision": "08c546027494496014690982354aba617a6490d0", "path": ".github/workflows/pilot-release-verification.yml", "content_sha256": "fdc68dc91016746e02d0bfdca4a294675d0056d280b85a884964bd9052a30393", "digest": "sha256:fdc68dc91016746e02d0bfdca4a294675d0056d280b85a884964bd9052a30393", "scope": "activity", "validation_scope": "consumer_source", "status": "verified"}, {"kind": "code", "repo": "perfectuser21/zenithjoy-workspace", "revision": "08c546027494496014690982354aba617a6490d0", "path": "scripts/ci/__tests__/pilot-release-workflow.test.mjs", "content_sha256": "ca65ecec4f3f85d2b0fd4f3c85a3a129e33fea7d32f46f9cc08fc369638c6904", "digest": "sha256:ca65ecec4f3f85d2b0fd4f3c85a3a129e33fea7d32f46f9cc08fc369638c6904", "scope": "activity", "validation_scope": "consumer_source", "status": "verified"}, {"kind": "code", "repo": "perfectuser21/cecelia", "revision": "32363a5d1e1ba0f259ebc63ba14e9e6580bc691a", "path": ".github/workflows/pilot-release-verification.yml", "content_sha256": "a9d29ba854a7f6582278ce2b4072ee38666c02463a7cd052e9a171411080d2a3", "digest": "sha256:a9d29ba854a7f6582278ce2b4072ee38666c02463a7cd052e9a171411080d2a3", "scope": "activity", "validation_scope": "consumer_source", "status": "verified"}, {"kind": "code", "repo": "perfectuser21/cecelia", "revision": "32363a5d1e1ba0f259ebc63ba14e9e6580bc691a", "path": "scripts/ci/pilot-release-verification.mjs", "content_sha256": "e25af6408229ce4a67505aa45ac6a9af69b3532c6ad839d1e49ef94c5e4dd82a", "digest": "sha256:e25af6408229ce4a67505aa45ac6a9af69b3532c6ad839d1e49ef94c5e4dd82a", "scope": "activity", "validation_scope": "consumer_source", "status": "verified"}]};

async function crossSnapshot(basis='scratch_candidate') {
 const before=await registration.readExistingOpsRegistry(fixture.db);
 const receipt=await registration.registerExistingOpsSources(fixture.db,options({expectedRegistrySha256:before.registry_sha256}));await factoryMap();
 const identity=EXISTING_OPS_IDENTITIES.find(i=>i.workflow_key==='factory_f3_ops');
 const a=receipt.definitions.activities.find(a=>a.activity_id===identity.activity_id),w=receipt.definitions.workflows.find(w=>w.workflow_id===identity.workflow_id);
 const payload={...a.payload,source_set:[...frozenWorkspace.source_set,{repo:'perfectuser21/cecelia',revision}],implementation_bindings:[...a.payload.implementation_bindings,...frozenWorkspace.bindings],source_set_admission:{status:'verified',source_basis:basis,...(basis==='scratch_candidate'?{purpose:'admission_only'}:{})}};
 payload.source_set_sha256=stepSha256({source_set:payload.source_set,implementation_bindings:payload.implementation_bindings});
 const source={repo:a.source_repo,path:a.source_path,commit:a.source_commit};
 const av=(await fixture.db.query('INSERT INTO activity_definition_versions(activity_id,payload,payload_sha256,source_repo,source_path,source_commit,contract_sha256) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[a.activity_id,payload,stepSha256({source,payload}),source.repo,source.path,source.commit,a.contract_sha256])).rows[0];
 const wp={...w.payload,activities:w.payload.activities.map(r=>({...r,activity_version_id:av.id}))};
 await fixture.db.query('INSERT INTO workflow_definition_versions(workflow_id,payload,payload_sha256,source_repo,source_path,source_commit,contract_sha256) VALUES($1,$2,$3,$4,$5,$6,$7)',[w.workflow_id,wp,stepSha256({source,payload:wp}),source.repo,source.path,source.commit,w.contract_sha256]);
 const q={scope:'cecelia-factory',repo:'perfectuser21/zenithjoy-workspace',revision:frozenWorkspace.source_set[0].revision};
 return {snapshot:await exportImplementationSnapshot(fixture.db,q),before,q};
}
it('真实G两WF八refs保留，固定Workspace source_set仅scratch准入导出且不改Brain地图来源',async()=>{
 const {snapshot,before}=await crossSnapshot();expect(snapshot.status,JSON.stringify(snapshot.gaps)).toBe('verified');
 expect(snapshot.registry_source).toEqual({repo:'perfectuser21/cecelia',revision});expect(snapshot.definitions.workflows).toHaveLength(2);expect(snapshot.canonical.workflows).toHaveLength(2);expect(snapshot.canonical.references).toHaveLength(8);
 expect(snapshot.unverified_reference_ids).toHaveLength(6);expect(snapshot.execution_status).toBe('unknown');
 expect(snapshot.map.repositories[0].adapter_config.source_repo).toBe('perfectuser21/cecelia');expect(snapshot.definitions.workflows.every(w=>w.source_repo==='perfectuser21/cecelia'&&w.source_commit===revision)).toBe(true);
 expect(await registration.readExistingOpsRegistry(fixture.db)).toEqual(before);
 expect(()=>validateImplementationSnapshot(snapshot)).toThrow();
 expect(snapshots.validateImplementationSnapshotForDatabase).toBeTypeOf('function');
 await expect(snapshots.validateImplementationSnapshotForDatabase(fixture.db,snapshot)).resolves.toEqual(snapshot);
});
it('生产验证拒绝scratch来源，外部allowScratch旗标不得授予权限',async()=>{
 const {snapshot}=await crossSnapshot();const prod={query:async()=>({rows:[{name:'cecelia'}]})};
 await expect(snapshots.validateImplementationSnapshotForDatabase(prod,snapshot)).rejects.toThrow();
 expect(()=>validateImplementationSnapshot(snapshot,{allowScratch:true})).toThrow();
});
it('source_set未知/错hash和固定注册身份漂移均UNKNOWN，不伪装已准入',async()=>{
 const {snapshot}=await crossSnapshot();
 for(const mutate of [s=>s.source_set.push({...s.source_set[0]}),s=>s.registry_source.repo=s.repo,s=>s.definitions.activities.find(a=>a.payload.source_set).payload.source_set_sha256='0'.repeat(64),s=>s.consumer_registry.references.pop(),s=>s.execution_status='verified',s=>s.unverified_reference_ids.pop()]){
   const changed=structuredClone(snapshot);mutate(changed);const {snapshot_sha256,...body}=changed;changed.snapshot_sha256=stepSha256(body);
   await expect(snapshots.validateImplementationSnapshotForDatabase(fixture.db,changed)).rejects.toThrow();
 }
});

async function historicalQuery(){
 const {snapshot,q}=await crossSnapshot(),w=snapshot.definitions.workflows.find(w=>w.payload.key==='factory_f3_ops');
 await fixture.db.query("INSERT INTO graph_snapshot_versions(repo,source_revision,scanner_version,row_count,scanned_at) VALUES('cecelia-factory-source',$1,'fixture',0,NOW())",[revision]);
 const run=(await fixture.db.query("SELECT id FROM map_projection_runs WHERE scope_key='cecelia-factory' AND status='active'")).rows[0].id;
 for(const node of snapshot.map.manifest.manifest.capabilities)await fixture.db.query("INSERT INTO map_projection_nodes(run_id,node_id,node_type,node_key,name,attributes) VALUES($1,$2,'capability',$3,$3,$4)",[run,stepSha256(node.key),node.key,{canonical_entity_id:node.brain_binding.entity_id,mapping_status:'verified'}]);
 const binding=frozenWorkspace.bindings.find(b=>b.repo===q.repo);
 return {...q,kind:'code',path:binding.path,versionId:w.id};
}
it('public历史查询从真实Brain逻辑注册及严格F3封印选择来源，Workspace身份不改写定义',async()=>{
 const q=await historicalQuery(),gaps=[];const c=await loadHistoricalImplementationContext(fixture.db,q,gaps);
 expect(gaps).toEqual([]);expect(c.registryRepo).toBe('cecelia-factory-source');expect(c.scope_status).toBe('verified');
 expect(c.mapped.has(EXISTING_OPS_IDENTITIES.find(i=>i.workflow_key==='factory_f3_ops').capability_id)).toBe(true);
 expect(c.fact_revisions['cecelia-factory-source']).toBe(revision);
 expect((await fixture.db.query('SELECT source_repo FROM workflow_definition_versions WHERE id=$1',[q.versionId])).rows[0].source_repo).toBe('perfectuser21/cecelia');
});
it('public历史错实现SHA/path/F2版本或生产scratch来源不能借Brain注册当Workspace准入',async()=>{
 const q=await historicalQuery(),f2=(await fixture.db.query("SELECT id FROM workflow_definition_versions WHERE payload->>'key'='factory_f2_ops' LIMIT 1")).rows[0].id;
 for(const changed of [{...q,revision:'0'.repeat(40)},{...q,path:'scripts/ci/unknown.js'},{...q,versionId:f2}])await expect(loadHistoricalImplementationContext(fixture.db,changed,[])).rejects.toMatchObject({code:'MAP_IMPLEMENTATION_REPO_NOT_CONFIGURED'});
 const w=(await fixture.db.query('SELECT * FROM workflow_definition_versions WHERE id=$1',[q.versionId])).rows[0],source={repo:w.source_repo,path:w.source_path,commit:w.source_commit};
 for(const mutate of [p=>p.activities[0].reference_id=EXISTING_OPS_IDENTITIES[0].reference_id,p=>p.capability_id=EXISTING_OPS_IDENTITIES[0].capability_id]){
   const payload=structuredClone(w.payload);mutate(payload);
   const altered=(await fixture.db.query('INSERT INTO workflow_definition_versions(workflow_id,payload,payload_sha256,source_repo,source_path,source_commit,contract_sha256) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[w.workflow_id,payload,stepSha256({source,payload}),source.repo,source.path,source.commit,w.contract_sha256])).rows[0];
   await expect(loadHistoricalImplementationContext(fixture.db,{...q,versionId:altered.id},[])).rejects.toMatchObject({code:'MAP_IMPLEMENTATION_REPO_NOT_CONFIGURED'});
 }
 const badHash=(await fixture.db.query('INSERT INTO workflow_definition_versions(workflow_id,payload,payload_sha256,source_repo,source_path,source_commit,contract_sha256) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[w.workflow_id,w.payload,'0'.repeat(64),source.repo,source.path,source.commit,w.contract_sha256])).rows[0];
 await expect(loadHistoricalImplementationContext(fixture.db,{...q,versionId:badHash.id},[])).rejects.toMatchObject({code:'MAP_IMPLEMENTATION_REPO_NOT_CONFIGURED'});
 const prod={query:async(sql,args)=>sql==='SELECT current_database() name'?{rows:[{name:'cecelia'}]}:fixture.db.query(sql,args)};
 await expect(loadHistoricalImplementationContext(prod,q,[])).rejects.toMatchObject({code:'MAP_IMPLEMENTATION_REPO_NOT_CONFIGURED'});
});

async function workspaceParentMap(){
 const stream=randomUUID(),cap=randomUUID(),wf=randomUUID(),decision=randomUUID(),mid=randomUUID();
 const repo='perfectuser21/zenithjoy-workspace',commit=frozenWorkspace.source_set[0].revision;
 await fixture.db.query("INSERT INTO value_streams(id,name) VALUES($1,'Workspace fixture')",[stream]);
 await fixture.db.query("INSERT INTO capabilities(id,name,parent_journey_id) VALUES($1,'Workspace fixture',$2)",[cap,stream]);
 await fixture.db.query("INSERT INTO workflows(id,capability_id,key,name,channel,source_repo) VALUES($1,$2,'workspace_fixture','Workspace fixture','ops',$3)",[wf,cap,repo]);
 const payload={workflow_id:wf,capability_id:cap,key:'workspace_fixture',contract:{key:'workspace_fixture'},activities:[]},source={repo,path:'product-map/contracts/fixture.yaml',commit};
 await fixture.db.query('INSERT INTO workflow_definition_versions(workflow_id,payload,payload_sha256,source_repo,source_path,source_commit,contract_sha256) VALUES($1,$2,$3,$4,$5,$6,$7)',[wf,payload,stepSha256({source,payload}),repo,source.path,commit,'a'.repeat(64)]);
 const binding=(entity_type,entity_id)=>({entity_type,entity_id,source_repo:repo,source_revision:commit});
 const manifest={scope_key:'zenithjoy',schema_version:1,source_decision_id:decision,value_streams:[{key:'fixture',brain_binding:binding('value_stream',stream)}],capabilities:[{key:'fixture',value_stream_key:'fixture',brain_binding:binding('capability',cap)}]};
 await fixture.db.query("INSERT INTO decisions(id,category,topic,decision,status) VALUES($1,'feature','fixture','隔离库跨仓输入测试','active')",[decision]);
 await fixture.db.query("INSERT INTO map_scope_repositories(scope_key,repo,adapter_key,adapter_config) VALUES('zenithjoy','workspace-fixture','legacy-ledger-v1',$1)",[{source_repo:repo}]);
 await fixture.db.query("INSERT INTO map_manifest_versions(id,scope_key,version,source_decision_id,manifest,digest,status,activated_at) VALUES($1,'zenithjoy',1,$2,$3,$4,'active',NOW())",[mid,decision,manifest,'a'.repeat(64)]);
 await fixture.db.query("INSERT INTO map_projection_runs(scope_key,manifest_version_id,manifest_digest,fact_revisions,projector_version,projection_digest,status,activated_at) VALUES('zenithjoy',$1,$2,$3,'fixture',$2,'active',NOW())",[mid,'a'.repeat(64),{'workspace-fixture':commit}]);
 return {scope:'zenithjoy',repo,revision:commit};
}
it('真实PG Workspace父导出显式跨仓companion，Brain anchor不改成Workspace SHA且scratch不授生产',async()=>{
 const {before}=await crossSnapshot();const q=await workspaceParentMap();
 const parent=await exportImplementationSnapshot(fixture.db,q);
 expect(parent.status,JSON.stringify(parent.gaps)).toBe('verified');
 expect(parent.admission_companion?.source_basis).toBe('cross_repo_source_set');
 expect(parent.admission_companion.registry_source).toEqual({repo:'perfectuser21/cecelia',revision});
 expect(parent.admission_companion.snapshot.revision).toBe(q.revision);
 const joint=await snapshots.extractImplementationAdmissionSnapshotsForDatabase(fixture.db,parent,['zenithjoy','cecelia-factory']);
 expect(joint.map(s=>s.scope)).toEqual(['zenithjoy','cecelia-factory']);
 expect(joint[1].definitions.workflows).toHaveLength(2);expect(joint[1].canonical.references).toHaveLength(8);
 expect(joint[1].unverified_reference_ids).toHaveLength(6);expect(joint[1].execution_status).toBe('unknown');
 expect(()=>snapshots.extractImplementationAdmissionSnapshots(parent,['zenithjoy','cecelia-factory'])).toThrow();
 const prod={query:async()=>({rows:[{name:'cecelia'}]})};
 await expect(snapshots.extractImplementationAdmissionSnapshotsForDatabase(prod,parent,['zenithjoy','cecelia-factory'])).rejects.toThrow();
 expect(await registration.readExistingOpsRegistry(fixture.db)).toEqual(before);
});
it('跨仓companion原样保留UNKNOWN，完整父单scope可用但不能联合准入',async()=>{
 const before=await registration.readExistingOpsRegistry(fixture.db);
 await registration.registerExistingOpsSources(fixture.db,options({expectedRegistrySha256:before.registry_sha256}));await factoryMap();
 const q=await workspaceParentMap(),parent=await exportImplementationSnapshot(fixture.db,q);
 expect(parent.status).toBe('verified');expect(parent.admission_companion.snapshot.status).toBe('unknown');
 expect(validateImplementationSnapshot(parent)).toEqual(parent);
 expect(snapshots.extractImplementationAdmissionSnapshots(parent,['zenithjoy'])).toEqual([parent]);
 expect(()=>snapshots.extractImplementationAdmissionSnapshots(parent,['zenithjoy','cecelia-factory'])).toThrow(/UNKNOWN/);
 const temp=mkdtempSync(join(tmpdir(),'workspace-companion-cli-'));
 try{
  const input=join(temp,'head.json'),scopes=join(temp,'scopes.json'),out=join(temp,'out');
  writeFileSync(input,JSON.stringify({snapshot:parent}));writeFileSync(scopes,JSON.stringify({schema_version:1,scopes:['zenithjoy','cecelia-factory']}));
  const run=spawnSync(process.execPath,[join(root,'scripts/ci/implementation-pr-gate.mjs'),'--extract-scopes','--snapshot-file',input,'--scopes-file',scopes,'--side','head','--output-dir',out],{encoding:'utf8'});
  expect(run.status).toBe(1);expect(run.stderr).toContain('IMPLEMENTATION_CI_ADMISSION_SNAPSHOT_UNKNOWN');
  expect(existsSync(out)).toBe(false);
 }finally{rmSync(temp,{recursive:true,force:true});}
 await fixture.db.query("DELETE FROM map_scope_repositories WHERE scope_key='cecelia-factory'");
 const missing=await exportImplementationSnapshot(fixture.db,q);
 expect(missing.admission_companion.snapshot.gaps.some(g=>g.code==='scope_repository_missing')).toBe(true);
 expect(snapshots.extractImplementationAdmissionSnapshots(missing,['zenithjoy'])).toEqual([missing]);
 expect(()=>snapshots.extractImplementationAdmissionSnapshots(missing,['zenithjoy','cecelia-factory'])).toThrow(/UNKNOWN/);
 await fixture.db.query('DELETE FROM workflow_activity_refs WHERE workflow_id=ANY($1::uuid[])',[EXISTING_OPS_IDENTITIES.map(i=>i.workflow_id)]);
 const drifted=await exportImplementationSnapshot(fixture.db,q);
 expect(drifted.admission_companion.snapshot.gaps.some(g=>g.code==='factory_registry_identity_invalid')).toBe(true);
 expect(snapshots.extractImplementationAdmissionSnapshots(drifted,['zenithjoy'])).toEqual([drifted]);
 expect(()=>snapshots.extractImplementationAdmissionSnapshots(drifted,['zenithjoy','cecelia-factory'])).toThrow(/UNKNOWN/);
});
it('跨仓声明、Brain anchor、冻结source_set或执行边界重算全部hash仍拒绝',async()=>{
 await crossSnapshot();const q=await workspaceParentMap(),parent=await exportImplementationSnapshot(fixture.db,q);
 const changes=[c=>c.source_basis='fixed_git_tree',c=>delete c.registry_source,c=>c.registry_source.revision=q.revision,
  c=>c.source_set.push({...c.source_set[0]}),c=>c.snapshot.source_set.push({...c.snapshot.source_set[0]}),
  c=>c.snapshot.registry_source.revision=q.revision,c=>c.snapshot.execution_status='verified',
  c=>c.snapshot.admission_companion={},c=>c.snapshot.definitions.activities.find(a=>a.payload.source_set).payload.source_set_admission.status='unknown',
  c=>c.snapshot.definitions.workflows[0].payload.coverage.verified_reference_ids=[EXISTING_OPS_IDENTITIES[1].reference_id]];
 for(const change of changes){
  const altered=structuredClone(parent),c=altered.admission_companion;change(c);
  for(const row of [...c.snapshot.definitions.workflows,...c.snapshot.definitions.activities])row.payload_sha256=stepSha256({source:{repo:row.source_repo,path:row.source_path,commit:row.source_commit},payload:row.payload});
  const {snapshot_sha256:_childHash,...child}=c.snapshot;c.snapshot.snapshot_sha256=stepSha256(child);
  const {companion_sha256:_companionHash,...body}=c;c.companion_sha256=stepSha256(body);
  const {snapshot_sha256:_parentHash,...outer}=altered;altered.snapshot_sha256=stepSha256(outer);
  await expect(snapshots.extractImplementationAdmissionSnapshotsForDatabase(fixture.db,altered,['zenithjoy','cecelia-factory'])).rejects.toThrow();
 }
});
