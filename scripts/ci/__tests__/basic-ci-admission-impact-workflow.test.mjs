import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {futureCiAdmissionImpactWorkflow} from './fixtures/ci-admission-impact-workflow.mjs';
const yaml=createRequire(import.meta.url)('js-yaml');
const workflow=()=>yaml.load(futureCiAdmissionImpactWorkflow);
const named=(name)=>workflow().jobs.gate.steps.find(s=>s.name===name);
test('完整旧Core CI仍在时，未来typed路由必须先作为未激活工具受信',()=>{
 const digest=path=>createHash('sha256').update(readFileSync(new URL('../../../'+path,import.meta.url))).digest('hex');
 if(digest('.github/workflows/ci.yml')==='91eb26e207d3f15cf810fe1dec4e9137d0f31d1c8004f7938ded7cb7112335e2')
  assert.equal(digest('.github/workflows/implementation-impact.yml'),'4e59206bd6dd08b77ea3a59e0feb44a2371ffc0fa9139b81f67e64a0169a9cf9');
 else assert.equal(digest('.github/workflows/implementation-impact.yml'),'17d29709a4990f9a0b4c2bbc63ad2dbcb7ce4f2b635a5d1fb416e8239d30f3b6');
});
test('typed来源仅作路由，准备和准入使用只读官方API令牌再核原产物',()=>{
 const w=workflow();assert.equal(w.permissions.actions,'read');assert.equal(w.permissions.checks,'read');
 for(const name of ['准备固定中央Skill对象缓存','实际变更影响与固定回归'])assert.equal(named(name).env.GH_TOKEN,'${{ github.token }}');
 for(const name of ['独立infra固定来源加入联合输入','完整联合scope清单加入infra'])assert.match(named(name).if,/env\.IMPLEMENTATION_CI_ADMISSION_INPUT_DIR == ''/);
});
test('执行已审未来workflow三个Shell正文：typed bundle不提取裸快照、不独立下载infra、不重建scopes-file',t=>{
 const root=mkdtempSync(join(tmpdir(),'ci-admission-workflow-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 for(const dir of ['bin','source','tooling'])mkdirSync(join(root,dir));
 const git=(...args)=>execFileSync('git',['-C',join(root,'tooling'),'-c','core.hooksPath=/dev/null','-c','commit.gpgSign=false',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','-q');writeFileSync(join(root,'tooling/source'),'fixed tooling');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','test: tooling');
 const base='a'.repeat(40),head='b'.repeat(40),log=join(root,'commands.jsonl'),envFile=join(root,'environment');
 writeFileSync(join(root,'bin/node'),`#!${process.execPath}\nimport fs from 'node:fs';import path from 'node:path';\nconst a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(a)+'\\n');\nif(a[0].endsWith('implementation-pr-baseline.mjs')){const d=path.join(process.env.RUNNER_TEMP,'implementation-input/ci-admission');fs.mkdirSync(d,{recursive:true});fs.writeFileSync(path.join(d,'handoff.json'),'{}');fs.writeFileSync(path.join(d,'artifact.zip'),'fixture-original-zip');console.log(${JSON.stringify(base)});}\nelse if(a[0].endsWith('implementation-skill-source.mjs')){if(a.includes('--snapshot')||!process.env.IMPLEMENTATION_CI_ADMISSION_INPUT_DIR)process.exit(17);const d=path.join(process.env.RUNNER_TEMP,'implementation-skills-ci-fixture/objects');fs.mkdirSync(d,{recursive:true});console.log(d);}\nelse if(a[0].endsWith('implementation-multi-pr-gate.mjs')){if(a.includes('--scopes-file')||!a.includes('--ci-admission-input-dir')||!a.includes('--tooling-root'))process.exit(18);}\nelse process.exit(19);\n`,{mode:0o700});
 writeFileSync(join(root,'bin/gh'),'#!/bin/sh\nexit 20\n',{mode:0o700});
 const env={...process.env,PATH:join(root,'bin')+':'+process.env.PATH,RUNNER_TEMP:root,GITHUB_WORKSPACE:root,GITHUB_ENV:envFile,GITHUB_REPOSITORY:'perfectuser21/cecelia',GITHUB_EVENT_NAME:'pull_request',MODE:'pr',BASE:base,HEAD:head,SOURCE_REPO:'perfectuser21/cecelia',MAP_SCOPE:'cecelia-kr',NATIVE_PR_BASELINE:'true',NATIVE_PR:'true',TOOLING_REVISION:git('rev-parse','HEAD'),INFRA_ADMISSION:'true',ADMISSION_SCOPES:'{"schema_version":1,"scopes":["cecelia-kr","cecelia-factory"]}'};
 delete env.IMPLEMENTATION_CI_ADMISSION_INPUT_DIR;delete env.IMPLEMENTATION_SKILLS_SOURCE_DIR;delete env.SKILLS_SOURCE_SSH_KEY;
 const run=name=>{const r=spawnSync('bash',['-e','-o','pipefail','-c',named(name).run],{cwd:root,encoding:'utf8',env});assert.equal(r.status,0,r.stderr);if(existsSync(envFile))for(const line of readFileSync(envFile,'utf8').trim().split('\n')){const index=line.indexOf('=');if(index>0)env[line.slice(0,index)]=line.slice(index+1);}};
 run('下载固定SHA中央bundle（PR无中央写凭据）');
 assert.equal(env.IMPLEMENTATION_CI_ADMISSION_INPUT_DIR,join(root,'implementation-input/ci-admission'));
 assert.equal(existsSync(join(root,'implementation-input/base')),false);assert.equal(existsSync(join(root,'implementation-input/head')),false);
 run('准备固定中央Skill对象缓存');run('实际变更影响与固定回归');
 const commands=readFileSync(log,'utf8').trim().split('\n').map(line=>JSON.parse(line));assert.equal(commands.length,3);
 assert.equal(existsSync(join(root,'implementation-input/scopes.json')),false);
 assert.equal(existsSync(join(root,'implementation-input/admission-scopes.json')),false);
});
