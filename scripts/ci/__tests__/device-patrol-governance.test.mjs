import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validatePatrolSecretIgnore,runDevicePatrolGate} from '../implementation-device-patrol-gate.mjs';
import {PATROL_SCOPE,PATROL_REPO,PATROL_PATH,PATROL_ASSERTION,patrolSourceProof,sha,canonical} from '../../../packages/brain/src/lib/device-patrol-admission.js';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
const commit='a'.repeat(40),row=commit+':scripts/phone-account-patrol/test_deploy.py:generic-api-key:7';
const publicLine="good = {key: '66fe22f5-1a60-4e23-bcfb-7b4df2f0fbff' for key in ['single_workflow_id', 'batch_workflow_id', 'schedule_id', 'project_id']}";
test('仅接受固定Git测试单行公开UUID误报，不扩大ignore范围',()=>{
 assert.equal(validatePatrolSecretIgnore('# prior\n','# prior\n# public fixture\n'+row+'\n',()=>publicLine).fingerprint,row);
 for(const bad of ['*',commit+':any.py:generic-api-key:7',row+'\n'+row,commit+':scripts/phone-account-patrol/test_deploy.py:generic-api-key:8'])assert.throws(()=>validatePatrolSecretIgnore('# prior\n','# prior\n'+bad+'\n',()=>publicLine));
 assert.throws(()=>validatePatrolSecretIgnore('# prior\n','# prior\n'+row+'\n',()=>"api_key = 'real-secret'"));
});

