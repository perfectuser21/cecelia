import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { commandsFor } from '../run-basic-check.mjs';

const imageSteps = () => commandsFor('image');
test('镜像检查真实执行Node版本断言，期望值来自运行checker的Node', () => {
  const step = imageSteps().find(step => step.args.some(arg => arg.startsWith('EXPECTED_NODE_MAJOR=')));
  assert.ok(step, 'image必须包含容器Node与CI主版本一致性检查');
  assert.equal(step.command, 'docker');
  assert.ok(step.args.includes('--rm'));
  assert.deepEqual(step.args.slice(step.args.indexOf('--network'), step.args.indexOf('--network') + 2), ['--network', 'none']);
  const expected = process.versions.node.split('.')[0];
  assert.ok(step.args.includes(`EXPECTED_NODE_MAJOR=${expected}`));
  const source = step.args[step.args.indexOf('-e', step.args.indexOf('--entrypoint')) + 1];
  assert.equal(typeof source, 'string');
  const run = major => spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    encoding: 'utf8', env: { ...process.env, EXPECTED_NODE_MAJOR: major },
  });
  const good = run(expected);
  assert.equal(good.status, 0, good.stderr);
  const wrong = run(String(Number(expected) + 1));
  assert.notEqual(wrong.status, 0, '主版本不一致必须真实失败');
  assert.match(wrong.stderr, /Brain image Node major must match CI/);
});
