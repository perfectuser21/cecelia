import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,readdirSync,mkdirSync,symlinkSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {bundle} from './fixtures/admission-bundle.mjs';
import {infraSnapshot} from './fixtures/infra-snapshot.mjs';
import * as skill from '../implementation-skill-source.mjs';
const repo='perfectuser21/cecelia';
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'ci-admission-cache-source-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',['-C',root,'-c','core.hooksPath=/dev/null','-c','commit.gpgSign=false',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','-q');git('remote','add','origin','https://github.com/'+repo+'.git');
 const commit=text=>{writeFileSync(join(root,'product.txt'),text);git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','test: source');return git('rev-parse','HEAD');};
 const base=commit('base'),head=commit('head'),parent=bundle(base).snapshot;
 const snapshots=[parent,parent.admission_companion.snapshot,infraSnapshot(base).snapshot];
 return {root,base,head,snapshots,git};
}
function request(f,extra={}){return {repoRoot:f.root,repo,revisions:[f.base,f.head],inputDir:join(f.root,'verified-input'),toolingRoot:f.root,mode:'pr',repository:repo,eventName:'pull_request',event:{},toolingRevision:f.base,...extra};}
function functionUnderTest(){assert.equal(typeof skill.prepareCiAdmissionSkillCache,'function','CI封套必须经原始authority和scratch能力验证后才能准备Skill缓存');return skill.prepareCiAdmissionSkillCache;}
test('仅在opaque输入能力的scratch callback中使用三scope绑定，缓存留在候选外且不落裸snapshot',async t=>{
 const f=fixture(t),cap=Object.freeze({}),events=[];let cache;
 const deps={loadCiAdmissionInputs:async options=>{assert.equal(options.mode,'pr');assert.equal(options.repoRoot,f.root);events.push('authority');return cap;},
  withCiAdmissionInputsScratch:async(handle,consume)=>{assert.equal(handle,cap);events.push('scratch');return consume({snapshots:f.snapshots,source:{repo,base_revision:f.base,head_revision:f.head}});}};
 try{cache=await functionUnderTest()(request(f),deps);assert.equal(typeof cache,'string');assert.ok(!cache.startsWith(f.root+'/'));assert.deepEqual(events,['authority','scratch']);assert.deepEqual(readdirSync(f.root).sort(),['.git','product.txt']);assert.equal(f.git('status','--porcelain'),'');}
 finally{if(cache)rmSync(dirname(cache),{recursive:true,force:true});}
});
test('错误用途或仓库在任何读取authority/创建scratch/获取私有Skill前拒绝',async t=>{
 const f=fixture(t),run=functionUnderTest();let calls=0;
 const deps={loadCiAdmissionInputs:async()=>{calls++;throw Error('UNEXPECTED_IO');},withCiAdmissionInputsScratch:async()=>{calls++;throw Error('UNEXPECTED_IO');}};
 for(const patch of[{mode:'main'},{mode:'release'},{repo:'foreign/repo'},{repository:'foreign/repo'},{eventName:'workflow_dispatch'}])await assert.rejects(run(request(f,patch),deps),/CI_ADMISSION|SKILL_CACHE/);
 assert.equal(calls,0);
});
test('authority错误、固定base/head漂移、缺scope均拒绝且不退回legacy缓存',async t=>{
 const f=fixture(t),run=functionUnderTest();
 await assert.rejects(run(request(f),{loadCiAdmissionInputs:async()=>{throw Error('CI_ADMISSION_ORIGINAL_ARTIFACT_MISMATCH');}}),/CI_ADMISSION_ORIGINAL_ARTIFACT_MISMATCH/);
 for(const patch of[{source:{repo,base_revision:'a'.repeat(40),head_revision:f.head}},{source:{repo,base_revision:f.base,head_revision:'b'.repeat(40)}},{snapshots:f.snapshots.slice(1)}]){
  await assert.rejects(run(request(f),{loadCiAdmissionInputs:async()=>({}),withCiAdmissionInputsScratch:async(_,consume)=>consume({snapshots:f.snapshots,source:{repo,base_revision:f.base,head_revision:f.head},...patch})}),/CI_ADMISSION|SKILL_CACHE/);
 }
 assert.deepEqual(readdirSync(f.root).sort(),['.git','product.txt']);
});
test('真实CLI的typed定位变量不能授权main或跨仓，也不能在拒绝前读取event或候选Git',()=>{
 const entry=fileURLToPath(new URL('../implementation-skill-source.mjs',import.meta.url));
 for(const patch of[{MODE:'main'},{MODE:'release'},{GITHUB_EVENT_NAME:'workflow_dispatch'},{GITHUB_REPOSITORY:'foreign/repo'}]){
  const result=spawnSync(process.execPath,[entry,'--prepare-ci-cache','/nonexistent-ci-candidate',repo,'a'.repeat(40),'b'.repeat(40)],{encoding:'utf8',env:{...process.env,IMPLEMENTATION_CI_ADMISSION_INPUT_DIR:'/nonexistent-ci-artifact',MODE:'pr',GITHUB_EVENT_NAME:'pull_request',GITHUB_REPOSITORY:repo,GITHUB_EVENT_PATH:'/nonexistent-ci-event',...patch}});
  assert.equal(result.status,1);assert.match(result.stderr,/SKILL_CACHE_CI_ADMISSION_CONTEXT_INVALID/);assert.doesNotMatch(result.stderr,/ENOENT|ERR_MODULE_NOT_FOUND/);
 }
});
test('typed与legacy参数混合先拒用途及混合，不能读取不存在的snapshot',()=>{
 const entry=fileURLToPath(new URL('../implementation-skill-source.mjs',import.meta.url));
 for(const mode of ['main','pr']){
  const r=spawnSync(process.execPath,[entry,'--prepare-ci-cache','/nonexistent-ci-candidate',repo,'a'.repeat(40),'b'.repeat(40),'--snapshot','/nonexistent-must-not-read-legacy'],{encoding:'utf8',env:{...process.env,IMPLEMENTATION_CI_ADMISSION_INPUT_DIR:'/nonexistent-ci-artifact',MODE:mode,GITHUB_EVENT_NAME:'pull_request',GITHUB_REPOSITORY:repo}});
  assert.equal(r.status,1);assert.match(r.stderr,mode==='main'?/SKILL_CACHE_CI_ADMISSION_CONTEXT_INVALID/:/SKILL_CACHE_CI_ADMISSION_LEGACY_MIXED/);assert.doesNotMatch(r.stderr,/ENOENT|SyntaxError/);
 }
});
test('真实CLI在慢authority边界替身后只materialize一次，不使用启动时的过期预算',t=>{
 const f=fixture(t),mirror=mkdtempSync(join(tmpdir(),'ci-admission-cache-tooling-'));t.after(()=>rmSync(mirror,{recursive:true,force:true}));
 const original=fileURLToPath(new URL('../../../',import.meta.url)),ci=join(mirror,'scripts/ci');mkdirSync(ci,{recursive:true});
 for(const path of ['packages','node_modules'])symlinkSync(join(original,path),join(mirror,path),'dir');
 for(const file of ['implementation-skill-source.mjs','fixed-local-git.mjs'])copyFileSync(join(original,'scripts/ci',file),join(ci,file));
 // 只模拟已核输入能力的时间/回调边界，实际Git、snapshot校验与缓存创建执行原实现。
 writeFileSync(join(ci,'ci-admission-inputs.mjs'),`const started=Date.now();export async function loadCiAdmissionInputs(){Date.now=()=>started+61000;return{};}export async function withCiAdmissionInputsScratch(handle,consume){return consume(${JSON.stringify({snapshots:f.snapshots,source:{repo,base_revision:f.base,head_revision:f.head}})});}`);
 const event=join(mirror,'event.json');writeFileSync(event,'{}');
 const r=spawnSync(process.execPath,[join(ci,'implementation-skill-source.mjs'),'--prepare-ci-cache',f.root,repo,f.base,f.head],{encoding:'utf8',env:{...process.env,RUNNER_TEMP:mirror,GITHUB_WORKSPACE:mirror,IMPLEMENTATION_CI_ADMISSION_INPUT_DIR:join(mirror,'ci-admission'),MODE:'pr',GITHUB_EVENT_NAME:'pull_request',GITHUB_REPOSITORY:repo,GITHUB_EVENT_PATH:event,TOOLING_REVISION:f.base}});
 assert.equal(r.status,0,r.stderr);assert.ok(r.stdout.trim().startsWith(join(mirror,'implementation-skills-ci-')));assert.equal(f.git('status','--porcelain'),'');
});
