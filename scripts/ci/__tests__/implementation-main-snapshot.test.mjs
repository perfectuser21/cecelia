import {bundle} from './fixtures/admission-bundle.mjs';
import './implementation-pr-baseline.test.mjs';
import {runRegisteredAssertions} from '../implementation-gate.mjs';
import './brain-source-only-deploy.test.mjs';
import './fixed-local-source.test.mjs';
import './fixed-local-git.test.mjs';
import './implementation-source-ready.test.mjs';
import './factory-workflow-config-source.test.mjs';
import {test} from 'node:test';
import {runImplementationMainGate} from '../implementation-main-gate.mjs';
import {readNativeConsumerRuntime} from '../../../packages/brain/src/lib/native-consumer-runtime.js';
import {sealRecoveryBundle,publishRecoveryBaseline,recoveryRuntimeAt} from '../implementation-source-recovery.mjs';
import {publishMainSnapshots} from '../implementation-main-snapshot.mjs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn,execFileSync} from 'node:child_process';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,mkdirSync,symlinkSync,rmSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import yaml from 'js-yaml';
import {stepSha256} from '../../../packages/brain/scripts/sync-steps-from-workspace.mjs';
import {validateImplementationSnapshot,extractImplementationAdmissionSnapshots} from '../../../packages/brain/src/lib/implementation-ci-snapshot.js';
const root=fileURLToPath(new URL('../../../',import.meta.url));
test('双业务 SHA 的正式 Pilot CLI 各按固定中央 SHA 验证',()=>{
 const script=join(root,'packages/brain/scripts/smoke/central-skill-fixed-source-smoke.sh');
 const result=spawnSync('bash',[script,'--scenario','two-revisions'],{cwd:root,encoding:'utf8',env:{...process.env,SMOKE_ALLOW_WRITE:'1'}});
 assert.equal(result.status,0,result.stderr);
 assert.match(result.stdout,/two-revisions: PASS \(2 CLI runs\)/);
});
const repo='perfectuser21/cecelia',head='a'.repeat(40),base='b'.repeat(40);
const seal=(body,key='snapshot_sha256')=>({...body,[key]:stepSha256(body)});
const workflow=()=>yaml.load(readFileSync(join(root,'.github/workflows/implementation-impact.yml'),'utf8'));
async function executeProvider(t,{initial={},refresh={},after={},moved=false,getError=false,mutateFinal=null,baseUnknown=false,artifact={},baseEqualsHead=false,movedAfterPost=false,moveOnPostNumber=0,sourceRecovery=false}={}){
 const dir=mkdtempSync(join(tmpdir(),'implementation-publish-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 mkdirSync(join(dir,'bin'));symlinkSync(root,join(dir,'tooling'),'dir');
 const history=artifact.errorBody?{error:{code:'MAP_MANIFEST_ACTIVE_CONFLICT'}}:bundle(base,{childMissing:true});
 writeFileSync(join(dir,'history.json'),JSON.stringify(history));
 execFileSync('python3',['-c','import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],"w"); z.write(sys.argv[2],"head.json"); z.close()',join(dir,'history.zip'),join(dir,'history.json')]);
 writeFileSync(join(dir,'older-error.json'),JSON.stringify({error:{code:'MAP_MANIFEST_ACTIVE_CONFLICT'}}));
 execFileSync('python3',['-c','import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],"w"); z.write(sys.argv[2],"head.json"); z.close()',join(dir,'older-error.zip'),join(dir,'older-error.json')]);
 writeFileSync(join(dir,'artifact-config.json'),JSON.stringify(artifact));
 writeFileSync(join(dir,'main-sha'),moved?'c'.repeat(40):head);
 writeFileSync(join(dir,'bin/gh'),`#!/usr/bin/env node
const fs=require('fs'),p=process.argv[3],cfg=JSON.parse(fs.readFileSync('${dir}/artifact-config.json'));fs.appendFileSync('${dir}/gh-calls.jsonl',JSON.stringify(process.argv.slice(2))+'\\n');
const item={id:1,name:'implementation-snapshot-${base}',expired:false,created_at:'2026-01-02T00:00:00Z',...cfg.itemPatch,workflow_run:{id:17,head_branch:'main',head_sha:'${base}',repository_id:1,head_repository_id:1}};
const older={...item,id:2,created_at:'2026-01-01T00:00:00Z'};
if(p.endsWith('/commits/main'))console.log(fs.readFileSync('${dir}/main-sha','utf8'));
else if(p.includes('artifacts?'))console.log(JSON.stringify({total_count:cfg.missing?0:cfg.nonmonotonic?2:1,artifacts:cfg.missing?[]:cfg.nonmonotonic?[older,item]:[item]}));
else if(p.endsWith('/zip'))process.stdout.write(fs.readFileSync(cfg.nonmonotonic&&p.includes('/artifacts/2/')?'${dir}/older-error.zip':'${dir}/history.zip'));
else if(p.includes('/artifacts/'))console.log(JSON.stringify(p.endsWith('/2')?older:item));
else if(p.includes('/jobs?'))console.log(JSON.stringify({total_count:1,jobs:[{name:'snapshot-main',status:'completed',conclusion:cfg.failedJob?'failure':'success'}]}));
else if(p.includes('/actions/runs/'))console.log(JSON.stringify({id:17,head_sha:'${base}',head_branch:'main',event:'push',path:'.github/workflows/implementation-impact.yml',conclusion:'failure',repository:{full_name:'${repo}'},head_repository:{full_name:'${repo}'},...cfg.runPatch}));
else process.exit(9);
`,{mode:0o700});
 const calls=[];let stage={...initial},posts=0;
 const server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;const url=new URL(req.url,'http://test');
  const q=req.method==='POST'?JSON.parse(raw):Object.fromEntries(url.searchParams);calls.push({method:req.method,...q});
  let code=200,value;
  if(req.method==='POST'){
   posts++;if(movedAfterPost||posts===moveOnPostNumber)writeFileSync(join(dir,'main-sha'),'c'.repeat(40));const response=refresh[q.scope];code=response?.status??200;
   if(code<300){if(q.scope==='cecelia-kr')stage.parentMissing=false;else stage.childMissing=false;}
   Object.assign(stage,after[q.scope]??{});
   value=response?.body??(q.scope==='cecelia-factory'?{snapshot:bundle(head,stage).snapshot.admission_companion.snapshot}:bundle(head,stage));
  }else if(getError){code=409;value={error:{code:'MAP_MANIFEST_ACTIVE_CONFLICT'}};}
  else {value=bundle(q.revision,q.revision===head?stage:{parentMissing:baseUnknown,childMissing:true});if(mutateFinal&&posts)value=mutateFinal(value,{posts,dir});}
  res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(value));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const step=workflow().jobs['snapshot-main'].steps.find(s=>s.name==='固定main中央定义导出');
 const env={...process.env,SOURCE_BASELINE_RECOVERY:sourceRecovery?'true':'false',PATH:join(dir,'bin')+':'+process.env.PATH,BRAIN_URL:`http://127.0.0.1:${server.address().port}`,CECELIA_INTERNAL_TOKEN:'isolated-test-not-secret',SOURCE_REPO:repo,MAP_SCOPE:'cecelia-kr',BASE:baseEqualsHead?head:base,HEAD:head};
 const result=await new Promise(resolve=>{const child=spawn('bash',['-c',step.run],{cwd:dir,env});let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);child.on('close',code=>resolve({code,stdout,stderr}));});
 return {dir,calls,...result};
}
test('夹具通过正式schema/digest与双scope身份校验',()=>{
 const s=bundle(head).snapshot;assert.equal(validateImplementationSnapshot(s),s);assert.equal(extractImplementationAdmissionSnapshots(s,['cecelia-kr','cecelia-factory']).length,2);
});
test('真实HTTP409响应不能落正式head.json或上传为快照',async t=>{
 const r=await executeProvider(t,{initial:{parentMissing:true,childMissing:true},refresh:{'cecelia-kr':{status:409,body:{error:{code:'MAP_MANIFEST_ACTIVE_CONFLICT'}}}}});
 assert.notEqual(r.code,0);assert.equal(existsSync(join(r.dir,'evidence/head.json')),false,'错误响应不许成为正式artifact');
 assert.ok(existsSync(join(r.dir,'evidence/diagnostics')));
});
test('父verified而companion unknown必须顺序补真实factory来源后发布双scope',async t=>{
 const r=await executeProvider(t,{initial:{childMissing:true}});assert.equal(r.code,0,r.stderr);
 assert.deepEqual(r.calls.filter(c=>c.method==='POST').map(c=>c.scope),['cecelia-factory']);
 const s=JSON.parse(readFileSync(join(r.dir,'evidence/head.json'))).snapshot;assert.equal(extractImplementationAdmissionSnapshots(s,['cecelia-kr','cecelia-factory']).length,2);
});
test('父和factory缺来源时按父后子刷新且最后GET完整bundle',async t=>{
 const r=await executeProvider(t,{initial:{parentMissing:true,childMissing:true}});assert.equal(r.code,0,r.stderr);
 assert.deepEqual(r.calls.filter(c=>c.method==='POST').map(c=>c.scope),['cecelia-kr','cecelia-factory']);assert.equal(r.calls.at(-1).method,'GET');assert.equal(r.calls.at(-1).scope,'cecelia-kr');
});
test('同SHA父CAS409后只复用已验证赢家，再补factory并发布',async t=>{
 const r=await executeProvider(t,{initial:{parentMissing:true,childMissing:true},refresh:{'cecelia-kr':{status:409,body:{error:{code:'MAP_MANIFEST_ACTIVE_CONFLICT'}}}},after:{'cecelia-kr':{parentMissing:false}}});
 assert.equal(r.code,0,r.stderr);assert.equal(r.calls.filter(c=>c.method==='POST'&&c.scope==='cecelia-kr').length,1);
 assert.equal(JSON.parse(readFileSync(join(r.dir,'evidence/head.json'))).snapshot.status,'verified');
});
test('HEAD已非main时不刷新不发布，不改用latest',async t=>{
 const r=await executeProvider(t,{initial:{parentMissing:true,childMissing:true},moved:true});assert.notEqual(r.code,0);assert.equal(r.calls.filter(c=>c.method==='POST').length,0);assert.equal(existsSync(join(r.dir,'evidence/head.json')),false);assert.match(r.stderr,/MAIN_MOVED/);
});
test('refresh MAIN_MOVED冲突不能按CAS赢家吞掉',async t=>{
 const r=await executeProvider(t,{initial:{childMissing:true},refresh:{'cecelia-factory':{status:409,body:{error:{code:'IMPLEMENTATION_CI_MAIN_MOVED'}}}},after:{'cecelia-factory':{childMissing:false}}});assert.notEqual(r.code,0);assert.equal(existsSync(join(r.dir,'evidence/head.json')),false);
});
test('刷新2xx后仍UNKNOWN拒发布',async t=>{
 const r=await executeProvider(t,{initial:{childMissing:true},after:{'cecelia-factory':{childMissing:true}}});assert.notEqual(r.code,0);assert.equal(existsSync(join(r.dir,'evidence/head.json')),false);
});
test('HTTP错误体仅留诊断，GET失败也不能留正式base',async t=>{
 const r=await executeProvider(t,{getError:true});assert.notEqual(r.code,0);assert.equal(existsSync(join(r.dir,'evidence/base.json')),false);assert.equal(existsSync(join(r.dir,'evidence/head.json')),false);
});
test('正式artifact仅成功上传，diagnostic独立always',()=>{
 const steps=workflow().jobs['snapshot-main'].steps,uploads=steps.filter(s=>s.uses?.startsWith('actions/upload-artifact@'));
 for(const kind of ['implementation-snapshot-','implementation-baseline-'])assert.ok(uploads.some(s=>s.with?.name.startsWith(kind)&&s.if==='success()'));
 assert.ok(uploads.some(s=>s.with?.name.startsWith('implementation-snapshot-diagnostics-')&&s.if==='always()'));
});

