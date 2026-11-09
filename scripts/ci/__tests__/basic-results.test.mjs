import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { REQUIRED_JOBS } from '../check-basic-results.mjs';
import test from 'node:test';

const gate = new URL('../check-basic-results.mjs', import.meta.url).pathname;
const parents = yaml.load(readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8')).jobs['ci-passed'].needs;
const good = () => Object.fromEntries(parents.map(job => [job, {result:'success'}]));
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
