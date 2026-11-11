import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {planChecks} from '../basic-scope.mjs';
import * as runner from '../run-basic-check.mjs';
const {commandsFor}=runner;

test('共享API前端与Dashboard是同一功能任务，旧独立API不再被普通Brain变更选中',()=>{
 const front=planChecks(['apps/api/features/inbox/index.ts']);
 assert.deepEqual(front.map(x=>x.component),['dashboard','scripts']);
 const brain=planChecks(['packages/brain/src/task-router.js']);
 assert.equal(brain.some(x=>x.component==='api'),false);
 assert.equal(planChecks([],{full:true}).some(x=>x.component==='api'),false);
 assert.throws(()=>commandsFor('api'),/未知/);
 const commands=commandsFor('dashboard');
 assert.deepEqual(commands.map(x=>x.cwd.split('/').slice(-2).join('/')),['apps/api','apps/dashboard','apps/dashboard']);
 assert.equal(commands.some(x=>x.cwd.endsWith('/apps/api')&&x.command==='npm'&&x.args.includes('build')),false);
});

test('PR范围从真实固定Git差异取得，Ops仅运行现役Brain所需组',()=>{
 const {readCheckContext}=runner;
 const dir=mkdtempSync(join(tmpdir(),'pr-ci-scope-'));
 const git=(...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null',...args],{cwd:dir,encoding:'utf8'}).trim();
 try{
  git('init','-q');git('config','user.email','fixture@example.invalid');git('config','user.name','Fixture');
  writeFileSync(join(dir,'a'),'base');git('add','.');git('commit','-qm','base');const base=git('rev-parse','HEAD');
  writeFileSync(join(dir,'a'),'changed');git('add','.');git('commit','-qm','head');const head=git('rev-parse','HEAD');
  assert.deepEqual(readCheckContext({CI_CHECK_SCOPE:'changed',CI_BASE_SHA:base,CI_HEAD_SHA:head},dir),{paths:['a']});
  writeFileSync(join(dir,'b'),'replacement');git('add','.');git('commit','-qm','replacement');
  const replacement=git('rev-parse','HEAD');git('replace',head,replacement);
  assert.deepEqual(readCheckContext({CI_CHECK_SCOPE:'changed',CI_BASE_SHA:base,CI_HEAD_SHA:head},dir),{paths:['a']});
  git('replace','-d',head);
  assert.deepEqual(readCheckContext({CI_CHECK_SCOPE:'full'},dir),{});
  assert.throws(()=>readCheckContext({CI_CHECK_SCOPE:'changed',CI_BASE_SHA:'main;echo bad',CI_HEAD_SHA:head},dir),/SHA/);
  assert.throws(()=>readCheckContext({CI_CHECK_SCOPE:'changed',CI_BASE_SHA:base,CI_HEAD_SHA:'f'.repeat(40)},dir));
  assert.throws(()=>readCheckContext({CI_CHECK_SCOPE:'garbage'},dir),/scope/);
  const core=commandsFor('ops',undefined,{paths:['packages/brain/src/task-router.js']});
  const full=commandsFor('ops');assert.ok(core.length>0&&core.length<full.length);
  assert.equal(core.some(x=>x.args.some(a=>a.includes('docker/cecelia-runner/__tests__'))),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('顶层事件范围不会泄入测试的私有子进程',()=>{
 const dir=mkdtempSync(join(tmpdir(),'pr-ci-child-env-'));
 const cwd=new URL('../../../',import.meta.url).pathname;
 try{
  const git=(...args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
  const head=git('rev-parse','HEAD'),base=git('rev-parse','HEAD^');
  const fake=join(dir,'node');
  writeFileSync(fake,'#!/bin/sh\n[ -z "${CI_CHECK_SCOPE+x}${CI_BASE_SHA+x}${CI_HEAD_SHA+x}" ] || exit 71\nexit 23\n');chmodSync(fake,0o755);
  const result=spawnSync(process.execPath,[new URL('../run-basic-check.mjs',import.meta.url).pathname,'scripts'],{cwd,encoding:'utf8',env:{...process.env,PATH:dir+':'+process.env.PATH,CI_CHECK_SCOPE:'changed',CI_BASE_SHA:base,CI_HEAD_SHA:head}});
  assert.equal(result.status,23,result.stderr);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
