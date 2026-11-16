import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import yaml from 'js-yaml';
import {commandsFor} from '../run-basic-check.mjs';
import {REQUIRED_JOBS,checkResults} from '../check-basic-results.mjs';

const workflow=yaml.load(readFileSync(new URL('../../../.github/workflows/ci.yml',import.meta.url),'utf8'));
const expected=[...Array.from({length:6},(_,i)=>({component:'brain-unit',shard:i+1})),
  ...['brain-integration','image','dashboard','ops','scripts'].map(component=>({component}))];

test('实际CI固定执行11个现役核心检查，不依赖plan或变更路径',()=>{
  assert.equal(workflow.jobs.plan,undefined);
  assert.equal(workflow.jobs.checks.needs,undefined);
  assert.deepEqual(workflow.jobs.checks.strategy.matrix,{include:expected});
  for(const row of expected)assert.ok(commandsFor(row.component,row.shard).length);
  assert.deepEqual(workflow.jobs['ci-passed'].needs,['security','checks','runtime-integration','pwa-upgrade','codeql']);
  assert.deepEqual(REQUIRED_JOBS,workflow.jobs['ci-passed'].needs);
  for(const failed of REQUIRED_JOBS)for(const result of ['failure','skipped','cancelled']){
    const needs=Object.fromEntries(REQUIRED_JOBS.map(id=>[id,{result:id===failed?result:'success'}]));
    assert.throws(()=>checkResults(needs),new RegExp(failed));
  }
});

test('Ops不因遗留调用者传入Brain路径裁掉预览、凭据或部署回归',()=>{
  const full=commandsFor('ops');
  const brain=commandsFor('ops',undefined,{paths:['packages/brain/src/task-router.js']});
  assert.deepEqual(brain,full);
  for(const part of ['/preview-','/credentials/','/dashboard-release-'])
    assert.ok(full.some(step=>step.args.some(arg=>arg.includes(part))),part);
});

test('版本递增只由scripts矩阵执行，保持事件真实base/head',()=>{
  const gates=Object.entries(workflow.jobs).flatMap(([id,job])=>(job.steps??[])
    .filter(step=>step.run?.includes('check-brain-version-bump.sh')).map(step=>({id,step})));
  assert.equal(gates.length,1);
  assert.equal(gates[0].id,'checks');
  assert.equal(gates[0].step.if,"matrix.component == 'scripts' && (github.event_name == 'pull_request' || github.event_name == 'push')");
  assert.deepEqual(gates[0].step.env,{BASE_REF:'${{ github.event.pull_request.base.sha || github.event.before }}',HEAD_REF:'${{ github.event.pull_request.head.sha || github.sha }}'});
  assert.equal(gates[0].step.run,'bash scripts/ci/check-brain-version-bump.sh');
});

test('MCP保留显式执行入口，不自动加入核心；旧API无独立核心构建',()=>{
  assert.ok(!expected.some(row=>row.component==='mcp'));
  assert.ok(commandsFor('mcp').every(step=>step.cwd.endsWith('/packages/mcp-readonly')));
  assert.throws(()=>commandsFor('api'),/未知/);
  assert.deepEqual(commandsFor('dashboard').map(step=>step.cwd.split('/').slice(-2).join('/')),['apps/api','apps/dashboard','apps/dashboard']);
});