test('2xx错误对象、摘要篡改和错revision不能成为正式快照',async t=>{
 for(const options of [
  {refresh:{'cecelia-factory':{body:{error:{code:'provider-error'}}}}},
  {mutateFinal:body=>({...body,snapshot:{...body.snapshot,snapshot_sha256:'0'.repeat(64)}})},
  {mutateFinal:()=>bundle('c'.repeat(40))},
 ]){
  const r=await executeProvider(t,{initial:{childMissing:true},...options});assert.notEqual(r.code,0);assert.equal(existsSync(join(r.dir,'evidence/head.json')),false);
 }
});
test('未知409不能假设并发赢家，保留原冲突',async t=>{
 const r=await executeProvider(t,{initial:{childMissing:true},refresh:{'cecelia-factory':{status:409,body:{error:{code:'OPS_REGISTRY_CHANGED'}}}},after:{'cecelia-factory':{childMissing:false}}});assert.notEqual(r.code,0);assert.match(r.stderr,/OPS_REGISTRY_CHANGED/);assert.equal(existsSync(join(r.dir,'evidence/head.json')),false);
});
test('当前完整bundle无refresh，历史base合法unknown companion明确仅父验证',async t=>{
 const r=await executeProvider(t);assert.equal(r.code,0,r.stderr);assert.equal(r.calls.filter(c=>c.method==='POST').length,0);
 const publication=JSON.parse(readFileSync(join(r.dir,'evidence/diagnostics/publication.json')));assert.equal(publication.base_admission,'parent_scope_only');
 assert.equal(JSON.parse(readFileSync(join(r.dir,'evidence/base.json'))).snapshot.admission_companion.snapshot.status,'unknown');
});
test('中央凭据只交可信main工具，候选源码不参与provider执行',()=>{
 const steps=workflow().jobs['snapshot-main'].steps,checkout=steps.find(s=>s.uses?.startsWith('actions/checkout@'));
 assert.equal(checkout.with.repository,repo);assert.equal(checkout.with['persist-credentials'],false);assert.equal(checkout.with.path,'tooling');
 const trusted=steps.findIndex(s=>s.name==='仅可信已发布main工具读取中央凭据'),secret=steps.findIndex(s=>s.env?.CECELIA_INTERNAL_TOKEN);
 assert.ok(trusted>=0&&trusted<secret);assert.match(steps[trusted].run,/git merge-base --is-ancestor HEAD origin\/main/);
 assert.match(steps[secret].run,/node tooling\/scripts\/ci\/implementation-main-snapshot.mjs/);
 assert.ok(steps.some(s=>s.run==='npm ci --ignore-scripts'&&s['working-directory']==='tooling'));
});

