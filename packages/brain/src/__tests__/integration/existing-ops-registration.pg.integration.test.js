import * as frozenSource from '../../../../../scripts/ci/implementation-snapshot.mjs';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { versionsDatabase } from '../fixtures/definition-versions-db.js';
import { EXISTING_OPS_IDENTITIES } from '../../lib/existing-ops-source.js';
import * as registration from '../../lib/existing-ops-registration.js';
import { minimumMapSchema } from '../fixtures/minimum-map-schema.js';
import { exportImplementationSnapshot,refreshImplementationSnapshot } from '../../lib/implementation-ci-snapshot.js';
import { importImplementationSnapshot,buildPrImplementationSnapshot } from '../../../../../scripts/ci/implementation-snapshot.mjs';
import { randomUUID } from 'node:crypto';

it('factory source anchor plan preserves fields and rejects foreign or incomplete owner trees', async()=>{
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
it('真实main消费者只append不可执行历史，保留全部旧登记和六个UNKNOWN', async () => {
  expect(registration.registerExistingOpsSources).toBeTypeOf('function');
  const before = await registration.readExistingOpsRegistry(fixture.db);
  const receipt = await registration.registerExistingOpsSources(fixture.db, options({ expectedRegistrySha256: before.registry_sha256 }));
  expect(receipt.definitions.workflows).toHaveLength(2);
  expect(receipt.definitions.activities).toHaveLength(2);
  expect(receipt.definitions.workflows.every(w => w.payload.definition_scope === 'consumer_evidence' && w.payload.coverage.status === 'unknown' && w.payload.coverage.unverified_reference_ids.length === 3)).toBe(true);
  expect(await registration.readExistingOpsRegistry(fixture.db)).toEqual(before);
  expect((await fixture.db.query('SELECT count(*)::int n FROM workflow_activity_refs')).rows[0].n).toBe(8);
  expect((await registration.registerExistingOpsSources(fixture.db, options({ expectedRegistrySha256: before.registry_sha256 }))).definitions).toEqual(receipt.definitions);
  await expect(fixture.db.query('DELETE FROM workflow_definition_versions WHERE id=$1', [receipt.definitions.workflows[0].id])).rejects.toMatchObject({ code: 'P0001' });
});
it('人改slot或层级不被接力覆盖，失败事务没有历史残留', async () => {
  const before = await registration.readExistingOpsRegistry(fixture.db);
  await fixture.db.query("UPDATE workflow_activity_refs SET slot_key='human_slot' WHERE id=$1", [EXISTING_OPS_IDENTITIES[0].reference_id]);
  await expect(registration.registerExistingOpsSources(fixture.db, options({ expectedRegistrySha256: before.registry_sha256 }))).rejects.toMatchObject({ code: 'OPS_REGISTRY_CONFLICT' });
  expect((await fixture.db.query('SELECT count(*)::int n FROM workflow_definition_versions')).rows[0].n).toBe(0);
});
it('main已移动、缺源或缺CAS不能登记，绝不执行candidate源码', async () => {
  const before = await registration.readExistingOpsRegistry(fixture.db);
  for (const extra of [{ checkMain: async () => { throw Error('MAIN_MOVED'); } }, { expectedRegistrySha256: undefined }, { readSource: async path => { if (path === 'packages/brain/src/migrate.js') throw Error('missing'); return readSource(path); } }]) {
    await expect(registration.registerExistingOpsSources(fixture.db, options({ expectedRegistrySha256: before.registry_sha256, ...extra }))).rejects.toThrow();
  }
  expect((await fixture.db.query('SELECT count(*)::int n FROM workflow_definition_versions')).rows[0].n).toBe(0);
});
it('工厂source导出保留全旧身份而仅含消费者历史，scratch导入不伪current', async()=>{
  const before=await registration.readExistingOpsRegistry(fixture.db);
  await registration.registerExistingOpsSources(fixture.db,options({expectedRegistrySha256:before.registry_sha256})); await factoryMap();
  const snapshot=await exportImplementationSnapshot(fixture.db,{scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision});
  expect(snapshot.status,JSON.stringify(snapshot.gaps)).toBe('verified');
  expect(snapshot.canonical.workflows).toHaveLength(2);
  expect(snapshot.canonical.references).toHaveLength(8);
  expect(snapshot.canonical.activities).toHaveLength(8);
  expect(snapshot.definitions.workflows).toHaveLength(2);
  expect(snapshot.execution_status).toBe('unknown');
  await importImplementationSnapshot(fixture.db,snapshot);
  expect(await registration.readExistingOpsRegistry(fixture.db)).toEqual(before);
});
it('正式refresh只读固定main commit/tree字节，来源未知和截断树不能写历史',async()=>{
  await factoryMap(); const before=await registration.readExistingOpsRegistry(fixture.db);
  const treeSha=execFileSync('git',['rev-parse',`${revision}^{tree}`],{cwd:root,encoding:'utf8'}).trim();
  let truncated=true,reads=0;
  const fetchFn=async(url,options)=>{
    reads++;expect(options.redirect).toBe('error');
    if(url.endsWith('/commits/main'))return {ok:true,text:async()=>revision};
    if(url.endsWith(`/git/commits/${revision}`))return {ok:true,json:async()=>({sha:revision,tree:{sha:treeSha}})};
    if(url.endsWith(`/git/trees/${treeSha}?recursive=1`))return {ok:true,json:async()=>({sha:treeSha,truncated,tree:paths.map(path=>({path,type:'blob'}))})};
    const prefix='https://api.github.com/repos/perfectuser21/cecelia/contents/';
    expect(url.startsWith(prefix)).toBe(true);expect(new URL(url).searchParams.get('ref')).toBe(revision);
    const path=decodeURIComponent(new URL(url).pathname.slice('/repos/perfectuser21/cecelia/contents/'.length));
    return {ok:true,text:()=>readSource(path)};
  };
  const q={scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision},options={fetchFn,resolveToken:async()=>''};
  await expect(refreshImplementationSnapshot(fixture.db,q,options)).rejects.toMatchObject({code:'IMPLEMENTATION_CI_SOURCE_TREE_INCOMPLETE'});
  expect((await fixture.db.query('SELECT count(*)::int n FROM workflow_definition_versions')).rows[0].n).toBe(0);
  truncated=false;
  const snapshot=await refreshImplementationSnapshot(fixture.db,q,options);
  expect(snapshot.status,JSON.stringify(snapshot.gaps)).toBe('verified');expect(reads).toBeGreaterThan(10);
  expect(snapshot.consumer_registry.registry_sha256).toBe(before.registry_sha256);
  expect(snapshot.execution_status).toBe('unknown');expect(await registration.readExistingOpsRegistry(fixture.db)).toEqual(before);
});
it('候选只在真实scratch冻结head消费者与地图，不激活任何旧current',async()=>{
  const before=await registration.readExistingOpsRegistry(fixture.db);
  await registration.registerExistingOpsSources(fixture.db,options({expectedRegistrySha256:before.registry_sha256}));await factoryMap();
  const baseline=await exportImplementationSnapshot(fixture.db,{scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision});
  const head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  const candidate=await buildPrImplementationSnapshot(fixture.db,baseline,head,root);
  expect(candidate.status,JSON.stringify(candidate.gaps)).toBe('verified');expect(candidate.revision).toBe(head);
  expect(candidate.definitions.workflows.every(w=>w.source_commit===head&&w.payload.definition_scope==='consumer_evidence')).toBe(true);
  expect(candidate.execution_status).toBe('unknown');expect(await registration.readExistingOpsRegistry(fixture.db)).toEqual(before);
});

it('完整Factory候选在不含decisions的真实scratch重放冻结地图，保留决定锚点和全部旧current',async()=>{
  const before=await registration.readExistingOpsRegistry(fixture.db);
  await registration.registerExistingOpsSources(fixture.db,options({expectedRegistrySha256:before.registry_sha256}));await factoryMap();
  const baseline=await exportImplementationSnapshot(fixture.db,{scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision});
  const head=execFileSync('git',['rev-parse','HEAD^'],{cwd:root,encoding:'utf8'}).trim();
  expect(head).not.toBe(revision);
  // The official isolated importer intentionally omits central decision rows.
  await fixture.db.query('ALTER TABLE decisions RENAME TO omitted_central_decisions');
  const candidate=await buildPrImplementationSnapshot(fixture.db,baseline,head,root);
  expect(candidate.status,JSON.stringify(candidate.gaps)).toBe('verified');
  expect(candidate.revision).toBe(head);
  expect(candidate.map.manifest.source_decision_id).toBe(baseline.map.manifest.source_decision_id);
  expect(candidate.map.manifest.manifest.capabilities.every(n=>n.brain_binding.source_revision===head)).toBe(true);
  expect(candidate.execution_status).toBe('unknown');
  expect(await registration.readExistingOpsRegistry(fixture.db)).toEqual(before);
  expect((await fixture.db.query("SELECT to_regclass('decisions') id")).rows[0].id).toBeNull();
});

it('scratch地图推进真实CAS冲突回滚，非scratch与外来scope在写入前拒绝',async()=>{
  await factoryMap();
  const query={scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision:'d'.repeat(40)};
  const before=(await fixture.db.query('SELECT id,digest,status FROM map_manifest_versions')).rows;
  const db={query:fixture.db.query.bind(fixture.db),connect:async()=>{
    // Actual concurrent registration changes the active frozen pointer.
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

it('工厂冻结来源必须重核实际Git字节，重算外层digest也不能伪绑定或输入关系',async()=>{
  const before=await registration.readExistingOpsRegistry(fixture.db);
  await registration.registerExistingOpsSources(fixture.db,options({expectedRegistrySha256:before.registry_sha256})); await factoryMap();
  const snapshot=await exportImplementationSnapshot(fixture.db,{scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision});
  expect(frozenSource.verifySnapshotSource).toBeTypeOf('function');
  await expect(frozenSource.verifySnapshotSource(snapshot,root)).resolves.toEqual(snapshot);
  for(const mutate of [s=>s.definitions.activities[0].payload.implementation_bindings[0].content_sha256='0'.repeat(64),s=>s.definitions.activities[0].payload.input_relations.pop()]){
    const changed=structuredClone(snapshot); mutate(changed);
    // 重新封装真实合法摘要仍不可冒充Git来源。
    const {stepSha256}=await import('../../../scripts/sync-steps-from-workspace.mjs');
    const row=changed.definitions.activities[0]; row.payload_sha256=stepSha256({source:{repo:row.source_repo,path:row.source_path,commit:row.source_commit},payload:row.payload});
    const {snapshot_sha256,...body}=changed; changed.snapshot_sha256=stepSha256(body);
    await expect(frozenSource.verifySnapshotSource(changed,root)).rejects.toMatchObject({code:'IMPLEMENTATION_CI_CONSUMER_SOURCE_MISMATCH'});
  }
});
