import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,readdirSync,rmSync,symlinkSync,unlinkSync,mkdirSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {baselineFixture} from './fixtures/ci-admission-pr.mjs';
import {resolvePrBaseline} from '../implementation-pr-baseline.mjs';
import {writeCiAdmissionInputs} from '../ci-admission-handoff.mjs';
import {loadCiAdmissionInputs,inspectCiAdmissionInputs,withCiAdmissionInputsScratch} from '../ci-admission-inputs.mjs';
async function fixture(t){
 const f=await baselineFixture(t),parent=mkdtempSync(join(tmpdir(),'ci-admission-inputs-'));t.after(()=>rmSync(parent,{recursive:true,force:true}));
 const result=await resolvePrBaseline(f.options,f.deps),inputDir=writeCiAdmissionInputs({inputDir:parent,result});
 return {...f,parent,result,inputDir,load:()=>loadCiAdmissionInputs({...f.options,inputDir,mode:'pr'},f.deps)};
}
test('typed交接只落原ZIP和descriptor，重核官方同一first-parent能力，source采用标准PR字段',async t=>{
 const f=await fixture(t);assert.deepEqual(readdirSync(f.parent),['ci-admission']);assert.deepEqual(readdirSync(f.inputDir).sort(),['artifact.zip','handoff.json']);
 assert.deepEqual(readFileSync(join(f.inputDir,'artifact.zip')),f.result.ciAdmission.archive);
 const handle=await f.load(),view=inspectCiAdmissionInputs(handle);
 assert.deepEqual(view.source,{repo:'perfectuser21/cecelia',base_revision:f.source,head_revision:f.result.resolution.head_revision});
 assert.deepEqual(view.scopes,['cecelia-kr','cecelia-factory','cecelia-infra']);assert.equal(view.provenance.purpose,'ci_admission_only');
 assert.equal(view.provenance.artifact_id,77);assert.equal(view.provenance.control_revision,f.control);
 assert.equal(view.provenance.original_pr_base_revision,f.control);assert.equal(view.provenance.tooling_revision,f.control);
 assert.throws(()=>inspectCiAdmissionInputs({...handle}),/CAPABILITY_REQUIRED/);
 await assert.rejects(withCiAdmissionInputsScratch({},()=>assert.fail('must not open')),/CAPABILITY_REQUIRED/);
});
for(const mode of ['main','release','recovery'])test(`非PR ${mode} 在任何外部I/O前拒绝`,async()=>{
 let calls=0;await assert.rejects(loadCiAdmissionInputs({mode,inputDir:'/does/not/exist'},{api:()=>{calls++;}}),/USAGE_FORBIDDEN/);assert.equal(calls,0);
});
for(const mutation of ['zip','descriptor','symlink','directory-symlink','official-changed','pr-changed'])test(`typed入口拒绝 ${mutation} 且不转换legacy`,async t=>{
 const f=await fixture(t),path=join(f.inputDir,'handoff.json');
 if(mutation==='zip')writeFileSync(join(f.inputDir,'artifact.zip'),'not original');
 if(mutation==='descriptor'){const d=JSON.parse(readFileSync(path));d.head_revision='f'.repeat(40);writeFileSync(path,JSON.stringify(d));}
 if(mutation==='symlink'){unlinkSync(path);symlinkSync(join(f.inputDir,'artifact.zip'),path);}
 if(mutation==='directory-symlink'){const link=join(f.parent,'alias');symlinkSync(f.inputDir,link,'dir');f.inputDir=link;}
 if(mutation==='official-changed')f.data.get('repos/perfectuser21/cecelia/actions/artifacts/77').digest='sha256:'+'f'.repeat(64);
 if(mutation==='pr-changed')f.options.event.pull_request.head.sha='f'.repeat(40);
 await assert.rejects(loadCiAdmissionInputs({...f.options,inputDir:f.inputDir,mode:'pr'},f.deps),/CI_ADMISSION_|PR_BASELINE_/);
 assert.equal(readdirSync(f.parent).includes('base'),false);
});
test('writer拒绝伪能力、重复写和已有symlink，不留下legacy视图',async t=>{
 const f=await fixture(t);assert.throws(()=>writeCiAdmissionInputs({inputDir:f.parent,result:f.result}),/EXISTS/);
 assert.throws(()=>writeCiAdmissionInputs({inputDir:f.parent,result:{...f.result,ciAdmission:{...f.result.ciAdmission,capability:{}}}}),/CAPABILITY_REQUIRED/);
 assert.equal(readdirSync(f.parent).includes('head'),false);
});
test('load后HEAD工作区漂移在任何PG资源申请前拒绝',async t=>{
 const f=await fixture(t),handle=await f.load();writeFileSync(join(f.candidate,'source'),'changed after verified load');
 await assert.rejects(withCiAdmissionInputsScratch(handle,()=>assert.fail('must not consume')),/CI_ADMISSION_CHECKOUT_CHANGED/);
});