function documentFixture(path,{authoringBefore,authoringAfter,executable=false,scopedFiles,additionalTest}={}){
 const root=mkdtempSync(join(tmpdir(),'patrol-governance-')),repo=join(root,'repo');mkdirSync(repo);
 const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const write=(path,value)=>{mkdirSync(dirname(join(repo,path)),{recursive:true});writeFileSync(join(repo,path),value);};
 git('init','--quiet');git('config','core.hooksPath',join(root,'isolated-fixture-hooks'));git('config','user.name','Governance fixture');git('config','user.email','fixture@example.invalid');git('remote','add','origin',`https://github.com/${PATROL_REPO}.git`);
 write('README.md','isolated source fixture\n');
 if(authoringBefore!==undefined)write(path,authoringBefore);
 git('add','.');git('commit','--quiet','-m','actual empty scope');const base=git('rev-parse','HEAD'),baseTree=git('rev-parse',`${base}^{tree}`);
 const assertionPath=PATROL_ASSERTION.replace('node --test ',''),contract={schema_version:1,scope:PATROL_SCOPE,capability_id:'2173a385-a743-41f3-bb7d-d0e4b1d51d4e',workflows:[
  {id:'66fe22f5-1a60-4e23-bcfb-7b4df2f0fbff',key:'single-phone-account-patrol',activities:[{id:'d51eefa1-0ffd-43d7-94ba-16ff6b4d3800',key:'device-readiness',bindings:['scripts/phone-account-patrol/preflight.py'],assertion_ref:PATROL_ASSERTION}]},
  {id:'7dfd3b5d-bc5a-4d96-b744-10d26bc7eb70',key:'phone-account-patrol-batch',activities:[{id:'b33c9f29-5c5f-4fb1-908c-475bb9566085',key:'enabled-phone-list',bindings:['scripts/phone-account-patrol/runner.py'],assertion_ref:PATROL_ASSERTION}]}],auxiliary_paths:[PATROL_PATH,assertionPath],maintenance_owner:'主理人',schedule:{time:'22:00',timezone:'Asia/Shanghai'}};
 write(PATROL_PATH,JSON.stringify(contract));write('scripts/phone-account-patrol/preflight.py','READY = True\n');write('scripts/phone-account-patrol/runner.py','BATCH = True\n');
 if(scopedFiles)for(const [name,bytes] of Object.entries(scopedFiles))write('scripts/phone-account-patrol/'+name,bytes);
 write(assertionPath,"import {test} from 'node:test'; import assert from 'node:assert/strict'; import {readFileSync} from 'node:fs'; test('actual isolated source bytes',()=>assert.equal(readFileSync('scripts/phone-account-patrol/preflight.py','utf8'),'READY = True\\n')); test('central read credential is unavailable to candidate assertions',()=>assert.equal(process.env.SKILLS_SOURCE_SSH_KEY,undefined));\n");
 git('add','.');git('commit','--quiet','-m','actual introduced source');const introduced=git('rev-parse','HEAD');
 const source=patrolSourceProof(contract,introduced,path=>execFileSync('git',['show',`${introduced}:${path}`],{cwd:repo}));
 const registration={provenance:{base_revision:base,introduced_revision:introduced,base_tree_sha:baseTree,base_paths:['README.md'],introduced_paths:git('ls-tree','-r','--name-only',introduced).split('\n'),compare_status:'ahead',actor:'isolated regression fixture'},source};
 write(path,typeof authoringAfter==='function'?authoringAfter(introduced):authoringAfter??'## 真实交付说明\n');
 if(additionalTest!==undefined)write('services/phone-adb-controller/patrol/contracts/definitions.test.mjs',additionalTest);
 git('add','.');
 if(executable){chmodSync(join(repo,path),0o755);git('update-index','--chmod=+x',path);}
 git('commit','--quiet','-m','delivery documentation');const head=git('rev-parse','HEAD');
 const snapshot=(revision,file)=>{const body={schema_version:1,scope:PATROL_SCOPE,repo:PATROL_REPO,purpose:'scope_identity_bootstrap_only',revision_basis:'requested_ci_input_not_source_attestation',status:'verified',gaps:[],revision,registration,registration_sha256:sha(JSON.stringify(canonical(registration)))};writeFileSync(file,JSON.stringify({...body,snapshot_sha256:sha(JSON.stringify(canonical(body)))}));};
 const gateBase=scopedFiles?introduced:base;
 const snapshotBase=join(root,'base.json'),snapshotHead=join(root,'head.json');snapshot(gateBase,snapshotBase);snapshot(head,snapshotHead);
 return {root,repo,options:{repoRoot:repo,scope:PATROL_SCOPE,mode:'pr',base:gateBase,head,snapshotBase,snapshotHead,outputDir:join(root,'evidence')}};
}
test('真实Git交付Learning归开发治理，不作为手机Activity或扩大aux',async()=>{
 const path='docs/learnings/cp-10101635-phone-account-patrol.md',fixture=documentFixture(path);
 try{const {report,receipt}=await runDevicePatrolGate(fixture.options);const row=report.file_coverage.find(row=>row.path===path);assert.equal(receipt.verdict,'PASS');assert.equal(row.kind,'project_document');assert.equal(row.owner,'开发交付治理');assert.equal(row.capability_id,'ec4eb591-e064-4886-a7b6-4452cdf333d2');assert.equal(row.head_sha256,sha(readFileSync(join(fixture.repo,path))));assert.equal(report.head.auxiliary.some(row=>row.path===path),false);assert.equal(report.head.bindings.some(row=>row.path===path),false);}finally{rmSync(fixture.root,{recursive:true,force:true});}
});
test('其它Learning不能借巡查交付治理认领',async()=>{
 for(const path of ['docs/learnings/cp-other-phone-account-patrol.md','docs/learnings/cp-10101635-phone-account-patrol.md.extra']){const fixture=documentFixture(path);try{await assert.rejects(runDevicePatrolGate(fixture.options),new RegExp(`PATROL_CHANGED_FILE_UNCLAIMED:${path}`));}finally{rmSync(fixture.root,{recursive:true,force:true});}}
});