async function executeDownload(t,{runPatch={},failedJob=false,errorBody=false,toolingRoot=root}={}){
 const dir=mkdtempSync(join(tmpdir(),'implementation-download-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 mkdirSync(join(dir,'bin'));symlinkSync(toolingRoot,join(dir,'tooling'),'dir');
 const run={id:17,head_sha:base,head_branch:'main',event:'push',path:'.github/workflows/implementation-impact.yml',conclusion:'failure',repository:{full_name:repo},head_repository:{full_name:repo},...runPatch};
 const jobs={total_count:1,jobs:[{name:'snapshot-main',status:'completed',conclusion:failedJob?'failure':'success'}]};
 writeFileSync(join(dir,'run.json'),JSON.stringify(run));writeFileSync(join(dir,'jobs.json'),JSON.stringify(jobs));
 writeFileSync(join(dir,'head.json'),JSON.stringify(errorBody?{error:{code:'MAP_MANIFEST_ACTIVE_CONFLICT'}}:bundle(base)));
 execFileSync('python3',['-c','import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],"w"); z.write(sys.argv[2],"head.json"); z.close()',join(dir,'input.zip'),join(dir,'head.json')]);
 writeFileSync(join(dir,'bin/gh'),`#!/usr/bin/env node
const fs=require('fs'),a=process.argv.slice(2),p=a[1];
if(p.includes('artifacts?'))console.log(JSON.stringify({artifacts:[{id:1,expired:false,created_at:'2026-01-01',workflow_run:{head_branch:'main',head_sha:'${base}',repository_id:1,head_repository_id:1}}]}));
else if(p.endsWith('/zip'))process.stdout.write(fs.readFileSync('${dir}/input.zip'));
else if(p.includes('/artifacts/'))console.log('17');
else if(p.includes('/jobs?'))process.stdout.write(fs.readFileSync('${dir}/jobs.json'));
else if(a.includes('--jq'))console.log('push .github/workflows/implementation-impact.yml');
else process.stdout.write(fs.readFileSync('${dir}/run.json'));
`,{mode:0o700});
 const runStep=workflow().jobs.gate.steps.find(s=>s.name==='下载固定SHA中央bundle（PR无中央写凭据）');
 const env={...process.env,SOURCE_BASELINE_RECOVERY:'false',PATH:join(dir,'bin')+':'+process.env.PATH,RUNNER_TEMP:dir,GITHUB_REPOSITORY:repo,MODE:'pr',MAP_SCOPE:'cecelia-kr',BASE:base,HEAD:head,ADMISSION_SCOPES:JSON.stringify({schema_version:1,scopes:['cecelia-kr','cecelia-factory']})};
 const result=await new Promise(resolve=>{const child=spawn('bash',['-c',runStep.run],{cwd:dir,env});let stderr='';child.stderr.on('data',c=>stderr+=c);child.on('close',code=>resolve({code,stderr}));});return {...result,dir};
}
test('真实consumer shell：provider job成功即可，不要求整个main gate成功',async t=>{
 const r=await executeDownload(t);assert.equal(r.code,0,r.stderr);assert.ok(existsSync(join(r.dir,'implementation-input/base/base-cecelia-factory.json')));
});
test('真实consumer shell：固定SHA/branch/repo/run来源不符保持拒绝',async t=>{
 for(const runPatch of [{head_sha:head},{head_branch:'cp-other'},{id:18},{head_repository:{full_name:'attacker/fork'}},{path:'.github/workflows/ci.yml'}]){
  const r=await executeDownload(t,{runPatch});assert.notEqual(r.code,0);assert.equal(JSON.parse(readFileSync(join(r.dir,'implementation-output/gap.json'))).code,'IMPLEMENTATION_CI_ARTIFACT_ORIGIN_INVALID');
 }
});
test('真实consumer shell：失败provider及历史错误artifact明确归provider失败',async t=>{
 for(const opts of [{failedJob:true},{errorBody:true}]){
  const r=await executeDownload(t,opts);assert.notEqual(r.code,0);assert.equal(JSON.parse(readFileSync(join(r.dir,'implementation-output/gap.json'))).code,'IMPLEMENTATION_CI_SNAPSHOT_PROVIDER_FAILED');
 }
});

// 审查时可对真实固定旧base checkout运行同一consumer测试；CI默认仍跑现行工具。
if(process.env.IMPLEMENTATION_TEST_OLD_TOOLING)test('真实固定旧base不含新helper仍可消费修复后的下载step',async t=>{
 const toolingRoot=process.env.IMPLEMENTATION_TEST_OLD_TOOLING;
 assert.equal(existsSync(join(toolingRoot,'scripts/ci/implementation-main-snapshot.mjs')),false);
 const r=await executeDownload(t,{toolingRoot});assert.equal(r.code,0,r.stderr);
});


test('新main激活后中央旧base UNKNOWN时读取exact-SHA官方artifact，不刷新历史',async t=>{
 const r=await executeProvider(t,{baseUnknown:true});assert.equal(r.code,0,r.stderr);
 assert.equal(JSON.parse(readFileSync(join(r.dir,'evidence/base.json'))).snapshot.revision,base);
 assert.equal(r.calls.some(c=>c.method==='POST'&&c.revision===base),false);
 const ghCalls=readFileSync(join(r.dir,'gh-calls.jsonl'),'utf8');assert.match(ghCalls,new RegExp('implementation-snapshot-'+base));assert.doesNotMatch(ghCalls,/latest/);
});
test('历史artifact必须精确官方run来源和成功provider job，错误体不能充基线',async t=>{
 for(const artifact of [{runPatch:{head_sha:head}},{runPatch:{head_branch:'cp-forged'}},{runPatch:{head_repository:{full_name:'attacker/fork'}}},{runPatch:{path:'.github/workflows/ci.yml'}},{failedJob:true},{errorBody:true},{missing:true}]){
  const r=await executeProvider(t,{baseUnknown:true,artifact});assert.notEqual(r.code,0);
  assert.equal(existsSync(join(r.dir,'evidence/base.json')),false);assert.equal(existsSync(join(r.dir,'evidence/head.json')),false);
  assert.match(r.stderr,/ARTIFACT_ORIGIN_INVALID|SNAPSHOT_PROVIDER_FAILED|BASE_ARTIFACT_MISSING/);
  assert.equal(r.calls.some(c=>c.method==='POST'&&c.revision===base),false);
 }
});
test('真实缺manifest派生unmapped只在同scope缺失且manifest=null时正规刷新',async t=>{
 const gaps=[{code:'scope_manifest_missing'},{code:'workflow_capability_unmapped',workflow_key:'G5'}];
 const r=await executeProvider(t,{initial:{parentMissing:true,parentGaps:gaps,childMissing:true}});assert.equal(r.code,0,r.stderr);
 assert.deepEqual(r.calls.filter(c=>c.method==='POST').map(c=>c.scope),['cecelia-kr','cecelia-factory']);
 for(const initial of [{parentMissing:true,parentGaps:[gaps[1]]},{parentMissing:true,parentGaps:gaps,parentManifest:{id:'existing'}},{parentMissing:true,parentGaps:[...gaps,{code:'unrecognized_gap'}]}]){
  const r=await executeProvider(t,{initial});assert.notEqual(r.code,0);assert.equal(r.calls.filter(c=>c.method==='POST').length,0);assert.equal(existsSync(join(r.dir,'evidence/head.json')),false);
 }
});
test('仅已证实manifest CAS409可复用赢家，其他activity冲突保留原错误',async t=>{
 for(const code of ['ACTIVITY_CONTRACT_SNAPSHOT_CHANGED','IMPLEMENTATION_CI_ACTIVITY_CONTRACT_SNAPSHOT_CHANGED']){
  const r=await executeProvider(t,{initial:{childMissing:true},refresh:{'cecelia-factory':{status:409,body:{error:{code}}}},after:{'cecelia-factory':{childMissing:false}}});
  assert.notEqual(r.code,0);assert.match(r.stderr,new RegExp(code));assert.equal(existsSync(join(r.dir,'evidence/head.json')),false);
 }
});

test('官方dispatch base=head当前缺来源先正规刷新，再同一完整bundle发布两份输入',async t=>{
 const r=await executeProvider(t,{baseEqualsHead:true,initial:{parentMissing:true,childMissing:true}});assert.equal(r.code,0,r.stderr);
 assert.deepEqual(r.calls.filter(c=>c.method==='POST').map(c=>[c.scope,c.revision]),[['cecelia-kr',head],['cecelia-factory',head]]);
 assert.deepEqual(JSON.parse(readFileSync(join(r.dir,'evidence/base.json'))),JSON.parse(readFileSync(join(r.dir,'evidence/head.json'))));
 assert.doesNotMatch(readFileSync(join(r.dir,'gh-calls.jsonl'),'utf8'),/artifacts/);
 const failed=await executeProvider(t,{baseEqualsHead:true,initial:{parentMissing:true,childMissing:true},moved:true});
 assert.notEqual(failed.code,0);assert.equal(failed.calls.some(c=>c.method==='POST'),false);assert.equal(existsSync(join(failed.dir,'evidence/head.json')),false);
 const drift=await executeProvider(t,{baseEqualsHead:true,initial:{parentMissing:true,childMissing:true},movedAfterPost:true});
 assert.notEqual(drift.code,0);assert.match(drift.stderr,/MAIN_MOVED/);assert.equal(drift.calls.filter(c=>c.method==='POST').length,1);assert.equal(existsSync(join(drift.dir,'evidence/base.json')),false);assert.equal(existsSync(join(drift.dir,'evidence/head.json')),false);
});

test('同SHA旧错误artifact ID较大时按创建时间选择较新的有效产物',async t=>{
 const r=await executeProvider(t,{baseUnknown:true,artifact:{nonmonotonic:true}});assert.equal(r.code,0,r.stderr);
 const receipt=JSON.parse(readFileSync(join(r.dir,'evidence/diagnostics/historical-base-source.json')));assert.equal(receipt.artifact_id,1);
 assert.equal(JSON.parse(readFileSync(join(r.dir,'evidence/base.json'))).snapshot.revision,base);
 assert.equal(r.calls.some(c=>c.method==='POST'&&c.revision===base),false);
 const calls=readFileSync(join(r.dir,'gh-calls.jsonl'),'utf8');assert.match(calls,/artifacts\/1\/zip/);assert.doesNotMatch(calls,/artifacts\/2\/zip/);
});
test('历史artifact创建时间缺失或非法不能参与选择',async t=>{
 for(const created_at of [null,'','not-a-date']){
  const r=await executeProvider(t,{baseUnknown:true,artifact:{itemPatch:{created_at}}});assert.notEqual(r.code,0);
  assert.match(r.stderr,/BASE_ARTIFACT_MISSING/);assert.equal(existsSync(join(r.dir,'evidence/base.json')),false);
 }
});

// 真 e7e 回执：父先 verified，factory 200 后旧部署定时器切回父 current。
const regressedParent={parentMissing:true,parentGaps:[{code:'scope_manifest_missing'},{code:'workflow_capability_unmapped'}],parentManifest:null};
const regressionOptions={initial:{childMissing:true},after:{'cecelia-factory':regressedParent}};
test('首轮factory成功后父scope回退，仅额外刷新父scope一次',async t=>{
 const r=await executeProvider(t,regressionOptions);assert.equal(r.code,0,r.stderr);
 assert.deepEqual(r.calls.filter(c=>c.method==='POST').map(c=>c.scope),['cecelia-factory','cecelia-kr']);
 const published=JSON.parse(readFileSync(join(r.dir,'evidence/head.json'))).snapshot;
 assert.equal(published.status,'verified');assert.equal(published.admission_companion.snapshot.status,'verified');
});
test('补偿后再次回退有界失败且无正式文件',async t=>{
 let repairReads=0;
 const r=await executeProvider(t,{...regressionOptions,mutateFinal:(b,{posts})=>posts===2&&++repairReads>1?bundle(head,regressedParent):b});
 assert.notEqual(r.code,0);assert.match(r.stderr,/SNAPSHOT_UNKNOWN/);
 assert.deepEqual(r.calls.filter(c=>c.method==='POST').map(c=>c.scope),['cecelia-factory','cecelia-kr']);
 assert.equal(existsSync(join(r.dir,'evidence/head.json')),false);assert.equal(existsSync(join(r.dir,'evidence/base.json')),false);
});
test('回退缺口不受支持或身份摘要非法时不追加刷新',async t=>{
 const variants=[
  {after:{'cecelia-factory':{...regressedParent,parentGaps:[{code:'unrecognized_gap'}]}}},
  {after:{'cecelia-factory':{...regressedParent,parentGaps:[{code:'workflow_capability_unmapped'}]}}},
  {after:{'cecelia-factory':{...regressedParent,parentManifest:{id:'present'}}}},
  {mutateFinal:b=>({snapshot:seal({...b.snapshot,revision:'c'.repeat(40)})})},
  {mutateFinal:b=>({snapshot:{...b.snapshot,snapshot_sha256:'0'.repeat(64)}})}
 ];
 for(const variant of variants){
  const r=await executeProvider(t,{...regressionOptions,...variant});assert.notEqual(r.code,0);
  assert.deepEqual(r.calls.filter(c=>c.method==='POST').map(c=>c.scope),['cecelia-factory']);
  assert.equal(existsSync(join(r.dir,'evidence/head.json')),false);
 }
});
test('补偿计划前或补偿POST后main漂移拒绝发布',async t=>{
 for(const [variant,count] of [[{mutateFinal:(b,{dir})=>{writeFileSync(join(dir,'main-sha'),'c'.repeat(40));return b;}},1],[{moveOnPostNumber:2},2]]){
  const r=await executeProvider(t,{...regressionOptions,...variant});assert.notEqual(r.code,0);assert.match(r.stderr,/MAIN_MOVED/);
  assert.equal(r.calls.filter(c=>c.method==='POST').length,count);assert.equal(existsSync(join(r.dir,'evidence/head.json')),false);
 }
});
test('补偿POST失败或仍UNKNOWN不可再重试',async t=>{
 for(const variant of [{refresh:{'cecelia-kr':{status:409,body:{error:{code:'UNRELATED_CONFLICT'}}}}},{after:{...regressionOptions.after,'cecelia-kr':regressedParent}}]){
  const r=await executeProvider(t,{...regressionOptions,...variant});assert.notEqual(r.code,0);
  assert.deepEqual(r.calls.filter(c=>c.method==='POST').map(c=>c.scope),['cecelia-factory','cecelia-kr']);
  assert.equal(existsSync(join(r.dir,'evidence/head.json')),false);
 }
});

// 捕捉 publisher 吞掉 transport/readMain 原因而无法判定 POST 是否完成的回归。
for(const scenario of ['fetch-rejection','body-interruption','read-main'])test(`脱敏诊断：${scenario}保留真实阶段且不重试或发布`,async t=>{
 const output=mkdtempSync(join(tmpdir(),'publisher-diagnostics-'));t.after(()=>rmSync(output,{recursive:true,force:true}));
 const secret='sk-private-token-123456789\nhttps://private.invalid/path?token=hidden';
 const error=Object.assign(new TypeError(secret),{code:secret,cause:Object.assign(new Error(secret),{code:'ECONNRESET'})});
 const calls=[];
 await assert.rejects(publishMainSnapshots({brainUrl:'https://private.invalid',token:secret,scope:'cecelia-kr',repo,base:head,head,output},{
  readMain:()=>{if(scenario==='read-main')throw error;return head;},
  fetchFn:async(url,options)=>{
   calls.push(options.method);
   if(options.method==='GET')return new Response(JSON.stringify(bundle(head,{childMissing:true})));
   if(scenario==='fetch-rejection')throw error;
   return {status:200,ok:true,text:async()=>{throw error;}};
  }
 }),e=>e===error);
 const failure=JSON.parse(readFileSync(join(output,'diagnostics/failure.json')));
 assert.ok(failure.operation,'失败文件必须保留可信执行阶段');
 assert.equal(failure.operation.stage,scenario==='read-main'?'read_main':scenario==='fetch-rejection'?'request_fetch':'request_body');
 assert.equal(failure.exception.name,'TypeError');assert.equal(failure.exception.code,null);
 assert.equal(failure.exception.cause.code,'ECONNRESET');
 assert.equal(failure.exception.message_sha256,createHash('sha256').update(secret).digest('hex'));
 assert.equal(failure.exception.message_length,secret.length);
 assert.ok(Number.isFinite(Date.parse(failure.operation.started_at)));assert.ok(Number.isFinite(Date.parse(failure.operation.finished_at)));
 assert.equal(failure.code,'IMPLEMENTATION_CI_PUBLISH_FAILED');
 assert.equal(existsSync(join(output,'base.json')),false);assert.equal(existsSync(join(output,'head.json')),false);
 if(scenario==='read-main')assert.deepEqual(calls,[]);
 else{
  assert.deepEqual(calls,['GET','POST']);assert.equal(failure.operation.method,'POST');
  assert.equal(failure.operation.scope,'cecelia-factory');assert.equal(failure.operation.revision,head);
  assert.equal(failure.operation.fetch_invoked,true);assert.equal(failure.operation.post_outcome,'UNKNOWN');
  assert.equal(failure.operation.response_received,scenario==='body-interruption');
  assert.equal(failure.operation.http_status,scenario==='body-interruption'?200:null);
  assert.equal(failure.operation.body_read_completed,false);
  const attempt=JSON.parse(readFileSync(join(output,'diagnostics/request-2.json')));
  assert.deepEqual(attempt,failure.operation);
 }
 const raw=readFileSync(join(output,'diagnostics/failure.json'),'utf8');
 for(const fragment of [secret,'sk-private','private.invalid','hidden','stack','headers'])assert.equal(raw.includes(fragment),false,fragment);
 assert.ok(raw.length<5000);
});

test('验证失败诊断明确标记快照校验，完整响应不等于正式发布',async t=>{
 const output=mkdtempSync(join(tmpdir(),'publisher-validation-'));t.after(()=>rmSync(output,{recursive:true,force:true}));
 await assert.rejects(publishMainSnapshots({brainUrl:'https://example.invalid',token:'test-token',scope:'cecelia-kr',repo,base:head,head,output},{readMain:()=>head,fetchFn:async()=>new Response(JSON.stringify({snapshot:{}}))}));
 const failure=JSON.parse(readFileSync(join(output,'diagnostics/failure.json')));
 assert.equal(failure.operation.stage,'validate_snapshot');assert.equal(failure.operation.revision,head);assert.equal(failure.operation.scope,'cecelia-kr');
 assert.equal(existsSync(join(output,'head.json')),false);
});

for(const hostile of ['changing-name','throwing-message'])test(`审查R1：${hostile}不能泄密或覆盖原异常`,async t=>{
 const output=mkdtempSync(join(tmpdir(),'publisher-getter-'));t.after(()=>rmSync(output,{recursive:true,force:true}));
 const secret='SYNTHETIC_PRIVATE_SECRET';const original=new Error('original');let reads=0;
 if(hostile==='changing-name')Object.defineProperty(original,'name',{get:()=>++reads===1?'TypeError':secret});
 else Object.defineProperty(original,'message',{get:()=>{throw new Error(secret);}});
 await assert.rejects(publishMainSnapshots({brainUrl:'https://example.invalid',token:'test',scope:'cecelia-kr',repo,base:head,head,output},{readMain:()=>{throw original;},fetchFn:async()=>assert.fail('不应调用fetch')}),e=>e===original);
 assert.ok(existsSync(join(output,'diagnostics/failure.json')));
 const raw=readFileSync(join(output,'diagnostics/failure.json'),'utf8');assert.equal(raw.includes(secret),false);
 if(hostile==='changing-name')assert.equal(reads,1);
});
test('审查R2：finally诊断IO失败不能替换transport原异常',async t=>{
 const output=mkdtempSync(join(tmpdir(),'publisher-io-'));t.after(()=>rmSync(output,{recursive:true,force:true}));const original=new TypeError('fetch failed');
 await assert.rejects(publishMainSnapshots({brainUrl:'https://example.invalid',token:'test',scope:'cecelia-kr',repo,base:head,head,output},{readMain:()=>head,fetchFn:async()=>{
  const path=join(output,'diagnostics/request-1.json');unlinkSync(path);mkdirSync(path);throw original;
 }}),e=>e===original);
 const failure=JSON.parse(readFileSync(join(output,'diagnostics/failure.json')));assert.equal(failure.exception.name,'TypeError');
});
test('审查R3：请求options构造失败时fetch未调用且不发布',async t=>{
 const output=mkdtempSync(join(tmpdir(),'publisher-options-'));t.after(()=>rmSync(output,{recursive:true,force:true}));
 const original=new Error('options failure'),timeout=AbortSignal.timeout;let calls=0;
 try{
  AbortSignal.timeout=()=>{throw original;};
  await assert.rejects(publishMainSnapshots({brainUrl:'https://example.invalid',token:'test',scope:'cecelia-kr',repo,base:head,head,output},{readMain:()=>head,fetchFn:async()=>{calls++;}}),e=>e===original);
 }finally{AbortSignal.timeout=timeout;}
 const failure=JSON.parse(readFileSync(join(output,'diagnostics/failure.json')));assert.equal(calls,0);assert.equal(failure.operation.fetch_invoked,false);assert.equal(existsSync(join(output,'head.json')),false);
});
for(const code of ['IMPLEMENTATION_CI_SNAPSHOT_DIGEST_MISMATCH','OPS_SOURCE_UNKNOWN'])test(`审查R4：保留已知固定码${code}`,async t=>{
 const output=mkdtempSync(join(tmpdir(),'publisher-code-'));t.after(()=>rmSync(output,{recursive:true,force:true}));
 await assert.rejects(publishMainSnapshots({brainUrl:'https://example.invalid',token:'test',scope:'cecelia-kr',repo,base:head,head,output},{readMain:()=>head,fetchFn:async()=>{
  if(code==='OPS_SOURCE_UNKNOWN')return new Response(JSON.stringify({error:{code}}),{status:422});
  const body=bundle(head);body.snapshot.snapshot_sha256='0'.repeat(64);return new Response(JSON.stringify(body));
 }}));
 const failure=JSON.parse(readFileSync(join(output,'diagnostics/failure.json')));assert.equal(failure.code,code);
 if(code==='OPS_SOURCE_UNKNOWN')assert.equal(failure.provider_code,code);
});

test('审查R2：非Error拒绝值也不能被诊断IO覆盖',async t=>{
 const output=mkdtempSync(join(tmpdir(),'publisher-undefined-'));t.after(()=>rmSync(output,{recursive:true,force:true}));let caught=false;
 try{await publishMainSnapshots({brainUrl:'https://example.invalid',token:'test',scope:'cecelia-kr',repo,base:head,head,output},{readMain:()=>head,fetchFn:async()=>{
  const path=join(output,'diagnostics/request-1.json');unlinkSync(path);mkdirSync(path);throw undefined;
 }});}catch(error){caught=true;assert.equal(error,undefined);}
 assert.equal(caught,true);
});

import './prepare-fixed-skill-cache.test.mjs';

import './implementation-infra-artifact.test.mjs';
import './implementation-source-recovery.test.mjs';

test('恢复CLI没有正式base时拒绝且绝不回落中央refresh',async t=>{
 const r=await executeProvider(t,{sourceRecovery:true,artifact:{missing:true},initial:{parentMissing:true,childMissing:true}});
 assert.notEqual(r.code,0);assert.match(r.stderr,/IMPLEMENTATION_CI_BASE_ARTIFACT_MISSING/);
 assert.equal(r.calls.length,0);assert.equal(existsSync(join(r.dir,'evidence/head.json')),false);
});
for(const [eventName,enabled,ref] of [['push','true','refs/heads/main'],['workflow_dispatch','false','refs/heads/main'],['workflow_call','true','refs/heads/main'],['workflow_dispatch','true','refs/heads/not-main']])test(`实际main入口拒绝${eventName}/${enabled}/${ref}降级`,async t=>{
 const dir=mkdtempSync(join(tmpdir(),'source-only-main-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');git('config','core.hooksPath','/dev/null');git('remote','add','origin',`https://github.com/${repo}.git`);
 writeFileSync(join(dir,'tracked'),'base');git('add','.');git('commit','-qm','base');const fixedBase=git('rev-parse','HEAD');
 writeFileSync(join(dir,'tracked'),'head');git('commit','-qam','head');const fixedHead=git('rev-parse','HEAD');
 writeFileSync(join(dir,'base.json'),JSON.stringify(bundle(fixedBase)));
 writeFileSync(join(dir,'head.json'),JSON.stringify({snapshot:sealRecoveryBundle(bundle(fixedHead).snapshot,{base_revision:fixedBase,head_revision:fixedHead})}));
 writeFileSync(join(dir,'event.json'),JSON.stringify({inputs:{source_baseline_recovery:enabled}}));
 const overrides={GITHUB_EVENT_NAME:eventName,GITHUB_REF:ref,GITHUB_RUN_ID:'12',GITHUB_EVENT_PATH:join(dir,'event.json')},old={};
 for(const [k,v]of Object.entries(overrides)){old[k]=process.env[k];process.env[k]=v;}
 try{
  await assert.rejects(runImplementationMainGate({repoRoot:dir,scope:'cecelia-kr',base:fixedBase,head:fixedHead,mode:'main',snapshotBase:join(dir,'base.json'),snapshotHead:join(dir,'head.json'),outputDir:join(dir,'out'),mainScopes:JSON.stringify({schema_version:1,scopes:['cecelia-kr','cecelia-factory']})}),/SOURCE_RECOVERY_DISPATCH_REQUIRED/);
  assert.equal(existsSync(join(dir,'out/receipt.json')),false);
 }finally{for(const [k,v]of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});

for(const fault of ['fullgate','runtime_drift','central_drift'])test(`真实publisher编译成功但${fault}失败时不发布正式head`,async t=>{
 const dir=mkdtempSync(join(tmpdir(),'recovery-publish-order-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const source=join(dir,'source');mkdirSync(source);
 const git=(...args)=>execFileSync('git',args,{cwd:source,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');git('config','core.hooksPath','/dev/null');git('remote','add','origin',`https://github.com/${repo}.git`);
 for(const {path}of readNativeConsumerRuntime().files){mkdirSync(join(source,path,'..'),{recursive:true});writeFileSync(join(source,path),readFileSync(join(root,path)));}
 git('add','.');git('commit','-qm','base');const base=git('rev-parse','HEAD');writeFileSync(join(source,'reviewed-test'),'fixed');git('add','.');git('commit','-qm','head');const head=git('rev-parse','HEAD');
 const baseline=bundle(base),identity={...recoveryRuntimeAt(source,base),git_sha:base},readiness={status:'source_only',runtime_status:'not_deployed',base_revision:base,revision:head,runtime:identity};
 let compiled=false,executed=false,reads=0,observations=0;
 await assert.rejects(publishRecoveryBaseline({repoRoot:source,base,head,brainUrl:'http://fixture.invalid',token:'fixture',output:join(dir,'output'),baseline,readiness},{
  github:async()=>({sha:head}),verifyAuthority:async()=>({repo,base_revision:base,direct_base_revision:base,head_revision:head}),
  inspectRuntime:async()=>{observations++;return {...readiness,runtime:fault==='runtime_drift'&&observations===2?{...identity,git_sha:'f'.repeat(40)}:identity};},
  fetchFn:async()=>{reads++;const value=structuredClone(baseline);if(fault==='central_drift'&&reads===2){const {snapshot_sha256,...body}=value.snapshot;body.map={manifest:null,observed_drift:true};value.snapshot=seal(body);}return new Response(JSON.stringify(value));},
  compile:async()=>{compiled=true;return bundle(head).snapshot;},
  runGate:async options=>{executed=true;mkdirSync(options.outputDir,{recursive:true});writeFileSync(join(options.outputDir,'receipt.json'),JSON.stringify({verdict:fault==='fullgate'?'FAIL':'PASS'}));return {receipt:{verdict:fault==='fullgate'?'FAIL':'PASS'}};},
 }),{code:{fullgate:'SOURCE_RECOVERY_FULL_GATE_FAILED',runtime_drift:'SOURCE_RECOVERY_RUNTIME_CHANGED',central_drift:'SOURCE_RECOVERY_CENTRAL_CHANGED'}[fault]});
 assert.equal(compiled,true);assert.equal(executed,true);assert.equal(existsSync(join(dir,'output/head.json')),false);assert.equal(existsSync(join(dir,'output/base.json')),false);assert.equal(existsSync(join(dir,'output/diagnostics/source-only-verification/receipt.json')),true);
});

test('上传前回归的真实子进程不继承中央或部署凭据',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'recovery-env-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');git('config','core.hooksPath','/dev/null');git('remote','add','origin',`https://github.com/${repo}.git`);
 const keys=['CECELIA_INTERNAL_TOKEN','GH_TOKEN','GITHUB_TOKEN','DEPLOY_TOKEN','TS_AUTHKEY','SKILLS_SOURCE_SSH_KEY'],path='tests/smoke/credentials.sh';
 mkdirSync(join(dir,'tests/smoke'),{recursive:true});writeFileSync(join(dir,path),'#!/bin/bash\nset -euo pipefail\n'+keys.map(key=>'test -z "${'+key+'-}"').join('\n')+'\n');
 git('add','.');git('commit','-qm','fixture');const head=git('rev-parse','HEAD'),old={};
 for(const key of keys){old[key]=process.env[key];process.env[key]='fixture-secret';}
 try{const results=await runRegisteredAssertions({repoRoot:dir,source:{repo,head_revision:head},required_assertions:[{assertion_ref:`manual:bash ${path}`,source_repo:repo,source_bindings:[{path}]}]});assert.equal(results.length,1);assert.equal(results[0].exit_code,0);assert.equal(results[0].error,null);}
 finally{for(const [k,v]of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});

// 编译入口回归：DB边界模拟空manifest；Git基线 checkout、入口顺序和清场均真实执行。
for(const fault of ['', 'projection', 'head_projection', 'close'])test(`来源compiler必须投影双scope固定base且清场:${fault||'success'}`,t=>{
 const dir=mkdtempSync(join(tmpdir(),'recovery-compile-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');git('config','core.hooksPath','/dev/null');
 writeFileSync(join(dir,'fixed-source'),'baseline');git('add','.');git('commit','-qm','base');const base=git('rev-parse','HEAD');
 writeFileSync(join(dir,'fixed-source'),'candidate');git('commit','-qam','candidate');const head=git('rev-parse','HEAD');
 writeFileSync(join(dir,'base.json'),JSON.stringify(bundle(base)));writeFileSync(join(dir,'candidate.json'),JSON.stringify(bundle(head,{parentMissing:true,parentGaps:[{code:'manifest_source_mismatch'}]}).snapshot));writeFileSync(join(dir,'final.json'),JSON.stringify(bundle(head).snapshot));
 const mocked=`import assert from 'node:assert/strict';import{readFileSync,writeFileSync}from'node:fs';import{execFileSync}from'node:child_process';
 const dir=${JSON.stringify(dir)},base=${JSON.stringify(base)},fault=${JSON.stringify(fault)},imports=new Set(),projected=new Set();let checkout;
 export async function createImplementationScratch(){return{db:{},close:async()=>{writeFileSync(dir+'/closed',String(checkout));if(fault==='close')throw Error('CLOSE_FAILED');}};}
 export async function importImplementationSnapshot(db,s){imports.add(s.scope);}
 export async function projectImplementationSnapshot(db,s,root){
  checkout=root;writeFileSync(dir+'/checkout',root);assert.equal(imports.size,2);const expected=s.revision;assert.ok([base,${JSON.stringify(head)}].includes(expected));
  assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),expected);assert.equal(readFileSync(root+'/fixed-source','utf8'),expected===base?'baseline':'candidate');
  if(fault==='projection'||fault==='head_projection'&&expected!==base)throw Error('PROJECTION_FAILED');projected.add(expected+s.scope);if(expected!==base)writeFileSync(dir+'/projected-'+s.scope,'true');
 }
 export async function buildPrImplementationSnapshot(db,s){if(!['cecelia-kr','cecelia-factory'].every(scope=>projected.has(base+scope)))throw Error('OPS_MANIFEST_IDENTITY_INVALID');writeFileSync(dir+'/built',s.scope);const value=JSON.parse(readFileSync(dir+'/candidate.json'));return s.scope==='cecelia-factory'?value.admission_companion.snapshot:value;}`;
 writeFileSync(join(dir,'snapshot-mock.mjs'),mocked);
 const target=new URL('../implementation-snapshot.mjs',import.meta.url).href,apiTarget=new URL('../../../packages/brain/src/lib/implementation-ci-snapshot.js',import.meta.url).href;
 writeFileSync(join(dir,'api-mock.mjs'),`export * from ${JSON.stringify(apiTarget+'?original')};import{readFileSync,existsSync}from'node:fs';import assert from'node:assert/strict';export async function exportImplementationSnapshot(){const dir=${JSON.stringify(dir)};for(const scope of ['cecelia-kr','cecelia-factory'])assert.equal(existsSync(dir+'/projected-'+scope),true);return JSON.parse(readFileSync(dir+'/final.json'));}`);
 writeFileSync(join(dir,'loader.mjs'),`export async function resolve(s,c,next){const r=await next(s,c);return r.url===${JSON.stringify(target)}?{url:new URL('./snapshot-mock.mjs',import.meta.url).href,shortCircuit:true}:r.url===${JSON.stringify(apiTarget)}?{url:new URL('./api-mock.mjs',import.meta.url).href,shortCircuit:true}:r;}`);
 writeFileSync(join(dir,'register.mjs'),"import{register}from'node:module';register('./loader.mjs',import.meta.url);");
 const runner=`import{readFileSync,existsSync}from'node:fs';import assert from'node:assert/strict';import{compileRecoveryCandidate}from${JSON.stringify(new URL('../implementation-source-recovery.mjs',import.meta.url).href)};
 const dir=${JSON.stringify(dir)},fault=${JSON.stringify(fault)};
 const run=()=>compileRecoveryCandidate({repoRoot:dir,head:${JSON.stringify(head)},baseline:JSON.parse(readFileSync(dir+'/base.json'))});
 if(fault)await assert.rejects(run(),new RegExp(fault==='close'?'CLOSE_FAILED':'PROJECTION_FAILED'));else await run();
 assert.equal(existsSync(dir+'/closed'),true);assert.equal(existsSync(readFileSync(dir+'/checkout','utf8')),false);
 if(fault==='projection')assert.equal(existsSync(dir+'/built'),false);`;
 const result=spawnSync(process.execPath,['--import',join(dir,'register.mjs'),'--input-type=module','-e',runner],{cwd:root,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
});

test('恢复publisher使用已准备且固定SHA的Skill缓存',()=>{const config=workflow();const step=config.jobs['snapshot-main'].steps.find(s=>s.name==='固定main中央定义导出');assert.equal(step.env.IMPLEMENTATION_SKILLS_SOURCE_DIR,'${{ github.workspace }}/tooling/.skills-source');});