test('真实resolver CLI新purpose只交原ZIP/descriptor，stdoutBASE与resolution保留',async t=>{
 const f=await baselineFixture(t),parent=mkdtempSync(join(tmpdir(),'ci-admission-cli-'));t.after(()=>rmSync(parent,{recursive:true,force:true}));
 const input=join(parent,'input'),output=join(parent,'output'),bin=join(parent,'bin');mkdirSync(bin);
 const map=Object.fromEntries([...f.data].map(([k,v])=>[k,Buffer.isBuffer(v)?{binary:v.toString('base64')}:v]));
 map['repos/perfectuser21/cecelia/pulls/42']=f.options.event.pull_request;
 writeFileSync(join(parent,'api.json'),JSON.stringify(map));writeFileSync(join(parent,'event.json'),JSON.stringify(f.options.event));
 writeFileSync(join(bin,'gh'),`#!/usr/bin/env python3
import os,sys,json,base64
p=sys.argv[-1]; d=json.load(open(os.environ['FIXTURE_API_DATA']))
v=d.get(p)
if v is None and '/artifacts?name=' in p:v={'total_count':0,'artifacts':[]}
assert v is not None,p
sys.stdout.buffer.write(base64.b64decode(v['binary']) if isinstance(v,dict) and 'binary' in v else json.dumps(v).encode())
`);chmodSync(join(bin,'gh'),0o755);
 const child=spawnSync(process.execPath,[fileURLToPath(new URL('../implementation-pr-baseline.mjs',import.meta.url)),'--repo-root',f.candidate,'--tooling-root',f.root,'--input-dir',input,'--output-dir',output],
 {encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH,FIXTURE_API_DATA:join(parent,'api.json'),GITHUB_REPOSITORY:f.options.repository,GITHUB_EVENT_NAME:'pull_request',GITHUB_EVENT_PATH:join(parent,'event.json'),TOOLING_REVISION:f.control}});
 assert.equal(child.status,0,child.stderr);assert.equal(child.stdout.trim(),f.source);
 assert.deepEqual(readdirSync(input),['ci-admission']);assert.deepEqual(readdirSync(join(input,'ci-admission')).sort(),['artifact.zip','handoff.json']);
 assert.equal(JSON.parse(readFileSync(join(output,'baseline-resolution.json'))).baseline_kind,'ci_admission_only');
});
test('consumer身份metadata递归冻结，不能修改source或provenance再产报告',async t=>{
 const f=await fixture(t),view=inspectCiAdmissionInputs(await f.load());
 assert.ok(Object.isFrozen(view));for(const key of ['source','scopes','provenance'])assert.ok(Object.isFrozen(view[key]),key);
 assert.throws(()=>{view.source.base_revision='f'.repeat(40);},TypeError);
 assert.throws(()=>{view.provenance.artifact_id=999;},TypeError);
});