const authoringPaths=[
 'services/phone-adb-controller/commander/contracts/workflow-commander.json',
 'services/phone-adb-controller/commander/contracts/workflow-report.json',
 'services/phone-adb-controller/patrol/contracts/single.json',
 'services/phone-adb-controller/patrol/contracts/batch.json',
 'services/phone-adb-controller/patrol/contracts/maintenance.json',
];
function authoringDocument(version,source='fixed-source'){
 return JSON.stringify({version,source:{version:source}},null,2)+'\n';
}
test('固定的五份 authoring 版头逐一出具真实 Git 准入证据',async()=>{
 for(const path of authoringPaths){
  const authoringBefore=authoringDocument('1.7.9'),authoringAfter=authoringDocument('1.7.10');
  const fixture=documentFixture(path,{authoringBefore,authoringAfter});
  try{
   const {report,receipt}=await runDevicePatrolGate(fixture.options);
   assert.equal(receipt.verdict,'PASS');
   assert.ok(report.source.changed_files.includes(path));
   const row=report.file_coverage.find(row=>row.path===path);
   assert.equal(row.kind,'fixed_authoring_version');
   assert.equal(row.base_version,'1.7.9');
   assert.equal(row.head_version,'1.7.10');
   assert.equal(row.base_sha256,sha(Buffer.from(authoringBefore)));
   assert.equal(row.head_sha256,sha(Buffer.from(authoringAfter)));
  }finally{rmSync(fixture.root,{recursive:true,force:true});}
 }
});
test('拒绝额外内容、回退或非标准版头、文件模式变化、文件新增及近似路径',async()=>{
 const path=authoringPaths[0],authoringBefore=authoringDocument('1.7.9');
 for(const [file,options] of [
  [path,{authoringBefore,authoringAfter:authoringDocument('1.7.10','changed-source')}],
  [path,{authoringBefore,authoringAfter:authoringDocument('1.7.8')}],
  [path,{authoringBefore,authoringAfter:authoringDocument('1.7.010')}],
  [path,{authoringBefore,authoringAfter:authoringDocument('1.7.10'),executable:true}],
  [path,{authoringAfter:authoringDocument('1.7.10')}],
  [path+'.extra',{authoringBefore,authoringAfter:authoringDocument('1.7.10')}],
 ]){
  const fixture=documentFixture(file,options);
  try{await assert.rejects(runDevicePatrolGate(fixture.options),/PATROL_(?:AUTHORING_VERSION_INVALID|CHANGED_FILE_UNCLAIMED):/);}
  finally{rmSync(fixture.root,{recursive:true,force:true});}
 }
});

const singlePath='services/phone-adb-controller/patrol/contracts/single.json';
const scopedTestPath='services/phone-adb-controller/patrol/contracts/definitions.test.mjs';
const scopedFiles=Object.fromEntries(['dispatch.py','preflight.py','collector.py','ocr.swift','publish.mjs','mirror.mjs','runner.py'].map(name=>[name,`fixed test bytes for ${name}\n`]));
scopedFiles['preflight.py']='READY = True\n';
const existingPhone='864154c57e88e8085d2add741a79103a28891a44';
const command=(revision,serial)=>`/usr/bin/python3 /Users/administrator/.local/share/phone-account-patrol/releases/${revision}/runner.py phone --serial ${serial} --execution-script "$0"`;

function scopedFixture(mutate,additionalTest="import assert from 'node:assert/strict'; assert.ok(true);\n"){
 const prior={
  key:'single-phone-account-patrol',version:'0.1.393',
  runtime:{entrypoint:command(existingPhone,'{{phone_serial}}'),script:{host:'mmv',cwd:null,env:{},commands:[command(existingPhone,'{{phone_serial}}')]}},
  input_schema:{properties:{source_revision:{enum:[existingPhone]},phone_source_revision:{enum:[existingPhone]}}},
  activities:Object.keys(scopedFiles).map(name=>({key:name,implementation:{kind:'code',repo:PATROL_REPO,path:'scripts/phone-account-patrol/'+name,revision:existingPhone,version:existingPhone,digest:'sha256:'+sha(name)}})),
 };
 const authoringAfter=revision=>{
  const next=structuredClone(prior);next.version='0.1.394';
  next.runtime.script.commands.push(command(revision,'ANGYVB4311010223'));
  for(const key of ['source_revision','phone_source_revision'])next.input_schema.properties[key].enum.push(revision);
  for(const row of next.activities)row.implementation_bindings=[{...row.implementation,revision,version:revision,digest:'sha256:'+sha(scopedFiles[row.key])}];
  mutate?.(next);
  return JSON.stringify(next,null,2)+'\n';
 };
 return documentFixture(singlePath,{authoringBefore:JSON.stringify(prior,null,2)+'\n',authoringAfter,scopedFiles,additionalTest});
}

test('单机真实 Git 固定包只追加小彩候选且执行指定的定义测试',async()=>{
 const fixture=scopedFixture();
 try{
  const {report,receipt}=await runDevicePatrolGate(fixture.options);
  assert.equal(receipt.verdict,'PASS');
  assert.equal(report.file_coverage.find(row=>row.path===singlePath)?.kind,'fixed_single_patrol_candidate');
  assert.ok(receipt.assertions.some(row=>row.assertion_ref===`node --test ${scopedTestPath}`&&row.exit_code===0));
 }finally{rmSync(fixture.root,{recursive:true,force:true});}
});

