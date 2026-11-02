import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync,execFileSync} from 'node:child_process';
import yaml from 'js-yaml';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const gate=yaml.load(readFileSync(join(root,'.github/workflows/implementation-impact.yml'),'utf8')).jobs.gate;

test('显式调用继承PR事件仍执行真实gate，普通PR无显式mode不获准入',()=>{
 const enabled=(mode,result,event='pull_request')=>Function('always','inputs','needs','github',`return (${gate.if.replaceAll("needs.snapshot-main", "needs[\"snapshot-main\"]")})`)(()=>true,{mode},{'snapshot-main':{result}},{event_name:event});
 assert.equal(enabled('pr','skipped'),true);
 assert.equal(enabled(undefined,'skipped'),false);
 assert.equal(enabled('main','success','workflow_dispatch'),true);
 assert.equal(enabled('main','failure','workflow_dispatch'),false);
});

test('显式多scope Shell调用合法CLI参数，固定snapshot路径完整且真实失败码阻断',t=>{
 const directory=mkdtempSync(join(tmpdir(),'impact-explicit-call-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 for(const name of ['bin','source','tooling','implementation-input','implementation-output'])mkdirSync(join(directory,name));
 const log=join(directory,'invocation.json'),entry=new URL('../implementation-multi-pr-gate.mjs',import.meta.url).href;
 writeFileSync(join(directory,'bin/node'),`#!${process.execPath}\nimport fs from 'node:fs';import {parseImplementationMultiArgs} from ${JSON.stringify(entry)};\nconst args=process.argv.slice(2);if(args.shift()!=='tooling/scripts/ci/implementation-multi-pr-gate.mjs')process.exit(91);const parsed=parseImplementationMultiArgs(args);fs.writeFileSync(${JSON.stringify(log)},JSON.stringify({parsed,scopes:JSON.parse(fs.readFileSync(parsed.scopesFile))}));process.exit(Number(process.env.FIXTURE_EXIT));\n`,{mode:0o700});
 const command=gate.steps.find(step=>step.name==='实际变更影响与固定回归').run;
 const env={PATH:join(directory,'bin')+':'+dirname(process.execPath)+':'+process.env.PATH,HOME:directory,TMPDIR:directory,RUNNER_TEMP:directory,GITHUB_WORKSPACE:directory,MODE:'pr',SOURCE_REPO:'perfectuser21/zenithjoy-workspace',BASE:'a'.repeat(40),HEAD:'b'.repeat(40),ADMISSION_SCOPES:JSON.stringify({schema_version:1,scopes:['zenithjoy','commander-generic']}),MAP_SCOPE:'zenithjoy'};
 for(const status of [0,17]){
  const result=spawnSync('bash',['-e','-o','pipefail','-c',command],{cwd:directory,env:{...env,FIXTURE_EXIT:String(status)},encoding:'utf8'});
  assert.equal(result.status,status,result.stderr);
  const {parsed,scopes}=JSON.parse(readFileSync(log,'utf8'));
  assert.equal(parsed.mode,'pr');assert.equal(parsed.base,env.BASE);assert.equal(parsed.head,env.HEAD);
  assert.equal(parsed.repoRoot,realpathSync(join(directory,'source')));assert.equal(parsed.ciAdmissionInputDir,undefined);
  assert.deepEqual(scopes,['zenithjoy','commander-generic'].map(scope=>({scope,snapshotBase:join(directory,'implementation-input/base',`base-${scope}.json`),snapshotHead:join(directory,'implementation-input/head',`head-${scope}.json`)})));
 }
});

test('通用Skill缓存Shell拒绝空输出及越界目录，合法隔离缓存才写入后续环境',t=>{
 const directory=mkdtempSync(join(tmpdir(),'impact-explicit-cache-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 for(const name of ['bin','source','tooling','implementation-input/base','implementation-input/head','implementation-skills-ci-valid/objects'])mkdirSync(join(directory,name),{recursive:true});
 const tooling=join(directory,'tooling');
 const git=(...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null','-c','commit.gpgSign=false',...args],{cwd:tooling,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','-q');writeFileSync(join(tooling,'source'),'fixed trusted tooling');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture');
 const revision=git('rev-parse','HEAD');
 for(const side of ['base','head'])writeFileSync(join(directory,'implementation-input',side,side+'.json'),JSON.stringify({snapshot:{schema_version:1}}));
 writeFileSync(join(directory,'bin/node'),`#!${process.execPath}\nprocess.stdout.write(process.env.FIXTURE_CACHE);\n`,{mode:0o700});
 const command=gate.steps.find(step=>step.name==='准备固定中央Skill对象缓存').run,output=join(directory,'environment');
 const valid=join(directory,'implementation-skills-ci-valid/objects');
 for(const cache of ['',tooling,valid]){
  const result=spawnSync('bash',['-e','-o','pipefail','-c',command],{cwd:directory,env:{PATH:join(directory,'bin')+':'+dirname(process.execPath)+':'+process.env.PATH,HOME:directory,TMPDIR:directory,RUNNER_TEMP:directory,GITHUB_WORKSPACE:directory,GITHUB_ENV:output,SOURCE_REPO:'perfectuser21/zenithjoy-workspace',BASE:'a'.repeat(40),HEAD:'b'.repeat(40),MODE:'pr',INFRA_ADMISSION:'false',TOOLING_REVISION:revision,FIXTURE_CACHE:cache},encoding:'utf8'});
  if(cache===valid){assert.equal(result.status,0,result.stderr);assert.match(readFileSync(output,'utf8'),/IMPLEMENTATION_SKILLS_SOURCE_DIR=/);}
  else{assert.notEqual(result.status,0);const gap=JSON.parse(readFileSync(join(directory,'implementation-output/gap.json'),'utf8'));assert.equal(gap.stage,'skill_cache_prepare');assert.equal(gap.status,'unknown');}
 }
});
