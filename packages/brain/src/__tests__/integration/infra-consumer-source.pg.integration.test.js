import express from 'express';
import {createImplementationCiRouter} from '../../routes/implementation-ci.js';
import {afterEach,beforeEach,expect,it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {versionsDatabase} from '../fixtures/definition-versions-db.js';
import {minimumMapSchema} from '../fixtures/minimum-map-schema.js';
import {readFixedInfraTestSource} from '../fixtures/infra-consumer-fixed-source.js';
import * as registration from '../../lib/existing-ops-registration.js';
import {exportImplementationSnapshot,validateImplementationSnapshot,refreshImplementationSnapshot} from '../../lib/implementation-ci-snapshot.js';
import {stepSha256} from '../../../scripts/sync-steps-from-workspace.mjs';
import {buildPrImplementationSnapshot,verifySnapshotSource,importImplementationSnapshot} from '../../../../../scripts/ci/implementation-snapshot.mjs';
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
