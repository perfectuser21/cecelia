import {beforeEach,afterEach,it,expect} from 'vitest';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {versionsDatabase} from '../fixtures/definition-versions-db.js';
import {minimumMapSchema} from '../fixtures/minimum-map-schema.js';
import {EXISTING_OPS_IDENTITIES} from '../../lib/existing-ops-source.js';
import * as registration from '../../lib/existing-ops-registration.js';
import * as snapshotApi from '../../lib/implementation-ci-snapshot.js';
import {stepSha256} from '../../../scripts/sync-steps-from-workspace.mjs';
const root = fileURLToPath(new URL('../../../../../', import.meta.url));
// Freeze the actual checkout once: hosted CI deliberately has shallow history.
// This is test input provenance, never a claim that the candidate is trusted main.
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

async function registered(){
 const before=await registration.readExistingOpsRegistry(fixture.db);
 await registration.registerExistingOpsSources(fixture.db,options({expectedRegistrySha256:before.registry_sha256}));
 await factoryMap();return before;
}
const query=()=>({scope:'cecelia-kr',repo:'perfectuser21/cecelia',revision});
function rehash(s){const {snapshot_sha256,...body}=s;s.snapshot_sha256=stepSha256(body);return s;}
it('真实PG同事务KR导出独立Factory companion，父UNKNOWN不被子verified冒充且身份/current/8refs保持',async()=>{
 const before=await registered();
 const snapshot=await snapshotApi.exportImplementationSnapshot(fixture.db,query());
 expect(snapshot.status).toBe('unknown');
 expect(snapshot).toHaveProperty('admission_companion');
 const companion=snapshot.admission_companion;
 expect(companion.schema_version).toBe(1);expect(companion.purpose).toBe('admission_only');
 expect(companion.snapshot.status,JSON.stringify(companion.snapshot.gaps)).toBe('verified');
 expect(companion.snapshot.canonical.references).toHaveLength(8);
 expect(companion.snapshot.unverified_reference_ids).toHaveLength(6);
 expect(companion.snapshot.definitions.workflows).toHaveLength(2);
 expect(companion.snapshot.definitions.workflows.every(w=>w.payload.definition_scope==='consumer_evidence'&&w.payload.coverage.status==='unknown')).toBe(true);
 expect(snapshot.definitions.workflows).toHaveLength(0);
 expect(companion.snapshot).not.toHaveProperty('admission_companion');
 expect(snapshotApi.validateImplementationSnapshot(snapshot)).toBe(snapshot);
 expect(await registration.readExistingOpsRegistry(fixture.db)).toEqual(before);
 expect(snapshotApi.extractImplementationAdmissionSnapshots).toBeTypeOf('function');
 expect(()=>snapshotApi.extractImplementationAdmissionSnapshots(snapshot,['cecelia-kr','cecelia-factory'])).toThrow(/UNKNOWN/);
});
it('独立Factory身份/来源/schema/嵌套篡改即使重算外层hash仍拒绝',async()=>{
 await registered();const snapshot=await snapshotApi.exportImplementationSnapshot(fixture.db,query());
 expect(snapshot.admission_companion).toBeTruthy();
 for(const mutate of [c=>c.schema_version=2,c=>c.scope='foreign',c=>c.repo='attacker/repo',c=>c.revision='a'.repeat(40),c=>c.snapshot.canonical.references.pop(),c=>c.snapshot.admission_companion={},c=>c.snapshot.unverified_reference_ids.pop(),c=>c.snapshot.execution_status='verified',c=>c.snapshot.definitions.workflows[0].payload.coverage.status='verified',c=>c.snapshot.definitions.activities[0].payload.contract.executable=true,c=>c.snapshot.definitions.workflows[0].payload.coverage.verified_reference_ids=[],c=>c.snapshot.definitions.workflows[0].payload.coverage.unverified_reference_ids.pop(),c=>c.snapshot.definitions.workflows[0].payload.coverage.unverified_reference_ids[1]=c.snapshot.definitions.workflows[0].payload.coverage.unverified_reference_ids[0],c=>c.snapshot.definitions.workflows[0].payload.coverage.verified_reference_ids=[EXISTING_OPS_IDENTITIES[1].reference_id],c=>c.snapshot.definitions.workflows[0].payload.contract.key='foreign',c=>c.snapshot.definitions.activities[0].payload.contract.key='foreign',c=>c.snapshot.definitions.workflows[0].payload.contract.definition_scope='executable',c=>c.snapshot.definitions.activities[0].payload.contract.source_basis='candidate']){
  const forged=structuredClone(snapshot);mutate(forged.admission_companion);
  for(const row of [...forged.admission_companion.snapshot.definitions.workflows,...forged.admission_companion.snapshot.definitions.activities])row.payload_sha256=stepSha256({source:{repo:row.source_repo,path:row.source_path,commit:row.source_commit},payload:row.payload});
  rehash(forged.admission_companion.snapshot);
  const {companion_sha256,...body}=forged.admission_companion;forged.admission_companion.companion_sha256=stepSha256(body);rehash(forged);
  expect(()=>snapshotApi.validateImplementationSnapshot(forged)).toThrow();
 }
});
it('旧single及Factory导出均不混其它scope，缺companion的显式joint提取必须拒绝',async()=>{
 await registered();const factory=await snapshotApi.exportImplementationSnapshot(fixture.db,{...query(),scope:'cecelia-factory'});
 expect(factory).not.toHaveProperty('admission_companion');
 expect(snapshotApi.extractImplementationAdmissionSnapshots).toBeTypeOf('function');
 expect(()=>snapshotApi.extractImplementationAdmissionSnapshots(factory,['cecelia-kr','cecelia-factory'])).toThrow();
});

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
it('真实PG双verified提取独立scope且不混定义，不改current或8refs',async()=>{
 const before=await registered();await registerKr();
 const snapshot=await snapshotApi.exportImplementationSnapshot(fixture.db,query());
 expect(snapshot.status,JSON.stringify(snapshot.gaps)).toBe('verified');
 const extracted=snapshotApi.extractImplementationAdmissionSnapshots(snapshot,['cecelia-kr','cecelia-factory']);
 expect(extracted.map(s=>s.scope)).toEqual(['cecelia-kr','cecelia-factory']);
 expect(extracted[0].definitions.workflows).toHaveLength(1);
 expect(extracted[1].definitions.workflows).toHaveLength(2);
 const temp=mkdtempSync(join(tmpdir(),'admission-companion-cli-'));
 try{
  const input=join(temp,'head.json'),scopes=join(temp,'scopes.json'),output=join(temp,'out');
  writeFileSync(input,JSON.stringify({snapshot}));writeFileSync(scopes,JSON.stringify({schema_version:1,scopes:['cecelia-kr','cecelia-factory']}));
  const child=spawnSync(process.execPath,[join(root,'scripts/ci/implementation-pr-gate.mjs'),'--extract-scopes','--snapshot-file',input,'--scopes-file',scopes,'--side','head','--output-dir',output],{encoding:'utf8'});
  expect(child.status,child.stderr).toBe(0);expect(child.stdout).toBe('admission_source_only: EXTRACTED\n');
  for(const original of extracted)expect(JSON.parse(readFileSync(join(output,`head-${original.scope}.json`),'utf8'))).toEqual(original);
 }finally{rmSync(temp,{recursive:true,force:true});}

 expect(await registration.readExistingOpsRegistry(fixture.db)).toEqual(before);
 const legacy=structuredClone(snapshot);delete legacy.admission_companion;rehash(legacy);
 expect(snapshotApi.extractImplementationAdmissionSnapshots(legacy,['cecelia-kr'])).toEqual([legacy]);
 expect(()=>snapshotApi.extractImplementationAdmissionSnapshots(legacy,['cecelia-kr','cecelia-factory'])).toThrow();
});
it('子来源缺失保留UNKNOWN，legacy父verified仍可用，joint必须拒绝',async()=>{
 await factoryMap();await registerKr();
 const snapshot=await snapshotApi.exportImplementationSnapshot(fixture.db,query());
 expect(snapshot.status).toBe('verified');expect(snapshot.admission_companion.snapshot.status).toBe('unknown');
 expect(snapshotApi.validateImplementationSnapshot(snapshot)).toBe(snapshot);
 expect(snapshotApi.extractImplementationAdmissionSnapshots(snapshot,['cecelia-kr'])).toEqual([snapshot]);
 expect(()=>snapshotApi.extractImplementationAdmissionSnapshots(snapshot,['cecelia-kr','cecelia-factory'])).toThrow(/UNKNOWN/);
});
