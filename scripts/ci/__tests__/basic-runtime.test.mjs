import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = new URL('../basic-runtime-smoke.mjs', import.meta.url).pathname;

for (const database of ['cecelia', 'production', 'cecelia_staging']) {
  test(`运行验收拒绝连接非专用 scratch 数据库：${database}`, () => {
    const result = spawnSync(process.execPath, [script], {
      env: { ...process.env, DATABASE_URL: `postgresql://ci:ci@127.0.0.1:1/${database}` }, encoding: 'utf8', timeout: 5000,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /只允许本机专用 cecelia_scratch/);
  });
}

test('即使名字为scratch也拒绝远端数据库', () => {
  const result = spawnSync(process.execPath, [script], {
    env: { ...process.env, DATABASE_URL: 'postgresql://ci:ci@production.example:5432/cecelia_scratch' }, encoding: 'utf8', timeout: 5000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /只允许本机专用 cecelia_scratch/);
});
