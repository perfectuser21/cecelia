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
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import * as consumerSource from '../../lib/consumer-source-set.js';

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
const revision = '8916df494e3f6d02c3c9e9f8979e86e4d86fbd80';
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

function workspaceCandidate() {
  const repo='perfectuser21/zenithjoy-workspace',dir=mkdtempSync(join(tmpdir(),'factory-workspace-source-'));
  const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8'}).trim();
  git('init','-q','-b','candidate-fixture');
  for(const [name,job,readerName] of [['implementation-impact','impact','implementation-impact'],['pilot-release-verification','verify','pilot-release']]){
    const reader=`scripts/ci/__tests__/${readerName}-workflow.test.mjs`;
    const files={
      [reader]:`import {test} from 'node:test';\nimport {readFileSync,existsSync} from 'node:fs';\nimport YAML from 'yaml';\nconst file=new URL('../../../.github/workflows/${name}.yml',import.meta.url);\nfunction config(){if(!existsSync(file))throw Error('missing');return YAML.parse(readFileSync(file,'utf8'));}\ntest('actual-reader',()=>{config();});\n`,
      [`.github/workflows/${name}.yml`]:`name: ${name}\non:\n  ${name==='implementation-impact'?'pull_request:\n    branches: [main]\n  ':''}push:\n    branches: [main]\n  workflow_dispatch:\npermissions: {contents: read, actions: read}\njobs:\n  caller-contract:\n    steps:\n      - run: node --test ${reader}\n  ${job}:\n    needs: caller-contract\n    uses: perfectuser21/cecelia/.github/workflows/${name}.yml@${revision}\n    with:\n      source_repo: ${repo}\n      scope: zenithjoy\n      head_revision: \${{ github.sha }}\n      tooling_revision: ${revision}\n${name==='implementation-impact'?'      base_revision: \${{ github.event.before }}\n      mode: main\n':''}`,
    };
    for(const [path,bytes] of Object.entries(files)){mkdirSync(dirname(join(dir,path)),{recursive:true});writeFileSync(join(dir,path),bytes);}
  }
  git('add','.');const head=git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit-tree',git('write-tree'),'-m','实际候选来源');
  return {dir,head,input:{workspace:{repo,revision:head},brain:{repo:'perfectuser21/cecelia',revisions:[revision]},identity:{...EXISTING_OPS_IDENTITIES[1],unverified_reference_ids:undefined},anchor:{repo:'perfectuser21/cecelia',revision}},
    readSource:async q=>q.repo===repo?execFileSync('git',['show',`${q.revision}:${q.path}`],{cwd:dir}):Buffer.from(await readSource(q.path)),close:()=>rmSync(dir,{recursive:true,force:true})};
}

it('实际scratch双Git消费者只封存F3来源集合；不改旧current/八引用或伪造完整可执行Workflow',async()=>{
  expect(consumerSource.collectScratchWorkspaceConsumerSourceSet).toBeTypeOf('function');
  const candidate=workspaceCandidate();
  try{
    delete candidate.input.identity.unverified_reference_ids;
    const proof=await consumerSource.collectScratchWorkspaceConsumerSourceSet(fixture.db,candidate.input,{readSource:candidate.readSource});
    expect(proof.status,JSON.stringify(proof.gaps)).toBe('verified');
    const before=await registration.readExistingOpsRegistry(fixture.db);
    const receipt=await registration.registerExistingOpsSources(fixture.db,options({mode:'scratch_candidate',workspaceConsumerProof:proof,expectedRegistrySha256:before.registry_sha256}));
    const f3=receipt.definitions.activities.find(a=>a.activity_id===EXISTING_OPS_IDENTITIES[1].activity_id);
    expect(f3.source_repo).toBe('perfectuser21/cecelia');expect(f3.source_commit).toBe(revision);
    expect(f3.payload.source_set).toContainEqual({repo:'perfectuser21/zenithjoy-workspace',revision:candidate.head});
    expect(f3.payload.source_set_admission).toMatchObject({source_basis:'scratch_candidate',purpose:'admission_only'});
    expect(f3.payload.implementation_bindings.some(b=>b.repo==='perfectuser21/zenithjoy-workspace'&&b.revision===candidate.head)).toBe(true);
    expect(receipt.definitions.activities.find(a=>a.activity_id===EXISTING_OPS_IDENTITIES[0].activity_id).payload).not.toHaveProperty('source_set');
    expect(await registration.readExistingOpsRegistry(fixture.db)).toEqual(before);
    expect(receipt.executable).toBe(false);expect(receipt.remaining_unknown_reference_ids).toHaveLength(6);
    await factoryMap();
    const query={scope:'cecelia-factory',repo:'perfectuser21/zenithjoy-workspace',revision:candidate.head};
    const snapshot=await exportImplementationSnapshot(fixture.db,query);
    expect(snapshot.status,JSON.stringify(snapshot.gaps)).toBe('verified');
    await importImplementationSnapshot(fixture.db,snapshot);
    await expect(frozenSource.verifySnapshotSource(snapshot,candidate.dir,{db:fixture.db})).resolves.toEqual(snapshot);
    const rebuilt=await buildPrImplementationSnapshot(fixture.db,snapshot,candidate.head,candidate.dir);
    expect(rebuilt.status,JSON.stringify(rebuilt.gaps)).toBe('verified');
    expect(rebuilt.registry_source).toEqual({repo:'perfectuser21/cecelia',revision});
    expect(await registration.readExistingOpsRegistry(fixture.db)).toEqual(before);
  }finally{candidate.close();}
});

it('生产登记拒scratch或复制proof；拒绝后没有任何历史追加',async()=>{
  expect(consumerSource.collectScratchWorkspaceConsumerSourceSet).toBeTypeOf('function');
  const candidate=workspaceCandidate();
  try{
    delete candidate.input.identity.unverified_reference_ids;
    const proof=await consumerSource.collectScratchWorkspaceConsumerSourceSet(fixture.db,candidate.input,{readSource:candidate.readSource});
    expect(proof.status,JSON.stringify(proof.gaps)).toBe('verified');
    const before=await registration.readExistingOpsRegistry(fixture.db);
    await expect(registration.registerExistingOpsSources(fixture.db,options({workspaceConsumerProof:proof,expectedRegistrySha256:before.registry_sha256}))).rejects.toMatchObject({code:'CONSUMER_MAIN_SOURCE_UNKNOWN'});
    await expect(registration.registerExistingOpsSources(fixture.db,options({mode:'scratch_candidate',workspaceConsumerProof:structuredClone(proof),expectedRegistrySha256:before.registry_sha256}))).rejects.toMatchObject({code:'CONSUMER_SCRATCH_SOURCE_UNKNOWN'});
    expect((await fixture.db.query('SELECT count(*)::int n FROM workflow_definition_versions')).rows[0].n).toBe(0);
    expect(await registration.readExistingOpsRegistry(fixture.db)).toEqual(before);
  }finally{candidate.close();}
});
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
