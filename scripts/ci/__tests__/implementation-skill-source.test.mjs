import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {pilotPlanHash} from '../../../packages/brain/src/lib/pilot-release-verification.js';
import * as patrol from '../../../packages/brain/src/lib/device-patrol-admission.js';
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
test('Pilot与Impact使用trusted tooling准备隔离缓存，secret只进准备step且下载后校验前',()=>{
 for(const [name,jobName,consume] of [['pilot-release-verification','verify','固定完整计划及白名单环境运行全部登记回归'],['implementation-impact','gate','实际变更影响与固定回归']]){
  const w=yaml.load(readFileSync(new URL('../../../.github/workflows/'+name+'.yml',import.meta.url),'utf8'));
  assert.deepEqual(w.on.workflow_call.secrets.SKILLS_SOURCE_SSH_KEY,{required:false});
  assert.equal(w.jobs[jobName].env.SOURCE_REPO,'${{ inputs.source_repo || github.repository }}','prepare读取的SOURCE_REPO必须由实际job显式绑定');
  const steps=w.jobs[jobName].steps,index=steps.findIndex(s=>s.name==='准备固定中央Skill对象缓存');assert.ok(index>0);
  const step=steps[index];assert.equal(step.env.SKILLS_SOURCE_SSH_KEY,'${{ secrets.SKILLS_SOURCE_SSH_KEY }}');
  assert.match(step.run,/implementation-skill-source\.mjs/);assert.match(step.run,/--prepare-ci-cache/);
  assert.match(step.run,/"\$GITHUB_WORKSPACE\/source"/);assert.match(step.run,/"\$SOURCE_REPO"/);
  assert.ok(index>steps.findIndex(s=>s.with?.path==='source'));assert.ok(index<steps.findIndex(s=>s.name===consume));
  const download=steps.findIndex(s=>s.uses?.startsWith('actions/download-artifact')||s.name==='下载固定SHA中央bundle（PR无中央写凭据）');assert.ok(index>download);
  if(jobName==='gate')assert.match(steps.find(s=>s.name===consume).env?.SKILLS_SOURCE_SSH_KEY||'',/steps\.skill-cache\.outputs\.legacy_821/);else assert.equal(steps.find(s=>s.name===consume).env?.SKILLS_SOURCE_SSH_KEY,undefined);
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
for(const legacy of ['821dac5ae926cd5120d7b94fcd8012dd1f09bc23','b977d068919ff699318581214ddb07c314629e56'])test(`Impact自举只接受精确${legacy}本仓原生PR，其余缺prepare或身份不符绝不假绿`,()=>{
 const w=yaml.load(readFileSync(new URL('../../../.github/workflows/implementation-impact.yml',import.meta.url),'utf8'));
 const step=w.jobs.gate.steps.find(s=>s.name==='准备固定中央Skill对象缓存');assert.ok(step);
 const root=mkdtempSync(join(tmpdir(),'cache-workflow-step-')),bin=join(root,'bin');mkdirSync(bin);
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
  const workspace=dirname(f.business);symlinkSync(f.business,join(workspace,'source'));symlinkSync(new URL('../../../',import.meta.url).pathname,join(workspace,'tooling'));mkdirSync(join(workspace,'snapshot'));
  writeFileSync(join(workspace,'snapshot/head.json'),JSON.stringify({snapshot:historicalSnapshot(f,head,head,JSON.parse(git(f.business,'show',`${head}:.skills-source.json`)).revision)}));
  const pilotWorkflow=yaml.load(readFileSync(new URL('../../../.github/workflows/pilot-release-verification.yml',import.meta.url),'utf8')),step=pilotWorkflow.jobs.verify.steps.find(s=>s.name==='准备固定中央Skill对象缓存');
  const prepared=spawnSync('bash',['-c',step.run],{cwd:workspace,encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH,SKILLS_SOURCE_SSH_KEY:'fixture-secret',RUNNER_TEMP:workspace,GITHUB_WORKSPACE:workspace,GITHUB_ENV:join(workspace,'env'),SOURCE_REPO:'perfectuser21/zenithjoy-workspace',HEAD:head}});
  assert.equal(prepared.status,0,prepared.stderr);cache=readFileSync(join(workspace,'env'),'utf8').trim().replace(/^IMPLEMENTATION_SKILLS_SOURCE_DIR=/,'');assert.ok(cache.startsWith(workspace+'/implementation-skills-ci-'));
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
function historicalSnapshot(f,head,bindingRevision,central,padding=''){
 const repo='perfectuser21/zenithjoy-workspace',payload={implementation_bindings:[{kind:'skill',status:'verified',scope:'activity',repo,path:f.path,revision:bindingRevision,digest:'sha256:'+createHash('sha256').update(f.payload).digest('hex'),resolved_source:{repo:'perfectuser21/zenithjoy-skills',path:'body.md',revision:central}}]};
 const source={repo,path:'contract.json',commit:head};
 const body={schema_version:1,scope:'zenithjoy',repo,revision:head,status:'verified',gaps:[],definitions:{workflows:[],activities:[{source_repo:repo,source_path:source.path,source_commit:head,payload,payload_sha256:pilotPlanHash({source,payload})}]},evidence_padding:padding};
 return {...body,snapshot_sha256:pilotPlanHash(body)};
}
test('快照冻结的历史Skill版本也进入同一cache，超过1MiB真实形态metadata可读，生成物仅HEAD',()=>{
 const f=fixture(),prior=process.env.SKILLS_SOURCE_SSH_KEY;process.env.SKILLS_SOURCE_SSH_KEY='fixture-only';let cache;
 try{
  const lock=JSON.parse(git(f.business,'show',`${f.after}:.skills-source.json`)),old=lock.revision;
  const next=Buffer.from('current HEAD body\n');writeFileSync(join(f.central,'body.md'),next);
  const catalog=JSON.parse(git(f.central,'show',`${old}:distribution/catalog.json`));catalog.profiles.zenithjoy.files[0].sha256=createHash('sha256').update(next).digest('hex');writeFileSync(join(f.central,'distribution/catalog.json'),JSON.stringify(catalog));lock.revision=commit(f.central);
  writeFileSync(join(f.business,'.skills-source.json'),JSON.stringify(lock));const head=commit(f.business),requested=[];
  const snapshot=historicalSnapshot(f,head,f.after,old,'e'.repeat(1200000));
  cache=sourceApi.prepareImplementationSkillCache(f.business,'perfectuser21/zenithjoy-workspace',[f.before,head],{snapshots:[snapshot],fetchSource:(dir,rev)=>{requested.push(rev);if(!existsSync(join(dir,'.git')))git(f.central,'clone','--no-checkout','--quiet',f.central,dir);}});
  assert.deepEqual(new Set(requested),new Set([old,lock.revision]),'不能仅准备base/head两锁');
  git(cache,'cat-file','-e',old+'^{commit}');sourceApi.materializeImplementationSkills(f.business,head,'perfectuser21/zenithjoy-workspace',cache);assert.deepEqual(readFileSync(join(f.business,f.path)),next);
 }finally{if(cache)rmSync(dirname(cache),{recursive:true,force:true});if(prior===undefined)delete process.env.SKILLS_SOURCE_SSH_KEY;else process.env.SKILLS_SOURCE_SSH_KEY=prior;f.cleanup();}
});
test('历史snapshot拒绝摘要漂移、伪中央身份、缺业务对象、过多版本和metadata预算',()=>{
 const f=fixture(),prior=process.env.SKILLS_SOURCE_SSH_KEY;process.env.SKILLS_SOURCE_SSH_KEY='fixture-only';
 try{
  const central=JSON.parse(git(f.business,'show',`${f.after}:.skills-source.json`)).revision;
  const snapshot=historicalSnapshot(f,f.after,f.after,central);
  for(const mutate of [s=>({...s,snapshot_sha256:'0'.repeat(64)}),s=>{s.definitions.activities[0].payload.implementation_bindings[0].resolved_source.revision='f'.repeat(40);const row=s.definitions.activities[0];row.payload_sha256=pilotPlanHash({source:{repo:row.source_repo,path:row.source_path,commit:row.source_commit},payload:row.payload});const {snapshot_sha256,...b}=s;return {...b,snapshot_sha256:pilotPlanHash(b)};},s=>historicalSnapshot(f,f.after,'f'.repeat(40),central),s=>historicalSnapshot(f,f.after,f.after,central,'x'.repeat(4*1024*1024))]){
   assert.throws(()=>sourceApi.prepareImplementationSkillCache(f.business,'perfectuser21/zenithjoy-workspace',[f.after],{snapshots:[mutate(structuredClone(snapshot))],fetchSource:()=>{throw Error('UNEXPECTED_FETCH');}}),/SNAPSHOT|BINDING|FIXED|OBJECT|BYTE/);
  }
  assert.throws(()=>sourceApi.prepareImplementationSkillCache(f.business,'perfectuser21/zenithjoy-workspace',[f.after],{snapshots:Array(9).fill(snapshot)}),/SNAPSHOT.*LIMIT/);
  const many=structuredClone(snapshot),row=many.definitions.activities[0];row.payload.implementation_bindings=Array.from({length:17},(_,i)=>({kind:'code',repo:'perfectuser21/zenithjoy-workspace',revision:i.toString(16).padStart(40,'0'),path:'contract.json'}));
  row.payload_sha256=pilotPlanHash({source:{repo:row.source_repo,path:row.source_path,commit:row.source_commit},payload:row.payload});const {snapshot_sha256,...body}=many;
  assert.throws(()=>sourceApi.prepareImplementationSkillCache(f.business,'perfectuser21/zenithjoy-workspace',[f.after],{snapshots:[{...body,snapshot_sha256:pilotPlanHash(body)}]}),/VERSION_LIMIT/);
 }finally{if(prior===undefined)delete process.env.SKILLS_SOURCE_SSH_KEY;else process.env.SKILLS_SOURCE_SSH_KEY=prior;f.cleanup();}
});
test('两入口先下载canonical快照再prepare历史对象，现代校验无key',()=>{
 for(const [file,job]of [['pilot-release-verification','verify'],['implementation-impact','gate']]){
  const w=yaml.load(readFileSync(new URL('../../../.github/workflows/'+file+'.yml',import.meta.url),'utf8')),steps=w.jobs[job].steps;
  const index=steps.findIndex(s=>s.name==='准备固定中央Skill对象缓存'),download=steps.findIndex(s=>s.uses?.startsWith('actions/download-artifact')||s.name==='下载固定SHA中央bundle（PR无中央写凭据）');
  assert.ok(index>download,'历史绑定必须先取得snapshot');assert.match(steps[index].run,/--snapshot/);
  assert.match(steps[index].run,/jq -e '\.snapshot \| select\(type=="object"\)'/,'官方API包装需先提取canonical');
  assert.match(steps[index].run,/canonical/);
 }
});
test('唯一旧兼容升级为821真实可信reader冷启动，而非185空缓存放行',()=>{
 const w=yaml.load(readFileSync(new URL('../../../.github/workflows/implementation-impact.yml',import.meta.url),'utf8'));
 const step=w.jobs.gate.steps.find(s=>s.name==='准备固定中央Skill对象缓存');
 assert.match(step.run,/821dac5ae926cd5120d7b94fcd8012dd1f09bc23/);
 assert.match(step.run,/b8985542133fb7dcf87a2adf9151de43d0694185/,'精确已发布同字节main必须可冷启动');
 assert.match(step.run,/a72ff8372d4eb2100e1b9b7572d88a22969bef2f/,'实际新发布同reader与锁的main必须可冷启动');
 assert.match(step.run,/b977d068919ff699318581214ddb07c314629e56/,'正式cleanup main同helper/锁也必须精确冷启动');
 assert.match(step.run,/readImplementationSource/);assert.match(step.run,/packages\/engine\/skills\/dev\/SKILL\.md/);
 assert.doesNotMatch(step.run,/18552f8eeafdb2d404294bd6601bc74d00a1d422/);
});
for(const legacy of ['b8985542133fb7dcf87a2adf9151de43d0694185','a72ff8372d4eb2100e1b9b7572d88a22969bef2f','b977d068919ff699318581214ddb07c314629e56'])test(`已发布同字节版本${legacy}实际执行可信reader冷fetch，锁漂移/既存cache拒绝且不运行candidate loader`,()=>{
 const f=fixture(),workspace=dirname(f.business),tooling=join(workspace,'tooling'),bin=join(workspace,'bin');
 try{
  symlinkSync(f.business,join(workspace,'source'));mkdirSync(tooling);git(tooling,'init','-q');git(tooling,'config','core.hooksPath','/dev/null');mkdirSync(bin);
  const catalog=JSON.parse(git(f.central,'show','HEAD:distribution/catalog.json'));catalog.profiles.cecelia={files:[{...catalog.profiles.zenithjoy.files[0],path:'packages/engine/skills/dev/SKILL.md'}]};writeFileSync(join(f.central,'distribution/catalog.json'),JSON.stringify(catalog));
  const lock={...JSON.parse(git(f.business,'show',`${f.after}:.skills-source.json`)),profile:'cecelia',revision:commit(f.central)};writeFileSync(join(f.business,'.skills-source.json'),JSON.stringify(lock));const head=commit(f.business);git(f.business,'remote','set-url','origin','https://github.com/perfectuser21/cecelia.git');
  writeFileSync(join(tooling,'.skills-source.json'),JSON.stringify(lock));mkdirSync(join(tooling,'scripts/ci'),{recursive:true});
  // The fixture aliases the published Git identity; actual reader/Git/fetch operations remain real.
  for(const file of ['implementation-skill-source.mjs','fixed-local-git.mjs'])writeFileSync(join(tooling,'scripts/ci',file),`export * from ${JSON.stringify(new URL('../'+file,import.meta.url).href)};\n`);
  const trusted=commit(tooling),realGit=execFileSync('which',['git'],{encoding:'utf8'}).trim(),python=execFileSync('python3',['-c','import sys;print(sys.executable)'],{encoding:'utf8'}).trim(),audit=join(workspace,'fetches');
  writeFileSync(join(bin,'git'),`#!${python}
import os,sys,subprocess,pathlib
a=sys.argv[1:];root=a[a.index('-C')+1] if '-C' in a else ''
if root=='tooling' and 'rev-parse' in a: print('${legacy}');sys.exit(0)
revision='${trusted}' if os.path.realpath(root)==os.path.realpath(${JSON.stringify(tooling)}) else '${head}'
a=[x.replace('${legacy}',revision) for x in a]
if 'fetch' in a:
 assert a[-2]=='git@github.com:perfectuser21/zenithjoy-skills.git'
 pathlib.Path(${JSON.stringify(audit)}).write_text('fetch')
 a[-2]=${JSON.stringify(f.central)}
os.execv(${JSON.stringify(realGit)},[${JSON.stringify(realGit)}]+a)
`,{mode:0o700});
  const w=yaml.load(readFileSync(new URL('../../../.github/workflows/implementation-impact.yml',import.meta.url),'utf8')),step=w.jobs.gate.steps.find(s=>s.name==='准备固定中央Skill对象缓存');
  const run=selected=>spawnSync('bash',['-c',step.run],{cwd:workspace,encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH,GITHUB_WORKSPACE:workspace,RUNNER_TEMP:workspace,GITHUB_ENV:join(workspace,'env'),GITHUB_OUTPUT:join(workspace,'output'),GITHUB_REPOSITORY:'perfectuser21/cecelia',GITHUB_EVENT_NAME:'pull_request',SOURCE_REPO:'perfectuser21/cecelia',NATIVE_PR:'true',MAP_SCOPE:'cecelia-kr',ADMISSION_SCOPES:'{"schema_version":1,"scopes":["cecelia-kr","cecelia-factory"]}',MODE:'pr',BASE:legacy,HEAD:selected,TOOLING_REVISION:legacy,SKILLS_SOURCE_SSH_KEY:'fixture-key'}});
  const result=run(head);assert.equal(result.status,0,result.stderr);assert.equal(readFileSync(audit,'utf8'),'fetch');assert.match(readFileSync(join(workspace,'output'),'utf8'),/legacy_821=true/);git(join(f.business,'.skills-source'),'cat-file','-e',lock.revision+'^{commit}');
  rmSync(audit);assert.notEqual(run(head).status,0,'existing cache不能被当可信冷启动');assert.equal(existsSync(audit),false);
  rmSync(join(f.business,'.skills-source'),{recursive:true});writeFileSync(join(f.business,'.skills-source.json'),JSON.stringify({...lock,loader_sha256:'f'.repeat(64)}));const changed=commit(f.business);
  assert.notEqual(run(changed).status,0,'head锁字节漂移必须拒绝');assert.equal(existsSync(audit),false);
 }finally{f.cleanup();}
});
test('device patrol旧reader在显式CI缓存模式只读固定对象，缺对象不fetch且拒绝缓存覆盖',()=>{
 const f=fixture(),bin=join(dirname(f.business),'bin'),marker=join(dirname(f.business),'fetch-attempt');
 try{
  mkdirSync(bin);const realGit=execFileSync('which',['git'],{encoding:'utf8'}).trim();
  writeFileSync(join(bin,'git'),`#!/bin/sh\nfor arg in "$@"; do if [ "$arg" = fetch ]; then touch '${marker}'; exit 77; fi; done\nexec '${realGit}' "$@"\n`,{mode:0o700});
  const module=new URL('../implementation-skill-source.mjs',import.meta.url).href;
  const run=(cache,source)=>spawnSync(process.execPath,['--input-type=module','-e',`import{readImplementationSource}from ${JSON.stringify(module)};try{process.stdout.write(readImplementationSource(${JSON.stringify(f.business)},${JSON.stringify(f.after)},${JSON.stringify(f.path)},${source?JSON.stringify({source}):'{}'}));}catch(e){process.stderr.write(e.message);process.exitCode=1;}`],{encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH,IMPLEMENTATION_SKILLS_SOURCE_DIR:cache,SKILLS_SOURCE_SSH_KEY:''}});
  const ready=run(f.central);assert.equal(ready.status,0,ready.stderr);assert.equal(ready.stdout,f.payload.toString());assert.equal(existsSync(marker),false);
  const empty=join(dirname(f.business),'empty-cache');mkdirSync(empty);git(empty,'init','-q');
  assert.notEqual(run(empty).status,0);assert.equal(existsSync(marker),false,'缺对象绝不重新私有fetch');
  assert.notEqual(run('relative-cache').status,0);assert.equal(existsSync(marker),false);
  assert.notEqual(run(f.central,empty).status,0,'调用方不能覆盖显式CI缓存');assert.equal(existsSync(marker),false);
 }finally{f.cleanup();}
});
test('巡查专用已登记快照准备introduced历史锁，其他缺definitions及身份篡改拒绝',()=>{
 const f=fixture(),prior=process.env.SKILLS_SOURCE_SSH_KEY;process.env.SKILLS_SOURCE_SSH_KEY='fixture-key';let cache;
 try{
  const contract={schema_version:1,scope:patrol.PATROL_SCOPE,capability_id:patrol.PATROL_CAPABILITY,workflows:[['66fe22f5-1a60-4e23-bcfb-7b4df2f0fbff','single-phone-account-patrol','d51eefa1-0ffd-43d7-94ba-16ff6b4d3800'],['7dfd3b5d-bc5a-4d96-b744-10d26bc7eb70','phone-account-patrol-batch','b33c9f29-5c5f-4fb1-908c-475bb9566085']].map(([id,key,activity])=>({id,key,activities:[{id:activity,key:'readiness',bindings:['scripts/phone-account-patrol/preflight.py'],assertion_ref:patrol.PATROL_ASSERTION}]})),auxiliary_paths:[patrol.PATROL_PATH],maintenance_owner:'主理人',schedule:{time:'22:00',timezone:'Asia/Shanghai'}};
  writeFileSync(join(f.business,patrol.PATROL_PATH),JSON.stringify(contract));writeFileSync(join(f.business,'scripts/phone-account-patrol/preflight.py'),'READY=True\n');const introduced=commit(f.business),old=JSON.parse(git(f.business,'show',`${introduced}:.skills-source.json`)).revision;
  const source=patrol.patrolSourceProof(contract,introduced,path=>Buffer.from(git(f.business,'show',`${introduced}:${path}`)));
  const registration={provenance:{base_revision:f.before,introduced_revision:introduced,base_tree_sha:git(f.business,'rev-parse',`${f.before}^{tree}`),base_paths:['README.md'],introduced_paths:[patrol.PATROL_PATH],compare_status:'ahead',actor:'fixture'},source};
  writeFileSync(join(f.central,'next.txt'),'new HEAD central');const next=commit(f.central),lock=JSON.parse(git(f.business,'show',`${introduced}:.skills-source.json`));lock.revision=next;writeFileSync(join(f.business,'.skills-source.json'),JSON.stringify(lock));const head=commit(f.business);
  const body={schema_version:1,scope:patrol.PATROL_SCOPE,repo:patrol.PATROL_REPO,purpose:'scope_identity_bootstrap_only',revision_basis:'requested_ci_input_not_source_attestation',status:'verified',gaps:[],revision:f.before,registration,registration_sha256:patrol.sha(JSON.stringify(patrol.canonical(registration)))},snapshot={...body,snapshot_sha256:patrol.sha(JSON.stringify(patrol.canonical(body)))},requested=[];
  patrol.validatePatrolSnapshot(snapshot);
  cache=sourceApi.prepareImplementationSkillCache(f.business,patrol.PATROL_REPO,[f.after,head],{snapshots:[snapshot],fetchSource:(dir,rev)=>{requested.push(rev);if(!existsSync(join(dir,'.git')))git(f.central,'clone','--quiet','--no-checkout',f.central,dir);}});
  assert.deepEqual(new Set(requested),new Set([old,next]));
  for(const change of [{scope:'zenithjoy'},{repo:'perfectuser21/cecelia'},{registration:{...registration,provenance:{...registration.provenance,introduced_revision:'main'}}}])assert.throws(()=>sourceApi.prepareImplementationSkillCache(f.business,patrol.PATROL_REPO,[f.after,head],{snapshots:[{...snapshot,...change}]}));
 }finally{if(cache)rmSync(dirname(cache),{recursive:true,force:true});if(prior===undefined)delete process.env.SKILLS_SOURCE_SSH_KEY;else process.env.SKILLS_SOURCE_SSH_KEY=prior;f.cleanup();}
});
test('materialize最后mkdir耗尽共享deadline后不得写文件或返回成功',()=>{
 const f=fixture(),mkdir=fs.mkdirSync,now=Date.now;let clock=100000;
 try{
  Date.now=()=>clock;fs.mkdirSync=(...args)=>{const result=mkdir(...args);clock+=60001;return result;};syncBuiltinESMExports();
  assert.throws(()=>sourceApi.materializeImplementationSkills(f.business,f.after,'perfectuser21/zenithjoy-workspace',f.central),/TIMEOUT/);
  assert.equal(existsSync(join(f.business,f.path)),false);
 }finally{fs.mkdirSync=mkdir;Date.now=now;syncBuiltinESMExports();f.cleanup();}
});
