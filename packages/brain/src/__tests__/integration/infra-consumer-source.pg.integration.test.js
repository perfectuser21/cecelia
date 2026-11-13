import express from 'express';
import {createImplementationCiRouter} from '../../routes/implementation-ci.js';
import {afterEach,beforeEach,expect,it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {versionsDatabase} from '../fixtures/definition-versions-db.js';
import {minimumMapSchema} from '../fixtures/minimum-map-schema.js';
import * as registration from '../../lib/existing-ops-registration.js';
import {exportImplementationSnapshot,validateImplementationSnapshot,refreshImplementationSnapshot} from '../../lib/implementation-ci-snapshot.js';
import {stepSha256} from '../../../scripts/sync-steps-from-workspace.mjs';
import {buildPrImplementationSnapshot,verifySnapshotSource,importImplementationSnapshot} from '../../../../../scripts/ci/implementation-snapshot.mjs';
// 仅测试数据：已独立核验固定d06的四份raw Git原件；不授予生产来源或执行资格。
const FIXED_INFRA_TEST_REVISION='d06de84e9f7d2d489a151e0b13b38f81651dd3fa';
const EXPECTED={"scripts/ops/janitor.sh": "6aa5a22fb450753852498b142f6504c077ec1426c30a43dcebafc227c91e6a06", "scripts/ops/janitor-effects.sh": "2250865b8a9052338fda0c6f844fdd58c08ea539f12cf6659edce129f8e2a444", "scripts/ops/__tests__/janitor/janitor_resident_service_exempt.test.sh": "03a884cfe5231e027d22be84c1d0d42937dac4b52278b84025f0b16c36d0bc5c", "scripts/ops/__tests__/janitor/janitor_system_domain_service_exempt.test.sh": "fec43c69f03835a81b1f01dd072dbe2c93ffbfbf4075c80dcb374db35e3ae223"};
const PACKED=[
 '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',
].join('');
const RAW=Object.freeze(JSON.parse(gunzipSync(Buffer.from(PACKED,'base64'),{maxOutputLength:1024*1024}).toString('utf8')));
function readFixedInfraTestSource(path){
 if(!Object.hasOwn(EXPECTED,path)||typeof RAW[path]!=='string'||createHash('sha256').update(RAW[path]).digest('hex')!==EXPECTED[path])throw Error('INFRA_TEST_SOURCE_INVALID');
 return RAW[path];
}

const I={workflow_id:'f03b16c6-b3b8-4a43-8bf0-4da878660c38',capability_id:'55cb3b8d-200c-445f-9467-616498b40521',root:'2d22d890-dbab-441b-a602-2727de668aaf',skill_id:'03770894-5ac3-4eb7-ae44-5a3e15951d99'};
const scope='cecelia-infra',repo='perfectuser21/cecelia',slot='janitor_frequent_orphan_reconciliation';
const location='/Users/administrator/perfect21/cecelia-deploy-main/scripts/ops/janitor.sh';
const sourcePaths=['scripts/ops/janitor.sh','scripts/ops/janitor-effects.sh','scripts/ops/__tests__/janitor/janitor_resident_service_exempt.test.sh','scripts/ops/__tests__/janitor/janitor_system_domain_service_exempt.test.sh'];
const runtimePaths=['infra-consumer-source.js','infra-consumer-snapshot.js','consumer-evidence-store.js'].map(n=>'packages/brain/src/lib/'+n);
const sourceRoot=fileURLToPath(new URL('../../../../../',import.meta.url));
const git=(root,...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:16000000,env:{PATH:process.env.PATH,HOME:process.env.HOME,GIT_NO_REPLACE_OBJECTS:'1'}}).trim();
let f,dir,base,head,activity,ref;
const query=revision=>({scope,repo,revision});
const source=revision=>({...query(revision),paths:sourcePaths,readSource:async path=>git(dir,'show',`${revision}:${path}`)+'\n',mode:'scratch_candidate',actor:'fixture'});
async function registry(){return registration.readInfraConsumerRegistry(f.db);}
async function register(extra={}){
 const fn=registration.registerInfraConsumerSources||registration.registerExistingOpsSources;
 return fn(f.db,{...source(base),expectedRegistrySha256:(await registry()).registry_sha256,...extra});
}
beforeEach(async()=>{
 f=await versionsDatabase();await f.migrate();await minimumMapSchema(f.db);
 await f.db.query('CREATE TABLE skill_registry(id uuid PRIMARY KEY,name text,status text,location text)');
 await f.db.query("INSERT INTO skill_registry VALUES($1,'janitor','active',$2)",[I.skill_id,location]);
 await f.db.query("INSERT INTO value_streams(id,name) VALUES($1,'基础设施')",[I.root]);
 await f.db.query("INSERT INTO capabilities(id,name,parent_journey_id) VALUES($1,'清理与容量',$2)",[I.capability_id,I.root]);
 await f.db.query("INSERT INTO workflows(id,capability_id,key,name,channel,status) VALUES($1,$2,'infra_cleanup_capacity_ops','定时作业桶','ops','paused')",[I.workflow_id,I.capability_id]);
 activity=randomUUID();ref=randomUUID();
 await f.db.query("INSERT INTO activities(id,name,status,workflow_id) VALUES($1,'孤儿进程来源片段','planned',$2)",[activity,I.workflow_id]);
 await f.db.query('INSERT INTO workflow_activity_refs(id,workflow_id,activity_id,slot_key,sequence_no,source_ref) VALUES($1,$2,$3,$4,1,$5)',[ref,I.workflow_id,activity,slot,I.skill_id]);
 dir=mkdtempSync(join(tmpdir(),'infra-source-'));git(dir,'init','-q','-b','fixture');git(dir,'remote','add','origin','https://github.com/perfectuser21/cecelia.git');
 for(const path of sourcePaths){mkdirSync(dirname(join(dir,path)),{recursive:true});writeFileSync(join(dir,path),readFixedInfraTestSource(path));}
 for(const path of runtimePaths){mkdirSync(dirname(join(dir,path)),{recursive:true});writeFileSync(join(dir,path),readFileSync(join(sourceRoot,path)));}
 mkdirSync(join(dir,'scripts/smoke'),{recursive:true});writeFileSync(join(dir,'scripts/smoke/infra-consumer-fixture.sh'),'#!/bin/bash\nset -e\nif [[ -x /opt/homebrew/bin/timeout ]]; then export PATH=/opt/homebrew/bin:$PATH; fi\nbash scripts/ops/__tests__/janitor/janitor_resident_service_exempt.test.sh\n');
 git(dir,'add','.');base=git(dir,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit-tree',git(dir,'write-tree'),'-m','base');git(dir,'update-ref','HEAD',base);
 writeFileSync(join(dir,sourcePaths[0]),git(dir,'show',`${base}:${sourcePaths[0]}`)+'\n# fixture source revision\n');
 git(dir,'add','.');head=git(dir,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit-tree',git(dir,'write-tree'),'-p',base,'-m','head');git(dir,'update-ref','HEAD',head);
});
afterEach(async()=>{await f?.close();if(dir)rmSync(dir,{recursive:true,force:true});});
async function map(revision=base){
 const decision=randomUUID(),id=randomUUID(),binding=(entity_type,entity_id)=>({entity_type,entity_id,source_repo:repo,source_revision:revision});
 const manifest={schema_version:1,scope_key:scope,source_decision_id:decision,boundaries:[],crosscut_pool:[],shared_prerequisites:{applicable:false,items:[],reason:'仅来源归属，无执行编排'},value_streams:[{key:'infra',name:'基础设施',perceiver:'主理人',order:1,brain_binding:binding('value_stream',I.root)}],capabilities:[{key:'cleanup',name:'清理与容量',order:1,value_stream_key:'infra',brain_binding:binding('capability',I.capability_id)}]};
 await f.db.query("INSERT INTO decisions(id,category,topic,decision,status) VALUES($1,'feature','fixture','来源证据','active')",[decision]);
 await f.db.query("INSERT INTO map_scope_repositories(scope_key,repo,adapter_key,adapter_config) VALUES($1,'infra-source','legacy-ledger-v1',$2)",[scope,{source_repo:repo}]);
 await f.db.query("INSERT INTO map_manifest_versions(id,scope_key,version,source_decision_id,manifest,digest,status,activated_at) VALUES($1,$2,1,$3,$4,$5,'active',now())",[id,scope,decision,manifest,stepSha256(manifest)]);
 await f.db.query("INSERT INTO map_projection_runs(scope_key,manifest_version_id,manifest_digest,fact_revisions,projector_version,projection_digest,status,activated_at) VALUES($1,$2,$3,$4,'fixture',$3,'active',now())",[scope,id,stepSha256(manifest),{'infra-source':revision}]);
}
it('真实独立infra仅追加非执行来源：不冒factory，不修改桶current或引用；固定候选可重建',async()=>{
 // Existing factory-only API rejects this real owner before the dedicated lane exists.
 await expect((registration.registerInfraConsumerSources||registration.registerExistingOpsSources)(f.db,{...source(base),expectedRegistrySha256:registration.readInfraConsumerRegistry?(await registry()).registry_sha256:'a'.repeat(64)})).resolves.toMatchObject({executable:false});
 const before=await registry();await map();
 await f.db.query("INSERT INTO activity_cells(journey_id,step_id,assertion_ref) VALUES($1,$2,$3)",[I.capability_id,activity,'scripts/smoke/infra-consumer-fixture.sh']);
 const receipt=await register();expect(receipt.executable).toBe(false);
 expect(receipt.definitions.workflows).toHaveLength(1);expect(receipt.definitions.activities).toHaveLength(1);
 const row=receipt.definitions.activities[0];expect(row.activity_id).toBe(activity);expect(row.payload.implementation_bindings.map(b=>b.path).sort()).toEqual([...sourcePaths].sort());
 expect(row.payload.contract).toMatchObject({definition_scope:'consumer_evidence',executable:false});
 expect(await registry()).toEqual(before);
 expect((await register()).definitions.activities[0].id).toBe(row.id);
 const snapshot=await exportImplementationSnapshot(f.db,query(base));expect(snapshot.status,JSON.stringify(snapshot.gaps)).toBe('verified');
 expect(snapshot.execution_status).toBe('unknown');expect(validateImplementationSnapshot(snapshot)).toEqual(snapshot);
 await expect(verifySnapshotSource(snapshot,dir,{db:f.db})).resolves.toEqual(snapshot);
 const rebuilt=await buildPrImplementationSnapshot(f.db,snapshot,head,dir);
 expect(rebuilt.status,JSON.stringify(rebuilt.gaps)).toBe('verified');expect(rebuilt.revision).toBe(head);
 expect(await registry()).toEqual(before);
 await importImplementationSnapshot(f.db,rebuilt);expect(await registry()).toEqual(before);
},60000);
it('现有factory入口不能将infra物理owner当factory注册',async()=>{
 await expect(registration.registerExistingOpsSources(f.db,{...source(base),expectedRegistrySha256:'a'.repeat(64)})).rejects.toThrow('OPS_REGISTRATION_INPUT_INVALID');
});
it('缺登记与manifest保持unknown，不能因代码存在补造base凭证',async()=>{
 const snapshot=await exportImplementationSnapshot(f.db,query(base));expect(snapshot.status).toBe('unknown');
 expect(snapshot.gaps.map(g=>g.code)).toEqual(expect.arrayContaining(['definition_snapshot_missing','scope_manifest_missing']));
 const before=(await f.db.query('SELECT count(*)::int n FROM workflow_definition_versions')).rows[0].n;
 await expect(refreshImplementationSnapshot(f.db,query(base),{resolveToken:async()=>{throw Error('不得取凭据');}})).rejects.toThrow();
 expect((await f.db.query('SELECT count(*)::int n FROM workflow_definition_versions')).rows[0].n).toBe(before);
});
it('注册期间registry CAS冲突、Skill未核或跨scope均零追加',async()=>{
 expect(registration.readInfraConsumerRegistry).toBeTypeOf('function');
 const before=await registry();
 for(const change of [{scope:'cecelia-factory'},{repo:'foreign/repo'},{revision:'main'},{expectedRegistrySha256:'b'.repeat(64)}])await expect(register(change)).rejects.toThrow();
 await f.db.query("UPDATE skill_registry SET location='unverified'");await expect(register({expectedRegistrySha256:before.registry_sha256})).rejects.toThrow();
 expect((await f.db.query('SELECT count(*)::int n FROM workflow_definition_versions')).rows[0].n).toBe(0);
});

it('同SHA并发只留一份历史；registry变化导致CAS拒绝且零新行',async()=>{
 const before=await registry(),pool=f.createPool(3),options={...source(base),expectedRegistrySha256:before.registry_sha256};
 const results=await Promise.all([registration.registerInfraConsumerSources(pool,options),registration.registerInfraConsumerSources(pool,options)]);
 expect(results[0].definitions.activities[0].id).toBe(results[1].definitions.activities[0].id);
 expect((await f.db.query('SELECT count(*)::int n FROM workflow_definition_versions')).rows[0].n).toBe(1);
 await f.db.query("UPDATE activities SET name='人改名' WHERE id=$1",[activity]);
 await expect(registration.registerInfraConsumerSources(pool,{...options,...source(head)})).rejects.toThrow('OPS_REGISTRY_CONFLICT');
 expect((await f.db.query('SELECT count(*)::int n FROM workflow_definition_versions')).rows[0].n).toBe(1);
});
it('重算外层SHA不能洗白跨scope、执行权、源摘要或地图归属；固定Git内容不符拒绝',async()=>{
 await map();await register();const snapshot=await exportImplementationSnapshot(f.db,query(base));
 for(const edit of [s=>s.execution_status='completed',s=>s.definitions.activities[0].payload.contract.executable=true,s=>s.definitions.activities[0].source_commit=head,s=>s.canonical.journeys[0].parent_journey_id=randomUUID(),s=>s.map.manifest.manifest.capabilities[0].brain_binding.entity_id=randomUUID()]){
  const changed=structuredClone(snapshot);edit(changed);delete changed.snapshot_sha256;changed.snapshot_sha256=stepSha256(changed);
  expect(()=>validateImplementationSnapshot(changed)).toThrow();
 }
 const changed=structuredClone(snapshot),a=changed.definitions.activities[0];a.payload.implementation_bindings[0].content_sha256='f'.repeat(64);a.payload.implementation_bindings[0].digest='sha256:'+a.payload.implementation_bindings[0].content_sha256;
 a.payload_sha256=stepSha256({source:{repo,path:a.source_path,commit:base},payload:a.payload});delete changed.snapshot_sha256;changed.snapshot_sha256=stepSha256(changed);
 await expect(verifySnapshotSource(changed,dir,{db:f.db})).rejects.toThrow('CONSUMER_SOURCE_MISMATCH');
});
it('现有HTTP协议真实返回未知/鉴权拒绝；正式main取源校验后仅追加来源',async()=>{
 const saved=process.env.CECELIA_INTERNAL_TOKEN;process.env.CECELIA_INTERNAL_TOKEN='isolated-http-fixture';
 let remoteRevision=base;const read=async path=>git(dir,'show',`${remoteRevision}:${path}`)+'\n';
 const fetchFn=async url=>{
  if(url.endsWith('/commits/main'))return {ok:true,text:async()=>remoteRevision};
  if(url.includes('/git/commits/'))return {ok:true,json:async()=>({sha:remoteRevision,tree:{sha:git(dir,'rev-parse',`${remoteRevision}^{tree}`)}})};
  if(url.includes('/git/trees/'))return {ok:true,json:async()=>({sha:git(dir,'rev-parse',`${remoteRevision}^{tree}`),truncated:false,tree:[...sourcePaths,...runtimePaths].map(path=>({path,type:'blob',mode:'100644',sha:git(dir,'rev-parse',`${remoteRevision}:${path}`)}))})};
  const path=decodeURIComponent(url.split('/contents/')[1]?.split('?')[0]||'');return {ok:[...sourcePaths,...runtimePaths].includes(path),text:()=>read(path)};
 };
 const app=express();app.use(express.json());app.use('/api/brain/implementation-ci',createImplementationCiRouter({pool:f.db,refreshOptions:{resolveToken:async()=> 'fixture',fetchFn}}));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const origin=`http://127.0.0.1:${server.address().port}/api/brain/implementation-ci`;
 try{
  const unauthorized=await fetch(origin+'/snapshot?'+new URLSearchParams(query(base)));expect(unauthorized.status).toBe(401);
  const headers={'X-Internal-Token':'isolated-http-fixture','Content-Type':'application/json'};
  const unknown=await fetch(origin+'/snapshot?'+new URLSearchParams(query(base)),{headers});expect((await unknown.json()).snapshot.status).toBe('unknown');
  const rejected=await fetch(origin+'/refresh',{method:'POST',headers,body:JSON.stringify(query(base))});expect(rejected.ok).toBe(false);
  expect((await f.db.query('SELECT count(*)::int n FROM workflow_definition_versions')).rows[0].n).toBe(0);
  await map();const before=await registry();
  const refreshed=await fetch(origin+'/refresh',{method:'POST',headers,body:JSON.stringify(query(base))});const body=await refreshed.json();expect(refreshed.status,JSON.stringify(body)).toBe(200);expect(body.snapshot).toMatchObject({status:'verified',execution_status:'unknown'});
  expect(await registry()).toEqual(before);
  remoteRevision=head;const next=await fetch(origin+'/refresh',{method:'POST',headers,body:JSON.stringify(query(head))});const nextBody=await next.json();expect(next.status,JSON.stringify(nextBody)).toBe(200);expect(nextBody.snapshot).toMatchObject({revision:head,status:'verified',execution_status:'unknown'});expect(await registry()).toEqual(before);
 }finally{await new Promise(resolve=>server.close(resolve));if(saved===undefined)delete process.env.CECELIA_INTERNAL_TOKEN;else process.env.CECELIA_INTERNAL_TOKEN=saved;}
});
it('真实CLI以精确base/head快照在隔离scratch重建infra图，错base先拒不产生PASS',async()=>{
 const {default:pg}=await import('pg');const {DB_DEFAULTS}=await import('../../db-config.js');
 const {minimumDefinitionSchema}=await import('../fixtures/minimum-definition-schema.js');
 const publicDb=new pg.Client(DB_DEFAULTS);await publicDb.connect();
 try{
  const identity=(await publicDb.query("SELECT current_database() name,current_setting('data_directory') data_directory,to_regclass('public.schema_version') version_table")).rows[0];
  expect(['cecelia_scratch',...(process.env.CI==='true'&&process.env.GITHUB_ACTIONS==='true'?['cecelia_test']:[])]).toContain(identity.name);
  if(!identity.version_table){await minimumDefinitionSchema(publicDb);await minimumMapSchema(publicDb);await publicDb.query('CREATE TABLE skill_registry(id uuid PRIMARY KEY,name text,status text,location text)');await publicDb.query('ALTER TABLE activities DROP COLUMN journey_id CASCADE,DROP COLUMN step_number CASCADE,DROP COLUMN enabler_id CASCADE');}
 }finally{await publicDb.end();}
 await map();await register();
 await f.db.query('INSERT INTO activity_cells(journey_id,step_id,assertion_ref) VALUES($1,$2,$3)',[I.capability_id,activity,'scripts/smoke/infra-consumer-fixture.sh']);
 const b=await exportImplementationSnapshot(f.db,query(base));expect(b.assertions).toHaveLength(1);const snapshot=join(dir,'base.json'),out=join(dir,'report');writeFileSync(snapshot,JSON.stringify(b));
 const args=[join(sourceRoot,'scripts/ci/implementation-pr-gate.mjs'),'--repo-root',dir,'--scope',scope,'--base',base,'--head',head,'--mode','pr','--snapshot-base',snapshot,'--snapshot-head',snapshot,'--output-dir',out];
 const {spawn}=await import('node:child_process');
 const run=argv=>new Promise(resolve=>{const child=spawn(process.execPath,argv,{env:process.env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);child.on('close',code=>resolve({code,stdout,stderr}));});
 const result=await run(args);const {readFileSync,existsSync}=await import('node:fs');
 if(result.code!==0&&existsSync(join(out,'report.json')))result.report=JSON.parse(readFileSync(join(out,'report.json')));
 if(result.code!==0&&existsSync(join(out,'candidate.json')))result.candidateAssertions=JSON.parse(readFileSync(join(out,'candidate.json'))).assertions;
 expect(result.code,JSON.stringify(result)).toBe(0);
 const candidate=JSON.parse(readFileSync(join(out,'candidate.json')));
 expect(candidate).toMatchObject({scope,repo,revision:head,execution_status:'unknown',snapshot_scope:'consumer_evidence'});
 const bad=structuredClone(b);bad.revision=head;delete bad.snapshot_sha256;bad.snapshot_sha256=stepSha256(bad);writeFileSync(snapshot,JSON.stringify(bad));
 const rejected=await run(args);expect(rejected.code).not.toBe(0);expect(JSON.parse(readFileSync(join(out,'gap.json'))).status).toBe('unknown');
},120000);

it('固定d06测试原件不依赖checkout历史或ambient Git，逐字摘要不漂移',async()=>{
 expect(FIXED_INFRA_TEST_REVISION).toBe('d06de84e9f7d2d489a151e0b13b38f81651dd3fa');
 const expected={"scripts/ops/janitor.sh": "6aa5a22fb450753852498b142f6504c077ec1426c30a43dcebafc227c91e6a06", "scripts/ops/janitor-effects.sh": "2250865b8a9052338fda0c6f844fdd58c08ea539f12cf6659edce129f8e2a444", "scripts/ops/__tests__/janitor/janitor_resident_service_exempt.test.sh": "03a884cfe5231e027d22be84c1d0d42937dac4b52278b84025f0b16c36d0bc5c", "scripts/ops/__tests__/janitor/janitor_system_domain_service_exempt.test.sh": "fec43c69f03835a81b1f01dd072dbe2c93ffbfbf4075c80dcb374db35e3ae223"};
 for(const [path,hash] of Object.entries(expected))expect(createHash('sha256').update(readFixedInfraTestSource(path)).digest('hex')).toBe(hash);
 expect(()=>readFixedInfraTestSource('../outside')).toThrow();
 const previous=process.env.GIT_DIR;
 try{process.env.GIT_DIR='/missing-fixture-git';for(const [path,hash] of Object.entries(expected))expect(createHash('sha256').update(readFixedInfraTestSource(path)).digest('hex')).toBe(hash);}
 finally{if(previous===undefined)delete process.env.GIT_DIR;else process.env.GIT_DIR=previous;}
});
