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
// 仅测试数据：已独立核验固定652的四份raw Git原件；不授予生产来源或执行资格。
const FIXED_INFRA_TEST_REVISION='65205751baba232fa6402065460b3c8f68b21a37';
const EXPECTED={"scripts/ops/janitor.sh": "6b33aa5d38ca721d04389c15c1c077c2d675422d3729513a103424b5d4c12d04", "scripts/ops/janitor-effects.sh": "2250865b8a9052338fda0c6f844fdd58c08ea539f12cf6659edce129f8e2a444", "scripts/ops/__tests__/janitor/janitor_resident_service_exempt.test.sh": "03a884cfe5231e027d22be84c1d0d42937dac4b52278b84025f0b16c36d0bc5c", "scripts/ops/__tests__/janitor/janitor_kill_exempt.test.sh": "37d19a73fb01a16cbc33e71726a4ffa25e5adfbccbce8a0ad4e78e9f36471997"};
const PACKED=[
 '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',
 'XEA35kcURIyCGY3Z/f8AgVHivtziAAA=',
].join('');
const RAW=Object.freeze(JSON.parse(gunzipSync(Buffer.from(PACKED,'base64'),{maxOutputLength:1024*1024}).toString('utf8')));
function readFixedInfraTestSource(path){
 if(!Object.hasOwn(EXPECTED,path)||typeof RAW[path]!=='string'||createHash('sha256').update(RAW[path]).digest('hex')!==EXPECTED[path])throw Error('INFRA_TEST_SOURCE_INVALID');
 return RAW[path];
}

const I={workflow_id:'f03b16c6-b3b8-4a43-8bf0-4da878660c38',capability_id:'55cb3b8d-200c-445f-9467-616498b40521',root:'2d22d890-dbab-441b-a602-2727de668aaf',skill_id:'03770894-5ac3-4eb7-ae44-5a3e15951d99'};
const scope='cecelia-infra',repo='perfectuser21/cecelia',slot='janitor_frequent_orphan_reconciliation';
const location='/Users/administrator/perfect21/cecelia-deploy-main/scripts/ops/janitor.sh';
const sourcePaths=['scripts/ops/janitor.sh','scripts/ops/janitor-effects.sh','scripts/ops/__tests__/janitor/janitor_resident_service_exempt.test.sh','scripts/ops/__tests__/janitor/janitor_kill_exempt.test.sh'];
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

it('固定652测试原件不依赖checkout历史或ambient Git，逐字摘要不漂移',async()=>{
 expect(FIXED_INFRA_TEST_REVISION).toBe('65205751baba232fa6402065460b3c8f68b21a37');
 const expected={"scripts/ops/janitor.sh": "6b33aa5d38ca721d04389c15c1c077c2d675422d3729513a103424b5d4c12d04", "scripts/ops/janitor-effects.sh": "2250865b8a9052338fda0c6f844fdd58c08ea539f12cf6659edce129f8e2a444", "scripts/ops/__tests__/janitor/janitor_resident_service_exempt.test.sh": "03a884cfe5231e027d22be84c1d0d42937dac4b52278b84025f0b16c36d0bc5c", "scripts/ops/__tests__/janitor/janitor_kill_exempt.test.sh": "37d19a73fb01a16cbc33e71726a4ffa25e5adfbccbce8a0ad4e78e9f36471997"};
 for(const [path,hash] of Object.entries(expected))expect(createHash('sha256').update(readFixedInfraTestSource(path)).digest('hex')).toBe(hash);
 expect(()=>readFixedInfraTestSource('../outside')).toThrow();
 const previous=process.env.GIT_DIR;
 try{process.env.GIT_DIR='/missing-fixture-git';for(const [path,hash] of Object.entries(expected))expect(createHash('sha256').update(readFixedInfraTestSource(path)).digest('hex')).toBe(hash);}
 finally{if(previous===undefined)delete process.env.GIT_DIR;else process.env.GIT_DIR=previous;}
});
