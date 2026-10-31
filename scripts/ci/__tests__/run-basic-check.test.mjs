import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync, mkdirSync, copyFileSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const runner = new URL('../run-basic-check.mjs', import.meta.url).href;
const cli = new URL('../run-basic-check.mjs', import.meta.url);

test('未知组件不能无操作成功', () => {
  const result = spawnSync(process.execPath, [cli.pathname, 'unknown-component'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
});

test('可以列出真实组件检查命令，单测直接运行而不解析日志', () => {
  const result = spawnSync(process.execPath, [cli.pathname, '--list', 'brain-unit', '1'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const steps = JSON.parse(result.stdout);
  assert.ok(steps.length > 0);
  assert.ok(steps.some(step => step.args.includes('--shard=1/6')));
  assert.ok(steps.every(step => !step.args.some(arg => /treating as success|grep.*passed/.test(arg))));
});

function fixture(source, directory) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { runSteps } from ${JSON.stringify(runner)};
    const code = runSteps(${source}, { cwd: ${JSON.stringify(directory)}, stdio: 'pipe' });
    process.exitCode = code;
  `], { encoding: 'utf8' });
}

function command(source) {
  return JSON.stringify({ command: process.execPath, args: ['-e', source] });
}

test('真实子进程正常完成才能通过', () => {
  const result = fixture(`[${command('console.log("Tests 1 passed")')}]`, tmpdir());
  assert.equal(result.status, 0, result.stderr);
});

test('通过摘要后发生未处理异常仍然失败', () => {
  const result = fixture(`[${command('console.log("Tests 1 passed"); throw Error("teardown failed")')}]`, tmpdir());
  assert.equal(result.status, 1);
  assert.match(result.stderr, /teardown failed/);
});

test('保留真实失败码并停止后续检查', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ci-basic-exit-'));
  try {
    const marker = join(directory, 'must-not-run');
    const result = fixture(`[${command('process.exit(23)')}, ${command(`require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`)}]`, directory);
    assert.equal(result.status, 23, result.stderr);
    assert.equal(existsSync(marker), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('进程被信号终止不能通过', () => {
  const result = fixture(`[${command('process.kill(process.pid, "SIGTERM")')}]`, tmpdir());
  assert.notEqual(result.status, 0);
});

test('命令不存在必须失败', () => {
  const result = fixture('[{"command":"cecelia-nonexistent-ci-command","args":[]}]', tmpdir());
  assert.notEqual(result.status, 0);
});

test('空检查集合必须失败', () => {
  const result = fixture('[]', tmpdir());
  assert.notEqual(result.status, 0);
});


test('API真实数据库合同使用独立完整集成配置，不能归入DOM单测或空集合成功', async () => {
  const { commandsFor } = await import('../run-basic-check.mjs');
  const steps = commandsFor('api-integration');
  assert.equal(steps.length, 1);
  assert.ok(steps[0].cwd.endsWith('/apps/api'));
  assert.deepEqual(steps[0].args, ['--no-install', 'vitest', 'run', '--config', 'vitest.integration.config.ts']);
});


function isolatedScriptList(t, withFile) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'ci-script-list-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const ci = join(directory, 'scripts/ci');
  mkdirSync(join(ci, '__tests__'), { recursive: true });
  for (const name of ['run-basic-check.mjs', 'ops-checks.mjs']) copyFileSync(new URL(`../${name}`, import.meta.url), join(ci, name));
  if (withFile) writeFileSync(join(ci, '__tests__/basic-real.test.mjs'), "import {test} from 'node:test'; test('real', () => {});");
  return { directory, ci, run: () => spawnSync(process.execPath, [join(ci, 'run-basic-check.mjs'), '--list', 'scripts'], { encoding: 'utf8' }) };
}

test('Node测试发现拒绝伪装成.test.mjs的目录，不能把未证明的递归测试交给Node', t => {
  const f = isolatedScriptList(t, true);
  mkdirSync(join(f.ci, '__tests__/basic-fake.test.mjs'));
  writeFileSync(join(f.ci, '__tests__/basic-fake.test.mjs/nested.test.mjs'), 'throw new Error("must not execute");');
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /普通文件|regular file/);
});

test('Node测试发现集合为空必须失败，不能退回默认递归发现或空成功', t => {
  const f = isolatedScriptList(t, false);
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /集合为空|empty/);
});