test('单机候选拒绝扩设备、改默认、篡改绑定和额外活动',async()=>{
 for(const mutate of [
  next=>{next.runtime.script.commands[1]=next.runtime.script.commands[1].replace('ANGYVB4311010223','e6c7ef34');},
  next=>{next.runtime.entrypoint=next.runtime.script.commands[1];},
  next=>{next.activities[0].implementation_bindings[0].digest='sha256:'+'0'.repeat(64);},
  next=>{next.activities[0].implementation_bindings.push({...next.activities[0].implementation_bindings[0],path:'scripts/phone-account-patrol/other.py'});},
  next=>{next.activities.push(next.activities[0]);},
 ]){
  const fixture=scopedFixture(mutate);
  try{await assert.rejects(runDevicePatrolGate(fixture.options),/PATROL_AUTHORING_VERSION_INVALID:/);}
  finally{rmSync(fixture.root,{recursive:true,force:true});}
 }
});

test('新增固定单机的定义测试失败时不发成功凭证',async()=>{
 const fixture=scopedFixture(undefined,"import assert from 'node:assert/strict'; assert.ok(false);\n");
 try{
  await assert.rejects(runDevicePatrolGate(fixture.options),/PATROL_REGRESSION_FAILED/);
  const receipt=JSON.parse(readFileSync(join(fixture.options.outputDir,'receipt.json')));
  assert.equal(receipt.assertions.find(r=>r.assertion_ref===PATROL_ASSERTION).exit_code,0);
  assert.equal(receipt.assertions.find(r=>r.assertion_ref===`node --test ${scopedTestPath}`).exit_code,1);
 }
 finally{rmSync(fixture.root,{recursive:true,force:true});}
});

test('本次infra领跑PRD与DoD真实Git准入归开发治理，手机身份不变',async()=>{
 for(const path of ['.prd-cp-10121630-phone-patrol-openclaw.md','.dod-cp-10121630-phone-patrol-openclaw.md']){
  const fixture=documentFixture(path);
  try{
   const {report,receipt}=await runDevicePatrolGate(fixture.options),row=report.file_coverage.find(row=>row.path===path);
   assert.equal(receipt.verdict,'PASS');assert.equal(row.kind,'project_document');assert.equal(row.owner,'开发交付治理');
   assert.equal(row.head_sha256,sha(readFileSync(join(fixture.repo,path))));
   assert.equal(report.head.auxiliary.some(row=>row.path===path),false);assert.equal(report.head.bindings.some(row=>row.path===path),false);
  }finally{rmSync(fixture.root,{recursive:true,force:true});}
 }
});
test('近似infra项目文档仍由真实Git门禁拒绝，不扩大文档匹配',async()=>{
 for(const path of ['.prd-cp-10121630-phone-patrol-openclaw.md.extra','.dod-cp-10121631-phone-patrol-openclaw.md','.prd-cp-other-phone-patrol-openclaw.md']){
  const fixture=documentFixture(path);
  try{await assert.rejects(runDevicePatrolGate(fixture.options),error=>error.code===`PATROL_CHANGED_FILE_UNCLAIMED:${path}`);}
  finally{rmSync(fixture.root,{recursive:true,force:true});}
 }
});


test('trusted gate retains central read capability while candidate regression receives no key',async()=>{
 const previous=process.env.SKILLS_SOURCE_SSH_KEY;
 process.env.SKILLS_SOURCE_SSH_KEY='isolated-test-capability-not-a-real-key';
 const fixture=documentFixture('docs/learnings/cp-10101635-phone-account-patrol.md');
 try{
  const {receipt}=await runDevicePatrolGate(fixture.options);
  assert.equal(receipt.verdict,'PASS');
  assert.equal(receipt.assertions[0].exit_code,0);
  assert.equal(process.env.SKILLS_SOURCE_SSH_KEY,'isolated-test-capability-not-a-real-key');
 }finally{
  if(previous===undefined)delete process.env.SKILLS_SOURCE_SSH_KEY;else process.env.SKILLS_SOURCE_SSH_KEY=previous;
  rmSync(fixture.root,{recursive:true,force:true});
 }
});
