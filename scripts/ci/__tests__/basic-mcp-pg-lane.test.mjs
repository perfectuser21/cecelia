import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

function actualStep() {
  const workflow = yaml.load(readFileSync(new URL('../../../.github/workflows/nightly-regression.yml', import.meta.url), 'utf8'));
  const job = workflow.jobs['brain-integration'];
  assert.ok(job.services.postgres, 'MCP必须使用job自有PG');
  assert.ok(workflow.on.schedule.length > 0);
  const step = job.steps.find(value => value.run?.includes('npm run test:pg -w packages/mcp-readonly'));
  assert.ok(step, 'Nightly尚未实际执行MCP的PG合同');
  assert.equal(step.if, undefined);
  assert.equal(step['continue-on-error'], undefined);
  return step;
}

function runLane({create = 0, tests = 0, drop = 0} = {}) {
  const step = actualStep();
  const directory = mkdtempSync(join(tmpdir(), 'mcp-pg-lane-'));
  const commands = join(directory, 'commands');
  const bin = join(directory, 'bin');
  mkdirSync(bin);
  for (const [name, code] of [['createdb', create], ['npm', tests], ['dropdb', drop]]) {
    writeFileSync(join(bin, name), `#!/bin/sh\nprintf '%s\\n' '${name}' >> "$MCP_AUDIT_COMMANDS"\nexit ${code}\n`, {mode: 0o755});
  }
  const result = spawnSync('bash', ['-c', step.run], {
    cwd: directory, encoding: 'utf8', timeout: 10000,
    env: {...process.env, ...step.env, PATH: `${bin}:${process.env.PATH}`,
      GITHUB_RUN_ID: '123456', GITHUB_RUN_ATTEMPT: '2', MCP_AUDIT_COMMANDS: commands},
  });
  try {
    assert.equal(result.error, undefined);
    return {code: result.status, commands: readFileSync(commands, 'utf8').trim().split('\n'), output: result.stdout + result.stderr};
  } finally { rmSync(directory, {recursive: true, force: true}); }
}

test('Nightly真实MCP命令创建自有库、执行测试、释放本人库', () => {
  const result = runLane();
  assert.equal(result.code, 0, result.output);
  assert.deepEqual(result.commands, ['createdb', 'npm', 'dropdb']);
});

test('MCP真实测试非零必须保留失败码，并释放已创建的库', () => {
  const result = runLane({tests: 23});
  assert.equal(result.code, 23, result.output);
  assert.deepEqual(result.commands, ['createdb', 'npm', 'dropdb']);
});

test('建库失败不得执行测试或删除既有同名库', () => {
  const result = runLane({create: 12});
  assert.equal(result.code, 12, result.output);
  assert.deepEqual(result.commands, ['createdb']);
});

test('本人测试库清理失败必须报错', () => {
  const result = runLane({drop: 7});
  assert.notEqual(result.code, 0, result.output);
  assert.deepEqual(result.commands, ['createdb', 'npm', 'dropdb']);
});
