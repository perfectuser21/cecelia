import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync, mkdirSync, copyFileSync, writeFileSync, realpathSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const runner = new URL('../run-basic-check.mjs', import.meta.url).href;
const cli = new URL('../run-basic-check.mjs', import.meta.url);

test('现行scripts检查实际运行防复活守卫的测试注册回归', () => {
  const result = spawnSync(process.execPath, [cli.pathname, '--list', 'scripts'], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  const steps = JSON.parse(result.stdout);
  assert.ok(steps.some(step => step.command === 'node' && step.args.includes('--test')
    && step.args.includes('scripts/ci/__tests__/basic-test-registration.test.mjs')));
});

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

test('迁后的开发工具由实际scripts CI执行，失败不能继续事实检查', t => {
  const f = isolatedScriptList(t, true);
  mkdirSync(join(f.directory, 'scripts/dev'), {recursive: true});
  writeFileSync(join(f.directory, 'scripts/dev/check.mjs'), 'throw Error("private dev guard failure");');
  const planned = f.run();
  assert.equal(planned.status, 0, planned.stderr);
  const steps = JSON.parse(planned.stdout).filter(step => step.args.includes('scripts/dev/check.mjs'));
  assert.equal(steps.length, 1, '迁后的守卫和worktree真实回归必须被CI执行一次');
  const marker = join(f.directory, 'must-not-run');
  const result = fixture(JSON.stringify([...steps, {command: process.execPath,
    args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`]}]), f.directory);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /private dev guard failure/);
  assert.equal(existsSync(marker), false);
});

const smokeSafetyDirectory = 'packages/brain/scripts/smoke/__tests__';
function isolatedBrainSafety(t) {
  const f = isolatedScriptList(t, false);
  mkdirSync(join(f.directory, 'packages/brain/scripts/fleet-worker'), { recursive: true });
  writeFileSync(join(f.directory, 'packages/brain/scripts/fleet-worker/private.test.sh'), 'exit 0\n');
  const suite = join(f.directory, smokeSafetyDirectory);
  mkdirSync(suite, { recursive: true });
  const list = (shard = '1') => spawnSync(process.execPath,
    [join(f.ci, 'run-basic-check.mjs'), '--list', 'brain-unit', shard], { encoding: 'utf8' });
  const run = steps => {
    const env = { ...process.env };
    // 子Node --test是独立真实执行，不能继承当前test runner的进程上下文。
    delete env.NODE_TEST_CONTEXT;
    return spawnSync(process.execPath, ['--input-type=module', '-e', `
      const {runSteps} = await import(${JSON.stringify(new URL(`file://${join(f.ci, 'run-basic-check.mjs')}`).href)});
      process.exitCode = runSteps(${JSON.stringify(steps)}, {stdio: 'pipe'});
    `], { cwd: f.directory, encoding: 'utf8', env });
  };
  return { ...f, suite, list, run };
}

test('Brain六分片只在第一片显式执行全部顶层Smoke安全测试各一次，不递归fixtures', t => {
  const f = isolatedBrainSafety(t);
  const marker = join(f.directory, 'executed');
  for (const name of ['z.node-test.mjs', 'a.node-test.mjs']) writeFileSync(join(f.suite, name),
    `import {appendFileSync} from 'node:fs'; appendFileSync(${JSON.stringify(marker)}, '${name}\\n');\n`);
  mkdirSync(join(f.suite, 'fixtures'));
  writeFileSync(join(f.suite, 'fixtures/nested.node-test.mjs'), 'throw Error("fixture must not execute");');
  writeFileSync(join(f.suite, 'unrelated.test.js'), 'throw Error("unselected test must not execute");');
  const suites = [];
  for (let shard = 1; shard <= 6; shard++) {
    const result = f.list(String(shard));
    assert.equal(result.status, 0, result.stderr);
    suites.push(...JSON.parse(result.stdout).filter(step => step.command === 'node' && step.args[0] === '--test'));
  }
  assert.equal(suites.length, 1, 'Safety suite must run once across the six Brain shards');
  assert.deepEqual(suites[0].args, ['--test', `${smokeSafetyDirectory}/a.node-test.mjs`, `${smokeSafetyDirectory}/z.node-test.mjs`]);
  const result = f.run(suites);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readFileSync(marker, 'utf8').trim().split('\n').sort(), ['a.node-test.mjs', 'z.node-test.mjs']);
});

test('Brain Smoke安全测试集合为空时拒绝，不以Node默认发现替代', t => {
  const f = isolatedBrainSafety(t);
  writeFileSync(join(f.suite, 'unrelated.test.js'), 'throw Error("unselected");');
  const result = f.list();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /集合为空|empty/);
});

for (const kind of ['directory', 'symlink']) test(`Brain Smoke安全测试拒绝伪装入口：${kind}`, t => {
  const f = isolatedBrainSafety(t);
  writeFileSync(join(f.suite, 'real.node-test.mjs'), '');
  const fake = join(f.suite, 'fake.node-test.mjs');
  if (kind === 'directory') mkdirSync(fake);
  else symlinkSync(join(f.suite, 'real.node-test.mjs'), fake);
  const result = f.list();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /普通文件|regular file/);
});

test('Brain实际发现的Smoke安全测试失败时传播失败并停止后续检查', t => {
  const f = isolatedBrainSafety(t);
  writeFileSync(join(f.suite, 'failure.node-test.mjs'), 'throw Error("private safety assertion failed");');
  const planned = f.list();
  assert.equal(planned.status, 0, planned.stderr);
  const safety = JSON.parse(planned.stdout).filter(step => step.command === 'node' && step.args[0] === '--test');
  assert.equal(safety.length, 1, 'discovered safety tests must enter the real Brain command chain');
  const marker = join(f.directory, 'must-not-run');
  const result = f.run([...safety, { command: process.execPath, args: ['-e',
    `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`] }]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /private safety assertion failed/);
  assert.equal(existsSync(marker), false);
});
