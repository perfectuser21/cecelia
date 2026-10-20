import {afterEach,beforeEach,expect,it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {versionsDatabase} from '../fixtures/definition-versions-db.js';
import {minimumMapSchema} from '../fixtures/minimum-map-schema.js';
import * as registration from '../../lib/existing-ops-registration.js';
import {exportImplementationSnapshot,validateImplementationSnapshot,refreshImplementationSnapshot} from '../../lib/implementation-ci-snapshot.js';
import {stepSha256} from '../../../scripts/sync-steps-from-workspace.mjs';
import {buildPrImplementationSnapshot,verifySnapshotSource,importImplementationSnapshot} from '../../../../../scripts/ci/implementation-snapshot.mjs';
const I={workflow_id:'f03b16c6-b3b8-4a43-8bf0-4da878660c38',capability_id:'55cb3b8d-200c-445f-9467-616498b40521',root:'2d22d890-dbab-441b-a602-2727de668aaf',skill_id:'03770894-5ac3-4eb7-ae44-5a3e15951d99'};
const scope='cecelia-infra',repo='perfectuser21/cecelia',slot='janitor_frequent_orphan_reconciliation';
const location='/Users/administrator/perfect21/cecelia-deploy-main/scripts/ops/janitor.sh';
const sourcePaths=['scripts/ops/janitor.sh','scripts/ops/janitor-effects.sh','scripts/ops/__tests__/janitor/janitor_resident_service_exempt.test.sh','scripts/ops/__tests__/janitor/janitor_kill_exempt.test.sh'];
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
 dir=mkdtempSync(join(tmpdir(),'infra-source-'));git(dir,'init','-q','-b','fixture');
 for(const path of sourcePaths){mkdirSync(dirname(join(dir,path)),{recursive:true});writeFileSync(join(dir,path),git(sourceRoot,'show',`65205751baba232fa6402065460b3c8f68b21a37:${path}`)+'\n');}
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
