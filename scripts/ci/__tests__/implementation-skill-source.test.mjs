import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readImplementationSource} from '../implementation-skill-source.mjs';
import * as sourceApi from '../implementation-skill-source.mjs';
import {createFixedLocalSourceReader} from '../fixed-local-git.mjs';
import yaml from 'js-yaml';
import {readFileSync,existsSync} from 'node:fs';
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const commit=root=>{git(root,'add','.');git(root,'-c','user.name=Fixture','-c','user.email=f@f','-c','commit.gpgsign=false','commit','-qm','fixture');return git(root,'rev-parse','HEAD');};
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'trusted-skill-reader-')),business=join(root,'business'),central=join(root,'central');
 for(const dir of [business,central]){mkdirSync(dir);git(dir,'init','-q');git(dir,'config','core.hooksPath','/dev/null');}
 git(business,'remote','add','origin','https://github.com/perfectuser21/zenithjoy-workspace.git');
 const path='scripts/phone-account-patrol/SKILL.md',payload=Buffer.from('real source\n\n');
 mkdirSync(join(business,'scripts/phone-account-patrol'),{recursive:true});writeFileSync(join(business,path),payload);
 const before=commit(business);mkdirSync(join(central,'distribution'));writeFileSync(join(central,'body.md'),payload);
 const catalog={profiles:{zenithjoy:{files:[{path,source:'body.md',sha256:createHash('sha256').update(payload).digest('hex')}]}}};
 writeFileSync(join(central,'distribution/catalog.json'),JSON.stringify(catalog));const revision=commit(central);
 rmSync(join(business,path));writeFileSync(join(business,'.skills-source.json'),JSON.stringify({version:1,repository:'perfectuser21/zenithjoy-skills',profile:'zenithjoy',revision,loader_sha256:'0'.repeat(64)}));
 writeFileSync(join(business,'scripts/skills-source.py'),"raise Exception('CANDIDATE_MUST_NOT_EXECUTE')\n");
 const after=commit(business);
 return {business,central,path,payload,before,after,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
test('reads exact old and migrated Git bytes without executing candidate loader',()=>{
 const f=fixture();try{
  assert.deepEqual(readImplementationSource(f.business,f.before,f.path,{source:f.central}),f.payload);
  assert.deepEqual(readImplementationSource(f.business,f.after,f.path,{source:f.central}),f.payload);
  writeFileSync(join(f.central,'body.md'),'new checkout content must not be read');commit(f.central);
  writeFileSync(join(f.business,'.skills-source.json'),'poisoned working copy');
  assert.deepEqual(readImplementationSource(f.business,f.after,f.path,{source:f.central}),f.payload);
 }finally{f.cleanup();}
});
test('rejects missing entries, checksum mismatch and wrong profile',()=>{
 const f=fixture();try{
  assert.throws(()=>readImplementationSource(f.business,f.after,'missing/SKILL.md',{source:f.central}));
  const lock=JSON.parse(git(f.business,'show',`${f.after}:.skills-source.json`));lock.profile='cecelia';
  writeFileSync(join(f.business,'.skills-source.json'),JSON.stringify(lock));const wrong=commit(f.business);
  assert.throws(()=>readImplementationSource(f.business,wrong,f.path,{source:f.central}),/PROFILE/);
  lock.profile='zenithjoy';const catalog={profiles:{zenithjoy:{files:[{path:f.path,source:'body.md',sha256:'0'.repeat(64)}]}}};
  writeFileSync(join(f.central,'distribution/catalog.json'),JSON.stringify(catalog));lock.revision=commit(f.central);
  writeFileSync(join(f.business,'.skills-source.json'),JSON.stringify(lock));const corrupt=commit(f.business);
  assert.throws(()=>readImplementationSource(f.business,corrupt,f.path,{source:f.central}),/CHECKSUM/);
 }finally{f.cleanup();}
});
test('Git replacement objects cannot change historical business source',()=>{
 const f=fixture();try{
  const original=git(f.business,'rev-parse',`${f.before}:${f.path}`);
  const replacement=execFileSync('git',['-C',f.business,'hash-object','-w','--stdin'],{input:'malicious replacement',encoding:'utf8'}).trim();
  git(f.business,'replace',original,replacement);
  assert.deepEqual(readImplementationSource(f.business,f.before,f.path,{source:f.central}),f.payload);
 }finally{f.cleanup();}
});
test('Cecelia identity must select the Cecelia profile at the pinned revision',()=>{
 const f=fixture();try{
  git(f.business,'remote','set-url','origin','git@github.com:perfectuser21/cecelia.git');
  const catalog={profiles:{cecelia:{files:[{path:f.path,source:'body.md',sha256:createHash('sha256').update(f.payload).digest('hex')}]}}};
  writeFileSync(join(f.central,'distribution/catalog.json'),JSON.stringify(catalog));
  const lock=JSON.parse(git(f.business,'show',`${f.after}:.skills-source.json`));lock.profile='cecelia';lock.revision=commit(f.central);
  writeFileSync(join(f.business,'.skills-source.json'),JSON.stringify(lock));const revision=commit(f.business);
  assert.deepEqual(readImplementationSource(f.business,revision,f.path,{source:f.central}),f.payload);
 }finally{f.cleanup();}
});

test('可信CI缓存只接受固定锁，保持历史无锁，锁存在缺key必须先拒绝',()=>{
 const f=fixture();let cache;const prior=process.env.SKILLS_SOURCE_SSH_KEY;delete process.env.SKILLS_SOURCE_SSH_KEY;
 try{
  assert.equal(typeof sourceApi.prepareImplementationSkillCache,'function');
  cache=sourceApi.prepareImplementationSkillCache(f.business,'perfectuser21/zenithjoy-workspace',[f.before]);
  assert.ok(!cache.startsWith(f.business+'/'));assert.equal(existsSync(join(cache,'.git')),false);
  assert.throws(()=>sourceApi.prepareImplementationSkillCache(f.business,'perfectuser21/zenithjoy-workspace',[f.after]),/KEY_REQUIRED/);
  assert.throws(()=>sourceApi.prepareImplementationSkillCache(f.business,'perfectuser21/cecelia',[f.after]),/REPO/);
 }finally{if(cache)rmSync(cache,{recursive:true,force:true});if(prior!==undefined)process.env.SKILLS_SOURCE_SSH_KEY=prior;f.cleanup();}
});
test('fresh私有cache容纳base/head两份锁：不运行候选loader，不信source目录缓存或可变HEAD',()=>{
 const f=fixture();let cache;const previous=process.env.SKILLS_SOURCE_SSH_KEY;process.env.SKILLS_SOURCE_SSH_KEY='fixture-only';
 try{
  assert.equal(typeof sourceApi.prepareImplementationSkillCache,'function');
  const repo='perfectuser21/zenithjoy-workspace',lock=JSON.parse(git(f.business,'show',`${f.after}:.skills-source.json`)),first=lock.revision;
  writeFileSync(join(f.central,'new.txt'),'next revision');lock.revision=commit(f.central);
  writeFileSync(join(f.business,'.skills-source.json'),JSON.stringify(lock));const head=commit(f.business),requested=[];
  cache=sourceApi.prepareImplementationSkillCache(f.business,repo,[f.before,f.after,head],{fetchSource:(dir,revision)=>{
   requested.push(revision);if(!existsSync(join(dir,'.git')))git(f.central,'clone','--no-checkout','--quiet',f.central,dir);
   git(dir,'cat-file','-e',revision+'^{commit}');
  }});
  assert.deepEqual(requested,[first,lock.revision]);assert.ok(!cache.startsWith(f.business+'/'));
  const read=createFixedLocalSourceReader(f.business,repo,{centralSourceDir:cache});
  assert.throws(()=>read({repo:'perfectuser21/zenithjoy-skills',revision:first,path:'body.md'}),/LOCK/);
  read({repo,revision:f.after,path:'.skills-source.json'});
  assert.deepEqual(read({repo:'perfectuser21/zenithjoy-skills',revision:first,path:'body.md'}),f.payload);
  read({repo,revision:head,path:'.skills-source.json'});
  assert.deepEqual(read({repo:'perfectuser21/zenithjoy-skills',revision:lock.revision,path:'body.md'}),f.payload);
 }finally{if(cache)rmSync(cache,{recursive:true,force:true});if(previous===undefined)delete process.env.SKILLS_SOURCE_SSH_KEY;else process.env.SKILLS_SOURCE_SSH_KEY=previous;f.cleanup();}
});
test('Pilot与Impact使用trusted tooling准备隔离缓存，secret只进准备step且早于下载/校验',()=>{
 for(const [name,jobName,consume] of [['pilot-release-verification','verify','固定完整计划及白名单环境运行全部登记回归'],['implementation-impact','gate','实际变更影响与固定回归']]){
  const w=yaml.load(readFileSync(new URL('../../../.github/workflows/'+name+'.yml',import.meta.url),'utf8'));
  assert.deepEqual(w.on.workflow_call.secrets.SKILLS_SOURCE_SSH_KEY,{required:false});
  const steps=w.jobs[jobName].steps,index=steps.findIndex(s=>s.name==='准备固定中央Skill对象缓存');assert.ok(index>0);
  const step=steps[index];assert.equal(step.env.SKILLS_SOURCE_SSH_KEY,'${{ secrets.SKILLS_SOURCE_SSH_KEY }}');
  assert.match(step.run,/node tooling\/scripts\/ci\/implementation-skill-source\.mjs --prepare-ci-cache/);
  assert.match(step.run,/"\$GITHUB_WORKSPACE\/source"/);assert.match(step.run,/"\$SOURCE_REPO"/);
  assert.ok(index>steps.findIndex(s=>s.with?.path==='source'));assert.ok(index<steps.findIndex(s=>s.name===consume));
  const download=steps.findIndex(s=>s.uses?.startsWith('actions/download-artifact')||s.name==='下载固定SHA中央bundle（PR无中央写凭据）');assert.ok(index<download);
  if(jobName==='gate')assert.match(steps.find(s=>s.name===consume).env?.SKILLS_SOURCE_SSH_KEY||'',/steps\.skill-cache\.outputs\.legacy_185/);else assert.equal(steps.find(s=>s.name===consume).env?.SKILLS_SOURCE_SSH_KEY,undefined);
  assert.doesNotMatch(step.run,/source\/scripts\/(?:ensure-skills-source|skills-source)/);
  assert.match(step.run,jobName==='gate'?/"\$BASE" "\$HEAD"/:/"\$HEAD"/);
 }
});

test('CI缓存拒绝损坏锁、跨profile、非固定SHA及未知版本，不吞读错',()=>{
 const f=fixture();const prior=process.env.SKILLS_SOURCE_SSH_KEY;process.env.SKILLS_SOURCE_SSH_KEY='fixture-only';
 try{
  assert.equal(typeof sourceApi.prepareImplementationSkillCache,'function');
  const lock=JSON.parse(git(f.business,'show',`${f.after}:.skills-source.json`));
  for(const patch of [{profile:'cecelia'},{revision:'main'},{loader_sha256:'bad'},{repository:'evil/repo'},{extra:true}]){
   writeFileSync(join(f.business,'.skills-source.json'),JSON.stringify({...lock,...patch}));const revision=commit(f.business);
   assert.throws(()=>sourceApi.prepareImplementationSkillCache(f.business,'perfectuser21/zenithjoy-workspace',[revision],{fetchSource:()=>{throw Error('MUST_NOT_FETCH');}}),/LOCK|PROFILE/);
  }
  assert.throws(()=>sourceApi.prepareImplementationSkillCache(f.business,'perfectuser21/zenithjoy-workspace',['0'.repeat(40)]));
 }finally{if(prior===undefined)delete process.env.SKILLS_SOURCE_SSH_KEY;else process.env.SKILLS_SOURCE_SSH_KEY=prior;f.cleanup();}
});
test('Impact自举只接受精确旧185本仓原生PR，其余缺prepare或身份不符绝不假绿',()=>{
 const w=yaml.load(readFileSync(new URL('../../../.github/workflows/implementation-impact.yml',import.meta.url),'utf8'));
 const step=w.jobs.gate.steps.find(s=>s.name==='准备固定中央Skill对象缓存');assert.ok(step);
 const root=mkdtempSync(join(tmpdir(),'cache-workflow-step-')),bin=join(root,'bin'),legacy='18552f8eeafdb2d404294bd6601bc74d00a1d422';mkdirSync(bin);
 try{
  writeFileSync(join(bin,'git'),'#!/bin/sh\nprintf "%s\\n" "$ACTUAL_TOOLING"\n',{mode:0o700});
  writeFileSync(join(bin,'node'),'#!/bin/sh\nexit 0\n',{mode:0o700}); // old helper missing prepare mode: exit0+empty stdout must reject
  const run=patch=>spawnSync('bash',['-c',step.run],{cwd:root,encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH,GITHUB_WORKSPACE:root,RUNNER_TEMP:root,GITHUB_ENV:join(root,'env'),GITHUB_OUTPUT:join(root,'output'),GITHUB_REPOSITORY:'perfectuser21/cecelia',GITHUB_EVENT_NAME:'pull_request',SOURCE_REPO:'perfectuser21/cecelia',NATIVE_PR:'true',MAP_SCOPE:'cecelia-kr',ADMISSION_SCOPES:'{"schema_version":1,"scopes":["cecelia-kr","cecelia-factory"]}',MODE:'pr',BASE:legacy,HEAD:'a'.repeat(40),TOOLING_REVISION:legacy,ACTUAL_TOOLING:legacy,...patch}});
  assert.equal(run({}).status,0);
  for(const patch of [{TOOLING_REVISION:'b'.repeat(40),ACTUAL_TOOLING:'b'.repeat(40)},{GITHUB_EVENT_NAME:'push',MODE:'main'},{SOURCE_REPO:'perfectuser21/zenithjoy-workspace'},{GITHUB_REPOSITORY:'perfectuser21/zenithjoy-workspace'},{ACTUAL_TOOLING:'c'.repeat(40)},{BASE:'b'.repeat(40)},{NATIVE_PR:'false'},{MAP_SCOPE:'other'},{ADMISSION_SCOPES:'{"schema_version":1,"scopes":["cecelia-kr"]}'}])assert.notEqual(run(patch).status,0,JSON.stringify(patch));
 }finally{rmSync(root,{recursive:true,force:true});}
});
