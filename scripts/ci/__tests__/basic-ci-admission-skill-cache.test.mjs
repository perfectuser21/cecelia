import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {pilotPlanHash} from '../../../packages/brain/src/lib/pilot-release-verification.js';
import * as skill from '../implementation-skill-source.mjs';
const repo='perfectuser21/cecelia';
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'ci-admission-cache-source-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',['-C',root,'-c','core.hooksPath=/dev/null','-c','commit.gpgSign=false',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','-q');git('remote','add','origin','https://github.com/'+repo+'.git');
 const commit=text=>{writeFileSync(join(root,'product.txt'),text);git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','test: source');return git('rev-parse','HEAD');};
 const base=commit('base'),head=commit('head'),snapshots=['cecelia-kr','cecelia-factory','cecelia-infra'].map(scope=>{
  const body={schema_version:1,scope,repo,revision:base,status:'verified',gaps:[],definitions:{workflows:[],activities:[]}};
  return {...body,snapshot_sha256:pilotPlanHash(body)};
 });
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
