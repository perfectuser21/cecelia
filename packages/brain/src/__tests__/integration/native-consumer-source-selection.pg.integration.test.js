import { afterEach, beforeEach, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { versionsDatabase } from '../fixtures/definition-versions-db.js';
import { EXISTING_OPS_IDENTITIES } from '../../lib/existing-ops-source.js';
import * as registration from '../../lib/existing-ops-registration.js';
import { minimumMapSchema } from '../fixtures/minimum-map-schema.js';
import { exportImplementationSnapshot } from '../../lib/implementation-ci-snapshot.js';
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
  if(url.endsWith(`/git/commits/${revision}`))value={sha:revision,tree:{sha:treeSha}};
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
async function twoGenerations(){
 const before=await registration.readExistingOpsRegistry(fixture.db);
 // 复现旧部署 collector 尚无 workspace marker 的完整旧代，同一固定 SHA。
 const old=await registration.registerExistingOpsSources(fixture.db,options({expectedRegistrySha256:before.registry_sha256,
  readSource:async path=>path==='packages/brain/src/lib/existing-ops-source.js'
   ?(await readSource(path)).replace(/^export const EXISTING_OPS_WORKSPACE_SELECTOR_SCHEMA = [^\n]+;\r?\n/m,''):readSource(path)}));
 const fresh=await registration.registerExistingOpsSources(fixture.db,options({expectedRegistrySha256:before.registry_sha256}));
 await factoryMap();
 return {old,fresh};
}
async function history(){return {
 registry:await registration.readExistingOpsRegistry(fixture.db),
 workflows:(await fixture.db.query('SELECT * FROM workflow_definition_versions ORDER BY id')).rows,
 activities:(await fixture.db.query('SELECT * FROM activity_definition_versions ORDER BY id')).rows,
};}
it('same-SHA 旧535/新644完整链：唯一固定Git匹配导出且不改历史/current/登记',async()=>{
 const {old,fresh}=await twoGenerations();
 const oldF3=old.definitions.activities.find(a=>a.payload.contract.key==='factory_f3_ops');
 const newF3=fresh.definitions.activities.find(a=>a.payload.contract.key==='factory_f3_ops');
 expect(newF3.payload.implementation_bindings.length-oldF3.payload.implementation_bindings.length).toBe(109);
 const before=await history(),source=transport();
 const snapshot=await exportImplementationSnapshot(fixture.db,{scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision},{nativeConsumerSourceOptions:source});
 expect(snapshot.status,JSON.stringify(snapshot.gaps)).toBe('verified');
 expect(snapshot.definitions.activities.map(a=>a.id)).toContain(newF3.id);
 expect(snapshot.definitions.activities.map(a=>a.id)).not.toContain(oldF3.id);
 expect(await history()).toEqual(before);
 expect(source.calls.length).toBeGreaterThan(100);
},120000);
