import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import yaml from 'js-yaml';
import {commandsFor} from '../run-basic-check.mjs';
import {REQUIRED_JOBS,checkResults} from '../check-basic-results.mjs';
const workflow=yaml.load(readFileSync(new URL('../../../.github/workflows/ci.yml',import.meta.url),'utf8'));
const required=['security','checks','runtime-integration','codeql'];

test('休眠Dashboard与PWA退出默认CI，前端仍可由原CLI显式验收',()=>{
 assert.equal(workflow.jobs['pwa-upgrade'],undefined);
 assert.ok(workflow.jobs.checks.strategy.matrix.include.every(row=>row.component!=='dashboard'));
 assert.deepEqual(workflow.jobs['ci-passed'].needs,required);
 assert.deepEqual(REQUIRED_JOBS,required);
 assert.equal(workflow.jobs['ci-passed'].name,'源码保底通过');
 assert.deepEqual(commandsFor('dashboard').map(step=>step.cwd.split('/').slice(-2).join('/')),['apps/api','apps/dashboard','apps/dashboard']);
});

test('剩余四必需组全部成功才允许源码过门，错误状态不能放行',()=>{
 const good=()=>Object.fromEntries(required.map(job=>[job,{result:'success'}]));
 assert.doesNotThrow(()=>checkResults(good()));
 for(const job of required){
  for(const status of ['failure','cancelled','skipped','pending','unknown']){
   const needs=good();needs[job].result=status;
   assert.throws(()=>checkResults(needs),new RegExp(job));
  }
  const missing=good();delete missing[job];
  assert.throws(()=>checkResults(missing),new RegExp(job));
 }
 assert.throws(()=>checkResults({...good(),unexpected:{result:'success'}}),/unexpected/);
});
