import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { REQUIRED_JOBS } from '../check-basic-results.mjs';
import test from 'node:test';

const gate = new URL('../check-basic-results.mjs', import.meta.url).pathname;
const parents = yaml.load(readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8')).jobs['ci-passed'].needs;
const good = () => {
  const needs=Object.fromEntries(parents.map(job => [job, {result:'success'}]));
  needs.plan.outputs={resource_plan:JSON.stringify({linux:true,app_server:true,legacy:true})};
  needs['resource-canaries'].outputs={linux:'success',app_server:'success',app_server_rpc:'success',legacy:'success'};
  return needs;
};
test('实际YAML全部父任务与严格结果门精确一致', () => assert.deepEqual([...parents].sort(), [...REQUIRED_JOBS].sort()));
function run(needs) {
  return spawnSync(process.execPath, [gate], {
    env: { ...process.env, NEEDS_JSON: typeof needs === 'string' ? needs : JSON.stringify(needs) }, encoding: 'utf8',
  });
}

test('全部预期跑道实际成功才允许合并', () => {
  const result = run(good());
  assert.equal(result.status, 0, result.stderr);
});

for (const job of parents) {
  for (const status of ['failure', 'cancelled', 'skipped', '', 'unknown', undefined]) {
    test(`${job}=${status || '空'} 必须阻断合并`, () => {
      const needs = good();
      if (status === undefined) delete needs[job]; else needs[job].result = status;
      const result = run(needs);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, new RegExp(job));
    });
  }
}

test('缺失预期跑道、异常JSON和空对象均拒绝', () => {
  for (const needs of [{}, { plan: { result: 'success' } }, {...good(), unexpected:{result:'success'}}, 'null', '[1]', '{']) {
    assert.notEqual(run(needs).status, 0);
  }
});

 test('资源最终门只允许合法空计划跳过，必选 step 级跳过也拒绝',()=>{
   const needs=good(); needs['resource-canaries']={result:'skipped'};
   assert.notEqual(run(needs).status,0);
   needs.plan.outputs.resource_plan=JSON.stringify({linux:false,app_server:false,legacy:false});
   assert.equal(run(needs).status,0);
   for(const encoded of ['', '{}','null','{','{"linux":false,"app_server":false,"legacy":false,"not_applicable":true}']) {
     needs.plan.outputs.resource_plan=encoded; assert.notEqual(run(needs).status,0);
   }
   for(const field of ['linux','app_server','app_server_rpc','legacy']) {
     const required=good();required['resource-canaries'].outputs[field]='skipped';assert.notEqual(run(required).status,0);
     delete required['resource-canaries'].outputs[field];assert.notEqual(run(required).status,0);
   }
   const missing=good();delete missing.plan.outputs;assert.notEqual(run(missing).status,0);
 });
