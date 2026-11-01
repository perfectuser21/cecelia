import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const gate = new URL('../check-basic-results.mjs', import.meta.url).pathname;
const good = () => ({ plan: { result: 'success' }, security: { result: 'success' }, checks: { result: 'success' } });
function run(needs) {
  return spawnSync(process.execPath, [gate], {
    env: { ...process.env, NEEDS_JSON: typeof needs === 'string' ? needs : JSON.stringify(needs) }, encoding: 'utf8',
  });
}

test('全部预期跑道实际成功才允许合并', () => {
  const result = run(good());
  assert.equal(result.status, 0, result.stderr);
});

for (const job of ['plan', 'security', 'checks']) {
  for (const status of ['failure', 'cancelled', 'skipped', '', 'unknown']) {
    test(`${job}=${status || '空'} 必须阻断合并`, () => {
      const needs = good();
      needs[job].result = status;
      const result = run(needs);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, new RegExp(job));
    });
  }
}

test('缺失预期跑道、异常JSON和空对象均拒绝', () => {
  for (const needs of [{}, { plan: { result: 'success' } }, 'null', '[1]', '{']) {
    assert.notEqual(run(needs).status, 0);
  }
});
