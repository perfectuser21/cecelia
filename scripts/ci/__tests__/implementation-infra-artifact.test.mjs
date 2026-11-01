import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync,spawnSync,spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import yaml from 'js-yaml';
import {publishMainSnapshots,validatePublishedSnapshot} from '../implementation-main-snapshot.mjs';
import {prepareInfraInputs} from '../implementation-infra-inputs.mjs';
import {runImplementationMainGate} from '../implementation-main-gate.mjs';
import {bundle} from './fixtures/admission-bundle.mjs';
import {infraSnapshot,repo,scope} from './fixtures/infra-snapshot.mjs';
const base='b'.repeat(40),head='a'.repeat(40);
const root=fileURLToPath(new URL('../../../',import.meta.url));
test('第三来源输入器在读网络和写文件前拒绝外仓/非固定SHA/未知模式',()=>{
 for(const change of [{sourceRepo:'foreign/repo'},{base:'main'},{mode:'unknown'}])assert.throws(()=>prepareInfraInputs({sourceRepo:repo,base,head,mode:'pr',inputDir:'/not-written',...change}),/IMPLEMENTATION_INFRA_INPUT_INVALID/);
});
test('infra历史来源只消费独立同SHA可信main产物，不混用KR bundle',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'infra-artifact-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 validatePublishedSnapshot(infraSnapshot(base),{scope,repo,revision:base,complete:true});
 const bin=join(dir,'bin');mkdirSync(bin);writeFileSync(join(dir,'head.json'),JSON.stringify(infraSnapshot(base)));
 execFileSync('zip',['-q',join(dir,'artifact.zip'),'head.json'],{cwd:dir});
 const name=`implementation-infra-snapshot-${base}`;
 writeFileSync(join(bin,'gh'),`#!/usr/bin/env node
const fs=require('fs'),p=process.argv[3];
const item={id:5,name:'${name}',expired:false,created_at:'2026-10-22T00:00:00Z',workflow_run:{id:8,head_branch:'main',head_sha:'${base}',repository_id:1,head_repository_id:1}};
if(p.includes('artifacts?'))console.log(JSON.stringify({total_count:p.includes('name=${name}')?1:0,artifacts:p.includes('name=${name}')?[item]:[]}));
else if(p.endsWith('/artifacts/5'))console.log(JSON.stringify(item));
else if(p.endsWith('/runs/8'))console.log(JSON.stringify({id:8,head_sha:'${base}',head_branch:'main',event:'workflow_dispatch',path:'.github/workflows/implementation-impact.yml',repository:{full_name:'${repo}'},head_repository:{full_name:'${repo}'}}));
else if(p.includes('/jobs?'))console.log(JSON.stringify({total_count:1,jobs:[{name:'snapshot-infra',status:'completed',conclusion:'success'}]}));
else if(p.endsWith('/zip'))process.stdout.write(fs.readFileSync('${dir}/artifact.zip'));
else process.exit(8);
`,{mode:0o700});
 const old=process.env.PATH;process.env.PATH=bin+':'+old;t.after(()=>{process.env.PATH=old;});
 await publishMainSnapshots({brainUrl:'https://brain.invalid',token:'fixture',scope,repo,base,head,output:join(dir,'output')},{readMain:()=>head,fetchFn:async url=>new Response(JSON.stringify(infraSnapshot(new URL(url).searchParams.get('revision'),{unknown:new URL(url).searchParams.get('revision')===base}))) });
 const result=JSON.parse(readFileSync(join(dir,'output/base.json')));assert.equal(result.snapshot.scope,scope);assert.equal(result.snapshot.revision,base);assert.equal(result.snapshot.execution_status,'unknown');
});

