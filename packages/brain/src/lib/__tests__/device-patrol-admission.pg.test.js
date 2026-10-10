/** 真Postgres隔离schema + 真Git树/commit/blob；只有GitHub transport替换为本机Git。 */
import {beforeAll,afterAll,it,expect} from 'vitest';
import pg from 'pg';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {DB_DEFAULTS} from '../../db-config.js';
import {bootstrapPatrolScope,exportPatrolAdmissionSnapshot} from '../device-patrol-registration.js';
import {runDevicePatrolGate} from '../../../../../scripts/ci/implementation-device-patrol-gate.mjs';
import {PATROL_PATH,PATROL_SCOPE,PATROL_REPO,PATROL_CAPABILITY,validatePatrolSnapshot} from '../device-patrol-admission.js';
let client,db,dir,schema,base,introduced,contract,reader;
const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8'}).trim();
beforeAll(async()=>{
 if(!['cecelia_scratch','cecelia_test'].includes(DB_DEFAULTS.database))throw Error('scratch required');
 client=new pg.Client(DB_DEFAULTS);await client.connect();schema='patrol_'+randomUUID().replaceAll('-','');await client.query(`CREATE SCHEMA ${schema}`);await client.query(`SET search_path TO ${schema},public`);
 for(const table of ['workflows','activities','workflow_activity_refs','steps','activity_definition_versions','workflow_definition_versions','tasks','schema_version'])await client.query(`CREATE TABLE ${schema}.${table}(LIKE public.${table} INCLUDING ALL)`);
 await client.query(readFileSync(new URL('../../../migrations/543_device_patrol_admission.sql',import.meta.url),'utf8'));
 db={query:client.query.bind(client),connect:async()=>({query:client.query.bind(client),release(){}})};
 contract={schema_version:1,scope:PATROL_SCOPE,capability_id:PATROL_CAPABILITY,workflows:[{id:'66fe22f5-1a60-4e23-bcfb-7b4df2f0fbff',key:'single-phone-account-patrol',activities:[{id:'d51eefa1-0ffd-43d7-94ba-16ff6b4d3800',key:'device-readiness',bindings:['scripts/phone-account-patrol/preflight.py'],assertion_ref:'node --test scripts/phone-account-patrol/implementation-regression.test.mjs'}]},{id:'7dfd3b5d-bc5a-4d96-b744-10d26bc7eb70',key:'phone-account-patrol-batch',activities:[{id:'b33c9f29-5c5f-4fb1-908c-475bb9566085',key:'enabled-phone-list',bindings:['scripts/phone-account-patrol/runner.py'],assertion_ref:'node --test scripts/phone-account-patrol/implementation-regression.test.mjs'}]}],auxiliary_paths:[PATROL_PATH,'scripts/phone-account-patrol/implementation-regression.test.mjs'],maintenance_owner:'主理人',schedule:{time:'22:00',timezone:'Asia/Shanghai'}};
 for(const w of contract.workflows){
  await client.query('INSERT INTO workflows(id,key,name,capability_id,status,channel) VALUES($1,$2,$2,$3,\'active\',\'Android/ADB\')',[w.id,w.key,PATROL_CAPABILITY]);
  for(const [i,a] of w.activities.entries()){
   await client.query('INSERT INTO activities(id,name,activity_key,capability_key,contract,status) VALUES($1,$2,$3,$4,$5,\'planned\')',[a.id,a.key,`${w.key}.${a.key}`,w.key,{key:a.key,name:a.key,order:i+1}]);
   await client.query('INSERT INTO workflow_activity_refs(workflow_id,activity_id,slot_key,sequence_no,active) VALUES($1,$2,$3,$4,true)',[w.id,a.id,a.key,i+1]);
  }
  await client.query('INSERT INTO tasks(id,title,status,payload,result) VALUES($1,$2,\'completed\',$3,$4)',[randomUUID(),w.key,{workflow_authoring:true},{workflow_authoring:{stage:'completed',outputs:{register:{workflow_id:w.id,readback_verified:true}}}}]);
 }
 dir=mkdtempSync(join(tmpdir(),'patrol-real-git-'));git('init','-q');git('remote','add','origin',`https://github.com/${PATROL_REPO}.git`);git('config','user.email','fixture@example.test');git('config','user.name','fixture');git('commit','-q','--allow-empty','-m','actual absent base');base=git('rev-parse','HEAD');
 mkdirSync(join(dir,'scripts/phone-account-patrol'),{recursive:true});writeFileSync(join(dir,PATROL_PATH),JSON.stringify(contract));for(const p of ['preflight.py','runner.py'])writeFileSync(join(dir,'scripts/phone-account-patrol',p),'print("fixture")\n');writeFileSync(join(dir,'scripts/phone-account-patrol/implementation-regression.test.mjs'),'import {test} from "node:test"; test("actual fixture assertion",()=>{});\n');git('add','.');git('commit','-q','-m','actual introduced source');introduced=git('rev-parse','HEAD');
 reader={tree:async revision=>({sha:git('rev-parse',`${revision}^{tree}`),entries:git('ls-tree','-r',revision).split('\n').filter(Boolean).map(line=>{const [left,path]=line.split('\t');const [mode,type,sha]=left.split(' ');return {path,mode,type,sha};})}),blob:async entry=>Buffer.from(execFileSync('git',['cat-file','blob',entry.sha],{cwd:dir})),compare:async(a,b)=>({status:git('merge-base',a,b)===a?'ahead':'diverged',merge_base_commit:{sha:git('merge-base',a,b)}})};
});
afterAll(async()=>{if(client){await client.query('ROLLBACK');await client.query('SET search_path TO public');if(schema)await client.query(`DROP SCHEMA ${schema} CASCADE`);await client.end();}if(dir)rmSync(dir,{recursive:true,force:true});});
it('真实Git空base证明后生成两组不可变定义版本；重复登记没有第三版',async()=>{
 const canonicalSource='https://github.com/perfectuser21/workspace/blob/'+'c'.repeat(40)+'/scripts/phone-account-patrol/runner.py';
 await client.query('UPDATE activities SET contract_source=$1',[canonicalSource]);
 const canonicalBefore=(await client.query('SELECT id,contract,contract_source,current_definition_version_id FROM activities ORDER BY id')).rows;
 const input={base_revision:base,introduced_revision:introduced,actor:'主理人授权/Codex'};
 const first=await bootstrapPatrolScope(db,input,{reader});expect(first.created).toBe(true);expect(first.registration.source.bindings).toHaveLength(2);expect(first.registration.definition_versions).toHaveLength(2);
 const second=await bootstrapPatrolScope(db,input,{reader});expect(second.created).toBe(false);
 expect((await client.query('SELECT count(*) AS n FROM workflow_definition_versions')).rows[0].n).toBe('2');
 const exported=await exportPatrolAdmissionSnapshot(db,{scope:PATROL_SCOPE,repo:PATROL_REPO,revision:base});expect(validatePatrolSnapshot(exported)).toBe(exported);
 const rows=(await client.query('SELECT payload FROM workflow_definition_versions')).rows;expect(rows.every(r=>r.payload.definition_scope==='device_workflow_admission'&&r.payload.contract.executable===false)).toBe(true);
 expect((await client.query('SELECT id,contract,contract_source,current_definition_version_id FROM activities ORDER BY id')).rows).toEqual(canonicalBefore);
 expect((await client.query('SELECT current_definition_version_id FROM workflows')).rows.every(r=>r.current_definition_version_id===null)).toBe(true);
 expect((await client.query('SELECT activity_definition_version_id FROM workflow_activity_refs')).rows.every(r=>r.activity_definition_version_id===null)).toBe(true);
 for(const row of (await client.query('SELECT activity_id,payload,source_commit FROM activity_definition_versions')).rows){
  expect(row.source_commit).toBe(introduced);
  expect(row.payload.contract).toEqual(contract.workflows.flatMap(w=>w.activities).find(a=>a.id===row.activity_id));
  expect(row.payload.canonical_reference.contract_source).toBe(canonicalSource);
  expect(row.payload.canonical_reference.contract_sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(row.payload.steps).toEqual([]);
 }
});
it('伪造Git不存在/已存在base与未验收身份全部拒绝且不修改事实',async()=>{
 const before=(await client.query('SELECT registration_sha256 FROM implementation_scope_bootstraps')).rows;
 await expect(bootstrapPatrolScope(db,{base_revision:introduced,introduced_revision:base,actor:'operator'},{reader})).rejects.toThrow();
 expect((await client.query('SELECT registration_sha256 FROM implementation_scope_bootstraps')).rows).toEqual(before);
});

it('窄CI入口在真实Git+PG登记上运行回归；未登记路径保持fail-closed',async()=>{
 const outputDir=mkdtempSync(join(tmpdir(),'patrol-gate-evidence-'));
 try{
  const baseline=await exportPatrolAdmissionSnapshot(db,{scope:PATROL_SCOPE,repo:PATROL_REPO,revision:base});
  const candidate=await exportPatrolAdmissionSnapshot(db,{scope:PATROL_SCOPE,repo:PATROL_REPO,revision:introduced});
  const snapshotBase=join(outputDir,'base.json'),snapshotHead=join(outputDir,'head.json');writeFileSync(snapshotBase,JSON.stringify(baseline));writeFileSync(snapshotHead,JSON.stringify(candidate));
  const options={repoRoot:dir,base,head:introduced,scope:PATROL_SCOPE,mode:'pr',outputDir,snapshotBase,snapshotHead};
  const result=await runDevicePatrolGate(options);expect(result.receipt.verdict).toBe('PASS');expect(result.report.base.kind).toBe('verified_scope_absent');expect(result.report.business_runtime_status).toBe('not_evaluated');
  writeFileSync(join(dir,'unregistered-script.py'),'raise Exception("unregistered")\n');git('add','.');git('commit','-q','-m','unclaimed code must fail');
  await expect(runDevicePatrolGate({...options,head:git('rev-parse','HEAD')})).rejects.toThrow('PATROL_CHANGED_FILE_UNCLAIMED');
 }finally{rmSync(outputDir,{recursive:true,force:true});}
});
