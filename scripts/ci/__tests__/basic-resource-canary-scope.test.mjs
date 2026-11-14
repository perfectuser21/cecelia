import test from 'node:test';
import assert from 'node:assert/strict';
import {planResourceCanaries, validateResourcePlan, collectInputs} from '../resource-canary-scope.mjs';
import {readFileSync} from 'node:fs';
const inputs = collectInputs(path => readFileSync(new URL('../../../' + path, import.meta.url), 'utf8'));
const plan = (paths, manual='none') => planResourceCanaries(paths, {manual, inputs});
test('普通 Brain、测试、文档、无关脚本和版本锁文件不启动真实资源专项', () => {
  for (const path of ['packages/brain/src/server.js','packages/brain/src/__tests__/app-server.test.js','docs/foo.md','scripts/foo.sh','package-lock.json']) {
    assert.deepEqual(plan([path]), {linux:false});
  }
});
test('Linux require 闭包和容器 bind 输入触发，其余运行时不触发', () => {
  assert.deepEqual(Object.keys(inputs),['linux']);
  for (const path of inputs.linux) assert.equal(plan([path]).linux,true,path);
  assert.deepEqual(plan(['packages/brain/scripts/fleet-worker/linux-resource-canary.cjs']), {linux:true});
  assert.deepEqual(plan(['packages/brain/scripts/fleet-worker/app-server-shim.cjs']), {linux:false});
  assert.deepEqual(plan(['.github/workflows/ci.yml']), {linux:true});
});
test('仅none/linux手动入口；计划精确一个布尔标志，旧专项和未知输入拒绝', () => {
  for(const manual of ['none','linux']) {
    const result=plan(['docs/foo.md'],manual);
    assert.deepEqual(result,{linux:manual==='linux'});
    validateResourcePlan(JSON.stringify(result));
  }
  for(const manual of ['app-server','legacy','all','bogus']) assert.throws(()=>plan(['docs/foo.md'],manual));
  for(const value of ['', '{}','null','[]','{"linux":false,"unknown":false}',
    '{"linux":false,"app_server":false,"legacy":false}','{"linux":"false"}']) assert.throws(()=>validateResourcePlan(value));
});

import {mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
const selector=new URL('../resource-canary-scope.mjs',import.meta.url).pathname;
test('真实Git CLI固定两端commit，版本和根依赖噪声不启动canary；未知依赖/参数无成功输出',()=>{
  const temp=mkdtempSync(join(tmpdir(),'resource-scope-git-'));
  try {
    const git=(...args)=>execFileSync('git',['-c',`core.hooksPath=${join(temp,'fixture-hooks')}`,...args],{cwd:temp,encoding:'utf8'}).trim();
    git('init','-q');git('config','user.name','scope-test');git('config','user.email','scope@example.invalid');
    const worker=join(temp,'packages/brain/scripts/fleet-worker');mkdirSync(worker,{recursive:true});
    for(const name of ['linux-resource-canary','linux-resource-probe','linux-cgroup']) writeFileSync(join(worker,name+'.cjs'),'// fixture\n');
    writeFileSync(join(temp,'package.json'),JSON.stringify({version:'1.0.0',dependencies:{unused:'1.0.0'}}));
    git('add','.');git('commit','-qm','base');const base=git('rev-parse','HEAD');
    writeFileSync(join(temp,'package.json'),JSON.stringify({version:'2.0.0',dependencies:{unused:'2.0.0'}}));
    writeFileSync(join(temp,'package-lock.json'),'{"version":"2.0.0"}');
    git('add','.');git('commit','-qm','manifest');const head=git('rev-parse','HEAD');
    const run=(...args)=>spawnSync(process.execPath,[selector,...args],{cwd:temp,encoding:'utf8',env:{...process.env,GITHUB_OUTPUT:join(temp,'output')}});
    let result=run('--base',base,'--head',head);
    assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{linux:false});
    assert.equal(readFileSync(join(temp,'output'),'utf8'),`resource_plan=${result.stdout}`);
    writeFileSync(join(worker,'linux-cgroup.cjs'),'// changed\n');git('add','.');git('commit','-qm','linux');
    result=run('--base',base,'--head',head);assert.equal(JSON.parse(result.stdout).linux,false,'冻结head不可读取最新HEAD');
    result=run('--base',head,'--head',git('rev-parse','HEAD'));assert.equal(JSON.parse(result.stdout).linux,true);
    for(const args of [['--head',head,'--manual','unknown'],['--head',head,'--manual','legacy'],['--head',head,'--manual','app-server'],['--head',head,'--manual','all'],['--head','-bad'],['--head',head,'--unknown','x'],['--head',head,'--head',base]]) {
      rmSync(join(temp,'output'),{force:true});result=run(...args);assert.notEqual(result.status,0);assert.equal(existsSync(join(temp,'output')),false);
    }
    writeFileSync(join(worker,'linux-cgroup.cjs'),"require('external-package');\n");git('add','.');git('commit','-qm','external');
    rmSync(join(temp,'output'),{force:true});result=run('--head',git('rev-parse','HEAD'));
    assert.notEqual(result.status,0);assert.match(result.stderr,/外部依赖/);assert.equal(existsSync(join(temp,'output')),false);
    result=spawnSync(process.execPath,[selector,'--head',head],{cwd:temp,encoding:'utf8',env:{...process.env,GITHUB_OUTPUT:join(temp,'missing','output')}});
    assert.notEqual(result.status,0,'无法写入selector输出必须失败');
  } finally {rmSync(temp,{recursive:true,force:true});}
});
test('输入闭包可读性失败即拒绝，不把未知当作无专项',()=>{
  assert.throws(()=>collectInputs(()=>{throw new Error('unreadable');}),/unreadable/);
  assert.throws(()=>planResourceCanaries(['docs/a.md'],{}));
});
test('AppServer运行时源码与配置不触发Linux观测',()=>{
  for(const path of ['packages/brain/src/app-server/client.js','packages/brain/src/app-server/identity.js',
    'packages/brain/src/execution-directory/store.js','packages/brain/src/orchestrator/fleet-node/node-profile.js',
    'packages/brain/config/fleet-node-profiles.json','packages/brain/scripts/fleet-worker/app-server-shim.cjs']) assert.deepEqual(plan([path]),{linux:false},path);
});
test('新增未知computed import必须失败，不能冒充空计划',()=>{
  assert.throws(()=>collectInputs(path=>path.endsWith('linux-cgroup.cjs') ? 'import(arbitraryModule);' : readFileSync(new URL('../../../'+path,import.meta.url),'utf8')),/动态|computed/);
});