function cliFixture(t,change={}){
 const dir=mkdtempSync(join(tmpdir(),'infra-inputs-cli-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));mkdirSync(join(dir,'bin'));
 for(const [id,rev] of [[5,base],[6,head]]){
  const d=join(dir,String(id));mkdirSync(d);writeFileSync(join(d,'head.json'),JSON.stringify(infraSnapshot(change.wrongRevision?'c'.repeat(40):rev,{unknown:change.unknown})));
  execFileSync('zip',['-q',join(dir,id+'.zip'),'head.json'],{cwd:d});
 }
 writeFileSync(join(dir,'config.json'),JSON.stringify(change));
 writeFileSync(join(dir,'bin/gh'),`#!/usr/bin/env node
const fs=require('fs'),p=process.argv[3],c=JSON.parse(fs.readFileSync('${dir}/config.json'));
const ids={5:'${base}',6:'${head}'};
const item=id=>({id,name:'implementation-infra-snapshot-'+ids[id],expired:!!c.expired,created_at:'2026-10-22T00:00:00Z',workflow_run:{id:id+10,head_branch:c.branch||'main',head_sha:ids[id],repository_id:1,head_repository_id:c.fork?2:1}});
if(p.endsWith('/commits/main'))console.log(c.mainMoved?'${base}':'${head}');
else if(p.includes('artifacts?')){const id=p.includes('${head}')?6:5;console.log(JSON.stringify({total_count:c.missing?0:1,artifacts:c.missing?[]:[item(id)]}));}
else if(/artifacts\\/\\d+$/.test(p)){const id=+p.split('/').at(-1);console.log(JSON.stringify(item(id)));}
else if(p.endsWith('/zip')){const id=+p.split('/').at(-2);process.stdout.write(fs.readFileSync('${dir}/'+id+'.zip'));}
else if(p.includes('/jobs?'))console.log(JSON.stringify({total_count:1,jobs:[{name:c.job||'snapshot-infra',status:'completed',conclusion:c.failed?'failure':'success'}]}));
else if(/runs\\/\\d+$/.test(p)){const id=+p.split('/').at(-1);console.log(JSON.stringify({id,head_sha:ids[id-10],head_branch:'main',event:c.event||'push',path:c.path||'.github/workflows/implementation-impact.yml',repository:{full_name:'${repo}'},head_repository:{full_name:'${repo}'}}));}
else process.exit(8);
`,{mode:0o700});
 const input=join(dir,'input');mkdirSync(input);
 const env={...process.env,PATH:join(dir,'bin')+':'+process.env.PATH,SOURCE_REPO:repo,BASE:base,HEAD:head,MODE:'pr'};
 const run=(mode='pr')=>spawnSync(process.execPath,[join(root,'scripts/ci/implementation-infra-inputs.mjs'),input],{env:{...env,MODE:mode},encoding:'utf8'});
 return {dir,input,env,run};
}
test('真实CLI将infra基线交给PR固定HEAD scratch重建，不虚称PR已上main',t=>{
 const f=cliFixture(t),r=f.run();assert.equal(r.status,0,r.stderr);
 for(const side of ['base','head']){const s=JSON.parse(readFileSync(join(f.input,side,`${side}-${scope}.json`)));assert.equal(s.scope,scope);assert.equal(s.revision,base);assert.equal(s.execution_status,'unknown');}
 assert.equal(JSON.parse(r.stdout).head_basis,'base_registry_seed_for_fixed_head_scratch_rebuild');
});
test('main真实CLI使用两个精确SHA的独立infra快照',t=>{
 const f=cliFixture(t),r=f.run('main');assert.equal(r.status,0,r.stderr);
 assert.equal(JSON.parse(readFileSync(join(f.input,'base/base-cecelia-infra.json'))).revision,base);
 assert.equal(JSON.parse(readFileSync(join(f.input,'head/head-cecelia-infra.json'))).revision,head);
});
test('原main实际入口必须读取第三来源，错HEAD在任何scratch执行前拒绝',async t=>{
 const f=cliFixture(t),checkout=join(f.dir,'repo');mkdirSync(checkout);
 const git=(...args)=>execFileSync('git',args,{cwd:checkout,encoding:'utf8'}).trim();
 git('init','-q');git('remote','add','origin','https://github.com/perfectuser21/cecelia.git');
 writeFileSync(join(checkout,'sample'),'base');git('add','.');const b=git('-c','user.name=Fixture','-c','user.email=f@invalid','commit-tree',git('write-tree'),'-m','base');git('update-ref','HEAD',b);
 writeFileSync(join(checkout,'sample'),'head');git('add','.');const h=git('-c','user.name=Fixture','-c','user.email=f@invalid','commit-tree',git('write-tree'),'-p',b,'-m','head');git('update-ref','HEAD',h);
 for(const [side,rev] of [['base',b],['head',h]]){mkdirSync(join(f.input,side));writeFileSync(join(f.input,side,side+'.json'),JSON.stringify(bundle(rev)));writeFileSync(join(f.input,side,side+'-cecelia-infra.json'),JSON.stringify(infraSnapshot(b).snapshot));}
 await assert.rejects(runImplementationMainGate({repoRoot:checkout,scope:'cecelia-kr',base:b,head:h,mode:'main',snapshotBase:join(f.input,'base/base.json'),snapshotHead:join(f.input,'head/head.json'),outputDir:join(f.dir,'report'),mainScopes:JSON.stringify({schema_version:1,scopes:['cecelia-kr','cecelia-factory']}),infraInputDir:f.input}),e=>e.code==='IMPLEMENTATION_MAIN_INFRA_SOURCE_MISMATCH');
 assert.equal(JSON.parse(readFileSync(join(f.dir,'report/gap.json'))).code,'IMPLEMENTATION_MAIN_INFRA_SOURCE_MISMATCH');
});
for(const moved of [false,true])test(`可信main首次独立infra导出真实HTTP/CLI，main漂移=${moved}`,async t=>{
 const f=cliFixture(t,{mainMoved:moved}),requests=[];
 const server=createServer((req,res)=>{const u=new URL(req.url,'http://fixture');requests.push({method:req.method,scope:u.searchParams.get('scope')});res.setHeader('Content-Type','application/json');res.end(JSON.stringify(infraSnapshot(head)));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const child=spawn(process.execPath,[join(root,'scripts/ci/implementation-main-snapshot.mjs')],{cwd:f.dir,env:{...f.env,BRAIN_URL:`http://127.0.0.1:${server.address().port}`,CECELIA_INTERNAL_TOKEN:'fixture',MAP_SCOPE:scope,BASE:head,HEAD:head},stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
 const code=await new Promise((r,j)=>{child.once('error',j);child.once('close',r);});
 assert.equal(code,moved?1:0,stderr);assert.equal(existsSync(join(f.dir,'evidence/head.json')),!moved);
 if(!moved){assert.equal(JSON.parse(stdout).admission_scopes[0],scope);assert.ok(requests.length>0);assert.ok(requests.every(x=>x.scope===scope));assert.equal(JSON.parse(readFileSync(join(f.dir,'evidence/head.json'))).snapshot.execution_status,'unknown');}
});
for(const [name,change] of Object.entries({缺失:{missing:true},过期:{expired:true},分支:{branch:'feature/x'},外部fork:{fork:true},错误工作流:{path:'.github/workflows/other.yml'},非main事件:{event:'pull_request'},错误job:{job:'snapshot-main'},失败job:{failed:true},错误快照SHA:{wrongRevision:true},未知快照:{unknown:true}}))test(`真实CLI拒绝${name}，不落任何正式infra输入`,t=>{
 const f=cliFixture(t,change),r=f.run();assert.notEqual(r.status,0);assert.equal(existsSync(join(f.input,'base/base-cecelia-infra.json')),false);assert.equal(existsSync(join(f.input,'head/head-cecelia-infra.json')),false);
});
test('正式YAML实际PR接线把第三输入加入原双来源联合gate',t=>{
 const f=cliFixture(t),w=yaml.load(readFileSync(join(root,'.github/workflows/implementation-impact.yml'),'utf8'));
 const steps=w.jobs.gate.steps,step=steps.find(s=>s.name==='独立infra固定来源加入联合输入');assert.ok(step,'必须有正式调用方');
 symlinkSync(root,join(f.dir,'tooling'),'dir');
 const input=join(f.dir,'implementation-input');mkdirSync(input);const envFile=join(f.dir,'github-env');
 const r=spawnSync('bash',['-c',step.run],{cwd:f.dir,env:{...f.env,RUNNER_TEMP:f.dir,GITHUB_ENV:envFile},encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 assert.equal(JSON.parse(readFileSync(join(input,'head/head-cecelia-infra.json'))).revision,base);
 assert.match(readFileSync(envFile,'utf8'),/IMPLEMENTATION_INFRA_INPUT_DIR=/);
 const scopes=steps.find(s=>s.name==='完整联合scope清单加入infra');
 const setup=spawnSync('bash',['-c',scopes.run],{cwd:f.dir,env:{...f.env,GITHUB_ENV:envFile,ADMISSION_SCOPES:JSON.stringify({schema_version:1,scopes:['cecelia-kr','cecelia-factory']})},encoding:'utf8'});assert.equal(setup.status,0,setup.stderr);
 const combined=readFileSync(envFile,'utf8').split('\n').find(l=>l.startsWith('ADMISSION_SCOPES=')).slice('ADMISSION_SCOPES='.length);
 const gate=steps.find(s=>s.name==='实际变更影响与固定回归').run;
 const boundary=gate.lastIndexOf('node tooling/scripts/ci/implementation-multi-pr-gate.mjs');assert.ok(boundary>0);
 const beforeInvoke=gate.slice(0,boundary)+'\nfi';
 writeFileSync(join(input,'scopes.json'),'[]');
 const q=spawnSync('bash',['-c',beforeInvoke],{cwd:f.dir,env:{...f.env,IMPLEMENTATION_CI_ADMISSION_INPUT_DIR:'',INFRA_ADMISSION:'true',RUNNER_TEMP:f.dir,ADMISSION_SCOPES:combined},encoding:'utf8'});assert.equal(q.status,0,q.stderr);
 assert.deepEqual(JSON.parse(readFileSync(join(input,'scopes.json'))).map(x=>x.scope),['cecelia-kr','cecelia-factory','cecelia-infra']);
});
