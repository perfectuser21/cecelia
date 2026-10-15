import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,mkdirSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import yaml from 'js-yaml';
import {stepSha256} from '../../../packages/brain/scripts/sync-steps-from-workspace.mjs';
import {EXISTING_OPS_IDENTITIES as identities} from '../../../packages/brain/src/lib/existing-ops-source.js';
import {validateImplementationSnapshot,extractImplementationAdmissionSnapshots} from '../../../packages/brain/src/lib/implementation-ci-snapshot.js';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const repo='perfectuser21/cecelia',head='a'.repeat(40),base='b'.repeat(40);
const seal=(body,key='snapshot_sha256')=>({...body,[key]:stepSha256(body)});
function bundle(revision,{parentMissing=false,childMissing=false}={}){
 const registry={workflows:[],references:[],activities:[],steps:[],capabilities:[],value_streams:[{id:'aaaaaaaa-f0f0-4000-8000-000000000001'}]};
 const definitions={workflows:[],activities:[]};
 for(const i of identities){
  registry.workflows.push({id:i.workflow_id,key:i.workflow_key,capability_id:i.capability_id});
  registry.capabilities.push({id:i.capability_id,parent_journey_id:registry.value_streams[0].id});
  for(const [n,id] of [i.reference_id,...i.unverified_reference_ids].entries()){
   const activity_id=n===0?i.activity_id:id;
   registry.references.push({id,workflow_id:i.workflow_id,activity_id,slot_key:`step_${n+1}`,sequence_no:n+1,active:true});registry.activities.push({id:activity_id});
  }
 }
 const frozen=seal(registry,'registry_sha256');
 for(const i of identities){
  const common={definition_scope:'consumer_evidence',source_scope:'cecelia-factory',registration_sha256:frozen.registry_sha256,contract:{key:i.workflow_key,executable:false,definition_scope:'consumer_evidence',source_basis:'fixed_git_tree'}};
  const source={repo,path:'fixed-fixture.json',commit:revision};
  const activity={id:i.activity_id,activity_id:i.activity_id,source_repo:repo,source_path:source.path,source_commit:revision,payload:{...common,implementation_bindings:[]}};
  activity.payload_sha256=stepSha256({source,payload:activity.payload});definitions.activities.push(activity);
  const workflow={id:i.workflow_id,workflow_id:i.workflow_id,source_repo:repo,source_path:source.path,source_commit:revision,payload:{...common,capability_id:i.capability_id,coverage:{status:'unknown',verified_reference_ids:[i.reference_id],unverified_reference_ids:i.unverified_reference_ids},activities:[{reference_id:i.reference_id,activity_id:i.activity_id,activity_version_id:activity.id}]}};
  workflow.payload_sha256=stepSha256({source,payload:workflow.payload});definitions.workflows.push(workflow);
 }
 const child=seal({schema_version:1,scope:'cecelia-factory',repo,revision,status:childMissing?'unknown':'verified',gaps:childMissing?[{code:'definition_snapshot_missing'},{code:'scope_manifest_missing'}]:[],snapshot_scope:'consumer_evidence',execution_status:'unknown',consumer_registry:frozen,unverified_reference_ids:identities.flatMap(i=>i.unverified_reference_ids),canonical:{...registry,journeys:[]},definitions:childMissing?{workflows:[],activities:[]}:definitions,map:{},assertions:[]});
 const companion=seal({schema_version:1,purpose:'admission_only',scope:child.scope,repo,revision,snapshot:child},'companion_sha256');
 return {snapshot:seal({schema_version:1,scope:'cecelia-kr',repo,revision,status:parentMissing?'unknown':'verified',gaps:parentMissing?[{code:'definition_snapshot_missing'}]:[],canonical:{workflows:[],journeys:[]},definitions:{workflows:[],activities:[]},admission_companion:companion})};
}
const workflow=()=>yaml.load(readFileSync(join(root,'.github/workflows/implementation-impact.yml'),'utf8'));
async function executeProvider(t,{initial={},refresh={},after={},moved=false,getError=false,mutateFinal=null}={}){
 const dir=mkdtempSync(join(tmpdir(),'implementation-publish-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 mkdirSync(join(dir,'bin'));symlinkSync(root,join(dir,'tooling'),'dir');
 writeFileSync(join(dir,'bin/gh'),`#!/bin/sh\nprintf '%s\\n' '${moved?'c'.repeat(40):head}'\n`,{mode:0o700});
 const calls=[];let stage={...initial},posts=0;
 const server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;const url=new URL(req.url,'http://test');
  const q=req.method==='POST'?JSON.parse(raw):Object.fromEntries(url.searchParams);calls.push({method:req.method,...q});
  let code=200,value;
  if(req.method==='POST'){
   posts++;const response=refresh[q.scope];code=response?.status??200;
   if(code<300){if(q.scope==='cecelia-kr')stage.parentMissing=false;else stage.childMissing=false;}
   Object.assign(stage,after[q.scope]??{});
   value=response?.body??(q.scope==='cecelia-factory'?{snapshot:bundle(head,stage).snapshot.admission_companion.snapshot}:bundle(head,stage));
  }else if(getError){code=409;value={error:{code:'MAP_MANIFEST_ACTIVE_CONFLICT'}};}
  else {value=bundle(q.revision,q.revision===head?stage:{childMissing:true});if(mutateFinal&&posts)value=mutateFinal(value);}
  res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(value));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const step=workflow().jobs['snapshot-main'].steps.find(s=>s.name==='固定main中央定义导出');
 const env={...process.env,PATH:join(dir,'bin')+':'+process.env.PATH,BRAIN_URL:`http://127.0.0.1:${server.address().port}`,CECELIA_INTERNAL_TOKEN:'isolated-test-not-secret',SOURCE_REPO:repo,MAP_SCOPE:'cecelia-kr',BASE:base,HEAD:head};
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
 const env={...process.env,PATH:join(dir,'bin')+':'+process.env.PATH,RUNNER_TEMP:dir,GITHUB_REPOSITORY:repo,MODE:'pr',MAP_SCOPE:'cecelia-kr',BASE:base,HEAD:head,ADMISSION_SCOPES:JSON.stringify({schema_version:1,scopes:['cecelia-kr','cecelia-factory']})};
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
