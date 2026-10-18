import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readImplementationSource} from '../implementation-skill-source.mjs';
import * as sourceApi from '../implementation-skill-source.mjs';
import {createFixedLocalSourceReader,readFixedLocalGitBlob} from '../fixed-local-git.mjs';
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
 const catalog={version:1,profiles:{zenithjoy:{files:[{path,source:'body.md',sha256:createHash('sha256').update(payload).digest('hex')}]}}};
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
  lock.profile='zenithjoy';const catalog={version:1,profiles:{zenithjoy:{files:[{path:f.path,source:'body.md',sha256:'0'.repeat(64)}]}}};
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
  const catalog={version:1,profiles:{cecelia:{files:[{path:f.path,source:'body.md',sha256:createHash('sha256').update(f.payload).digest('hex')}]}}};
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
 }finally{if(cache)rmSync(dirname(cache),{recursive:true,force:true});if(prior!==undefined)process.env.SKILLS_SOURCE_SSH_KEY=prior;f.cleanup();}
});
test('fresh私有cache容纳base/head两份锁：不运行候选loader，不信source目录缓存或可变HEAD',()=>{
 const f=fixture();let cache;const previous=process.env.SKILLS_SOURCE_SSH_KEY;process.env.SKILLS_SOURCE_SSH_KEY='fixture-only';
 try{
  assert.equal(typeof sourceApi.prepareImplementationSkillCache,'function');
  const repo='perfectuser21/zenithjoy-workspace',lock=JSON.parse(git(f.business,'show',`${f.after}:.skills-source.json`)),first=lock.revision;
  writeFileSync(join(f.central,'new.txt'),'next revision');lock.revision=commit(f.central);
  writeFileSync(join(f.business,'.skills-source.json'),JSON.stringify(lock));const head=commit(f.business),requested=[];
  cache=sourceApi.prepareImplementationSkillCache(f.business,repo,[f.after,head],{fetchSource:(dir,revision)=>{
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
 }finally{if(cache)rmSync(dirname(cache),{recursive:true,force:true});if(previous===undefined)delete process.env.SKILLS_SOURCE_SSH_KEY;else process.env.SKILLS_SOURCE_SSH_KEY=previous;f.cleanup();}
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

test('可信materialize只恢复固定catalog数据，不运行loader，不覆盖tracked或symlink',()=>{
 const f=fixture();
 try{
  assert.equal(typeof sourceApi.materializeImplementationSkills,'function');
  sourceApi.materializeImplementationSkills(f.business,f.after,'perfectuser21/zenithjoy-workspace',f.central);
  assert.deepEqual(readFileSync(join(f.business,f.path)),f.payload);
  assert.equal(readFileSync(join(f.business,'scripts/skills-source.py'),'utf8'),"raise Exception('CANDIDATE_MUST_NOT_EXECUTE')\n");
  writeFileSync(join(f.business,f.path),'corrupt generated file');
  assert.throws(()=>sourceApi.materializeImplementationSkills(f.business,f.after,'perfectuser21/zenithjoy-workspace',f.central),/MATERIALIZE/);
 }finally{f.cleanup();}
});
test('materialize拒绝真实symlink、tracked冲突、越界catalog及有界文件数且不写部分数据',()=>{
 for(const attack of ['symlink','tracked','escape','git-path','duplicate','checksum','file-count']){
  const f=fixture();
  try{
   let head=f.after;
   if(attack==='symlink'){rmSync(join(f.business,'scripts/phone-account-patrol'),{recursive:true});symlinkSync(f.central,join(f.business,'scripts/phone-account-patrol'));}
   else if(attack==='tracked'){writeFileSync(join(f.business,f.path),'tracked business bytes');head=commit(f.business);}
   else{
    const catalog=JSON.parse(git(f.central,'show',`${git(f.central,'rev-parse','HEAD')}:distribution/catalog.json`));
    const entry=catalog.profiles.zenithjoy.files[0];
    if(attack==='escape')entry.path='../outside';
    if(attack==='git-path')entry.path='.git/config';
    if(attack==='duplicate')catalog.profiles.zenithjoy.files.push({...entry});
    if(attack==='checksum')entry.sha256='0'.repeat(64);
    if(attack==='file-count')catalog.profiles.zenithjoy.files=Array.from({length:201},(_,i)=>({...entry,path:'generated/'+i}));
    writeFileSync(join(f.central,'distribution/catalog.json'),JSON.stringify(catalog));
    const lock=JSON.parse(git(f.business,'show',`${f.after}:.skills-source.json`));lock.revision=commit(f.central);
    writeFileSync(join(f.business,'.skills-source.json'),JSON.stringify(lock));head=commit(f.business);
   }
   assert.throws(()=>sourceApi.materializeImplementationSkills(f.business,head,'perfectuser21/zenithjoy-workspace',f.central),/MATERIALIZE/,attack);
   assert.equal(existsSync(join(f.business,'generated')),false);
   if(attack==='tracked')assert.equal(readFileSync(join(f.business,f.path),'utf8'),'tracked business bytes');
   if(attack==='duplicate')assert.equal(existsSync(join(f.business,f.path)),false,'全部验证完才写文件');
  }finally{f.cleanup();}
 }
});
test('共享materialize截止时间已耗尽时Git读取立即拒绝而非重置每次预算',()=>{
 const f=fixture();try{
  assert.throws(()=>readFixedLocalGitBlob(f.business,{revision:f.before,path:f.path},{deadline:Date.now()-1}),/READ_TIMEOUT/);
 }finally{f.cleanup();}
});
test('真实准备CLI→fresh缓存→白名单Skill→离线Pilot登记回归，不向候选传key',async()=>{
 const f=fixture(),bin=join(dirname(f.business),'bin'),audit=join(dirname(f.business),'fetch-audit.json');let cache;
 const priorCache=process.env.IMPLEMENTATION_SKILLS_SOURCE_DIR,priorKey=process.env.SKILLS_SOURCE_SSH_KEY,priorFetch=globalThis.fetch;
 try{
  mkdirSync(bin);const realGit=execFileSync('which',['git'],{encoding:'utf8'}).trim();
  const python=execFileSync('python3',['-c','import sys;print(sys.executable)'],{encoding:'utf8'}).trim();
  writeFileSync(join(bin,'git'),`#!${python}
import json,os,pathlib,shlex,stat,subprocess,sys
args=sys.argv[1:]
if 'fetch' in args:
 assert args[-2]=='git@github.com:perfectuser21/zenithjoy-skills.git'
 assert 'SKILLS_SOURCE_SSH_KEY' not in os.environ
 ssh=shlex.split(os.environ['GIT_SSH_COMMAND']);key=ssh[ssh.index('-i')+1]
 assert stat.S_IMODE(pathlib.Path(key).stat().st_mode)==0o600
 assert pathlib.Path(key).read_text()=='fixture-secret\\n'
 pathlib.Path(${JSON.stringify(audit)}).write_text(json.dumps({'key_path':key,'revision':args[-1]}))
 root=args[args.index('-C')+1]
 sys.exit(subprocess.run([${JSON.stringify(realGit)},'-C',root,'fetch','--quiet','--depth=1',${JSON.stringify(f.central)},args[-1]]).returncode)
os.execv(${JSON.stringify(realGit)},[${JSON.stringify(realGit)}]+args)
`,{mode:0o700});
  const smoke='scripts/smoke/pilot.sh';mkdirSync(join(f.business,'scripts/smoke'));
  writeFileSync(join(f.business,smoke),`#!/bin/bash\nset -eu\ntest -z "\${SKILLS_SOURCE_SSH_KEY:-}"\ntest -n "\${SKILLS_SOURCE_DIR:-}"\ntest -f '${f.path}'\ngit -C "$SKILLS_SOURCE_DIR" cat-file -e "${JSON.parse(git(f.business,'show',`${f.after}:.skills-source.json`)).revision}^{commit}"\n`);
  const head=commit(f.business);git(f.business,'update-ref','refs/remotes/origin/main',head);
  const prepared=spawnSync(process.execPath,[new URL('../implementation-skill-source.mjs',import.meta.url).pathname,'--prepare-ci-cache',f.business,'perfectuser21/zenithjoy-workspace',f.before,head],{encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH,SKILLS_SOURCE_SSH_KEY:'fixture-secret',RUNNER_TEMP:dirname(f.business)}});
  assert.equal(prepared.status,0,prepared.stderr);cache=prepared.stdout.trim();assert.ok(cache.startsWith(dirname(f.business)+'/implementation-skills-ci-'));
  assert.deepEqual(readFileSync(join(f.business,f.path)),f.payload);
  assert.equal(existsSync(JSON.parse(readFileSync(audit)).key_path),false,'fetch后必须删除0600私钥');
  delete process.env.SKILLS_SOURCE_SSH_KEY;process.env.IMPLEMENTATION_SKILLS_SOURCE_DIR=cache;
  globalThis.fetch=()=>{throw Error('NETWORK_MUST_NOT_BE_USED_AFTER_PREPARE');};
  const {runPilotReleaseVerification}=await import('../pilot-release-verification.mjs'),{pilotPlanHash}=await import('../../../packages/brain/src/lib/pilot-release-verification.js');
  const repo='perfectuser21/zenithjoy-workspace',id=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`,central=JSON.parse(git(f.business,'show',`${head}:.skills-source.json`)).revision;
  const row=(n,payload,identity)=>{const source={repo,path:'contract.json',commit:head};return {id:id(n),...identity,source_repo:repo,source_path:source.path,source_commit:head,payload,payload_sha256:pilotPlanHash({source,payload})};};
  const activity=row(2,{activity_id:id(3),steps:[{step_id:id(4),locator:{activity_id:id(3),step_key:'verify'}}],implementation_bindings:[{kind:'skill',scope:'activity',status:'verified',repo,path:f.path,revision:head,digest:'sha256:'+createHash('sha256').update(f.payload).digest('hex'),resolved_source:{repo:'perfectuser21/zenithjoy-skills',path:'body.md',revision:central}}]},{activity_id:id(3)});
  const workflow=row(1,{workflow_id:id(5),capability_id:id(6),activities:[{reference_id:id(7),activity_id:id(3),activity_version_id:id(2)}]},{workflow_id:id(5)});
  const body={schema_version:1,scope:'zenithjoy',repo,revision:head,status:'verified',gaps:[],definitions:{workflows:[workflow],activities:[activity]},assertions:[null,id(4)].map((step,i)=>({id:id(10+i),journey_id:id(6),step_id:id(3),step_id_ref:step,cell_kind:'scenario',cell_key:`regression:${id(6)}:${step||'activity'}`,assertion_ref:smoke,assertion_revision:1}))};
  const result=await runPilotReleaseVerification({repoRoot:f.business,snapshot:{...body,snapshot_sha256:pilotPlanHash(body)},outputDir:join(f.business,'output'),event:'push',ref:'refs/heads/main'});
  assert.equal(result.receipt.verdict,'PASS');
 }finally{
  globalThis.fetch=priorFetch;if(priorCache===undefined)delete process.env.IMPLEMENTATION_SKILLS_SOURCE_DIR;else process.env.IMPLEMENTATION_SKILLS_SOURCE_DIR=priorCache;
  if(priorKey===undefined)delete process.env.SKILLS_SOURCE_SSH_KEY;else process.env.SKILLS_SOURCE_SSH_KEY=priorKey;
  if(cache)rmSync(dirname(cache),{recursive:true,force:true});f.cleanup();
 }
});
