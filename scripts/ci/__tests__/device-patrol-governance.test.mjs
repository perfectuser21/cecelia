import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validatePatrolSecretIgnore,runDevicePatrolGate} from '../implementation-device-patrol-gate.mjs';
import {PATROL_SCOPE,PATROL_REPO,PATROL_PATH,PATROL_ASSERTION,patrolSourceProof,sha,canonical} from '../../../packages/brain/src/lib/device-patrol-admission.js';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
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

function documentFixture(path){
 const root=mkdtempSync(join(tmpdir(),'patrol-governance-')),repo=join(root,'repo');mkdirSync(repo);
 const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const write=(path,value)=>{mkdirSync(dirname(join(repo,path)),{recursive:true});writeFileSync(join(repo,path),value);};
 git('init','--quiet');git('config','core.hooksPath',join(root,'isolated-fixture-hooks'));git('config','user.name','Governance fixture');git('config','user.email','fixture@example.invalid');git('remote','add','origin',`https://github.com/${PATROL_REPO}.git`);
 write('README.md','isolated source fixture\n');git('add','.');git('commit','--quiet','-m','actual empty scope');const base=git('rev-parse','HEAD'),baseTree=git('rev-parse',`${base}^{tree}`);
 const assertionPath=PATROL_ASSERTION.replace('node --test ',''),contract={schema_version:1,scope:PATROL_SCOPE,capability_id:'2173a385-a743-41f3-bb7d-d0e4b1d51d4e',workflows:[
  {id:'66fe22f5-1a60-4e23-bcfb-7b4df2f0fbff',key:'single-phone-account-patrol',activities:[{id:'d51eefa1-0ffd-43d7-94ba-16ff6b4d3800',key:'device-readiness',bindings:['scripts/phone-account-patrol/preflight.py'],assertion_ref:PATROL_ASSERTION}]},
  {id:'7dfd3b5d-bc5a-4d96-b744-10d26bc7eb70',key:'phone-account-patrol-batch',activities:[{id:'b33c9f29-5c5f-4fb1-908c-475bb9566085',key:'enabled-phone-list',bindings:['scripts/phone-account-patrol/runner.py'],assertion_ref:PATROL_ASSERTION}]}],auxiliary_paths:[PATROL_PATH,assertionPath],maintenance_owner:'主理人',schedule:{time:'22:00',timezone:'Asia/Shanghai'}};
 write(PATROL_PATH,JSON.stringify(contract));write('scripts/phone-account-patrol/preflight.py','READY = True\n');write('scripts/phone-account-patrol/runner.py','BATCH = True\n');
 write(assertionPath,"import {test} from 'node:test'; import assert from 'node:assert/strict'; import {readFileSync} from 'node:fs'; test('actual isolated source bytes',()=>assert.equal(readFileSync('scripts/phone-account-patrol/preflight.py','utf8'),'READY = True\\n'));\n");
 git('add','.');git('commit','--quiet','-m','actual introduced source');const introduced=git('rev-parse','HEAD');
 const source=patrolSourceProof(contract,introduced,path=>execFileSync('git',['show',`${introduced}:${path}`],{cwd:repo}));
 const registration={provenance:{base_revision:base,introduced_revision:introduced,base_tree_sha:baseTree,base_paths:['README.md'],introduced_paths:git('ls-tree','-r','--name-only',introduced).split('\n'),compare_status:'ahead',actor:'isolated regression fixture'},source};
 write(path,'## 真实交付说明\n');git('add','.');git('commit','--quiet','-m','delivery documentation');const head=git('rev-parse','HEAD');
 const snapshot=(revision,file)=>{const body={schema_version:1,scope:PATROL_SCOPE,repo:PATROL_REPO,purpose:'scope_identity_bootstrap_only',revision_basis:'requested_ci_input_not_source_attestation',status:'verified',gaps:[],revision,registration,registration_sha256:sha(JSON.stringify(canonical(registration)))};writeFileSync(file,JSON.stringify({...body,snapshot_sha256:sha(JSON.stringify(canonical(body)))}));};
 const snapshotBase=join(root,'base.json'),snapshotHead=join(root,'head.json');snapshot(base,snapshotBase);snapshot(head,snapshotHead);
 return {root,repo,options:{repoRoot:repo,scope:PATROL_SCOPE,mode:'pr',base,head,snapshotBase,snapshotHead,outputDir:join(root,'evidence')}};
}
test('真实Git交付Learning归开发治理，不作为手机Activity或扩大aux',async()=>{
 const path='docs/learnings/cp-10101635-phone-account-patrol.md',fixture=documentFixture(path);
 try{const {report,receipt}=await runDevicePatrolGate(fixture.options);const row=report.file_coverage.find(row=>row.path===path);assert.equal(receipt.verdict,'PASS');assert.equal(row.kind,'project_document');assert.equal(row.owner,'开发交付治理');assert.equal(row.capability_id,'ec4eb591-e064-4886-a7b6-4452cdf333d2');assert.equal(row.head_sha256,sha(readFileSync(join(fixture.repo,path))));assert.equal(report.head.auxiliary.some(row=>row.path===path),false);assert.equal(report.head.bindings.some(row=>row.path===path),false);}finally{rmSync(fixture.root,{recursive:true,force:true});}
});
test('其它Learning不能借巡查交付治理认领',async()=>{
 for(const path of ['docs/learnings/cp-other-phone-account-patrol.md','docs/learnings/cp-10101635-phone-account-patrol.md.extra']){const fixture=documentFixture(path);try{await assert.rejects(runDevicePatrolGate(fixture.options),new RegExp(`PATROL_CHANGED_FILE_UNCLAIMED:${path}`));}finally{rmSync(fixture.root,{recursive:true,force:true});}}
});
