import assert from 'node:assert/strict';
import { readFileSync, copyFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync, realpathSync, symlinkSync, existsSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { planChecks } from '../basic-scope.mjs';
import { commandsFor } from '../run-basic-check.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(import.meta.url);
const versionEntry = '实际PR必须通过现仓库Brain版本策略';
const versionTestPath = 'scripts/ci/__tests__/basic-brain-version-policy.test.mjs';
test(versionEntry, t => {
  const eventName = process.env.GITHUB_EVENT_NAME;
  if (eventName !== 'pull_request') {
    assert.ok(eventName === undefined && process.env.GITHUB_ACTIONS !== 'true' ||
      ['push', 'workflow_dispatch', 'workflow_call', 'workflow_run', 'schedule'].includes(eventName), 'PR_VERSION_EVENT');
    t.diagnostic(`not_applicable: PR-only Brain version policy (${eventName || 'local'})`);
    return;
  }
  let pr;
  try { pr = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')).pull_request; }
  catch { assert.fail('PR_VERSION_EVENT: missing or malformed event'); }
  const base = pr?.base?.sha, head = pr?.head?.sha;
  assert.ok([base, head].every(sha => typeof sha === 'string' && /^[0-9a-f]{40}$/.test(sha)), 'PR_VERSION_EVENT');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  Object.assign(env, { GIT_NO_REPLACE_OBJECTS: '1', GIT_GRAFT_FILE: '/dev/null',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', BASE_REF: base });
  const git = (...args) => {
    const result = spawnSync('git', ['--no-replace-objects', '-c', 'core.hooksPath=/dev/null', ...args],
      { cwd: root, env, encoding: 'utf8', timeout: 10000 });
    assert.ok(!result.error && !result.signal && result.status === 0, `PR_VERSION_GIT: ${result.stderr || result.error || result.signal}`);
    return result.stdout.trim();
  };
  for (const revision of [base, head]) assert.equal(git('cat-file', '-t', revision), 'commit', 'PR_VERSION_GIT');
  git('merge-base', base, head);
  const checkout = git('rev-parse', 'HEAD');
  if (checkout !== head) assert.deepEqual(git('show', '-s', '--format=%P', 'HEAD').split(' '), [base, head], 'PR_VERSION_GIT: checkout is not this PR');
  assert.equal(git('status', '--porcelain=v1', '--untracked-files=no'), '', 'PR_VERSION_GIT: dirty checkout');
  const result = spawnSync('bash', ['scripts/ci/check-brain-version-bump.sh'],
    { cwd: root, env, encoding: 'utf8', timeout: 20000, killSignal: 'SIGKILL' });
  if (result.error) throw result.error;
  assert.equal(result.signal, null, `PR_VERSION_GUARD: signal ${result.signal}`);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  t.diagnostic(`PR_VERSION_GUARD: checked actual checkout ${checkout} against fixed base ${base}`);
});

function versionFixture(t, { version = '1.0.0', fragment = false } = {}) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'brain-version-entry-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'CI test', GIT_AUTHOR_EMAIL: 'ci@example.invalid',
    GIT_COMMITTER_NAME: 'CI test', GIT_COMMITTER_EMAIL: 'ci@example.invalid' };
  delete env.NODE_TEST_CONTEXT;
  for (const key of Object.keys(env)) if (key.startsWith('GIT_') && !['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM',
    'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'].includes(key)) delete env[key];
  const git = (...args) => {
    const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0', ...args],
      { cwd: directory, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const put = (path, bytes) => { mkdirSync(dirname(join(directory, path)), { recursive: true }); writeFileSync(join(directory, path), bytes); };
  for (const path of [versionTestPath, 'scripts/ci/basic-scope.mjs', 'scripts/ci/run-basic-check.mjs',
    'scripts/ci/ops-checks.mjs', 'scripts/ci/check-brain-version-bump.sh', '.github/workflows/ci.yml']) {
    mkdirSync(dirname(join(directory, path)), { recursive: true }); copyFileSync(join(root, path), join(directory, path));
  }
  put('package.json', '{"type":"module"}');
  put('packages/brain/package.json', '{"version":"1.0.0"}');
  put('packages/brain/src/probe.js', '// base\n');
  git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  git('checkout', '-qb', 'cp-version-fixture');
  put('packages/brain/package.json', JSON.stringify({ version }));
  put('packages/brain/src/probe.js', '// actual source change\n');
  if (fragment) put('changes/fixture.md', '## Brain {VERSION} — fixture\n');
  git('add', '.'); git('commit', '-qm', 'source change');
  const head = git('rev-parse', 'HEAD');
  symlinkSync(require.resolve('js-yaml/package.json').replace(/\/js-yaml\/package\.json$/, ''), join(directory, 'node_modules'));
  const event = { pull_request: { base: { sha: base }, head: { sha: head } } };
  const run = (body = event, overrides = {}) => {
    const eventPath = join(directory, 'event.json');
    writeFileSync(eventPath, typeof body === 'string' ? body : JSON.stringify(body));
    return spawnSync(process.execPath, ['--test', `--test-name-pattern=^${versionEntry}$`, versionTestPath], {
      cwd: directory, encoding: 'utf8', timeout: 20000,
      env: { ...env, GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: eventPath, ...overrides },
    });
  };
  return { directory, git, event, run, env };
}

for (const [version, fragment, accepted] of [['1.0.0', false, false], ['0.9.9', false, false],
  ['1.0.1', false, true], ['1.0.0', true, true]]) {
  test(`真实自动入口检查实际PR：version=${version},fragment=${fragment}`, t => {
    const result = versionFixture(t, { version, fragment }).run();
    assert.equal(result.error, undefined); assert.equal(result.signal, null);
    assert.equal(result.status === 0, accepted, result.stdout + result.stderr);
    assert.match(result.stdout, new RegExp(versionEntry));
    assert.match(result.stdout, accepted ? /# pass 1\b/ : /版本未 bump/);
  });
}

test('真实PR入口拒绝坏event、缺失base对象与不属于checkout的head', t => {
  const f = versionFixture(t, { version: '1.0.1' });
  for (const body of ['{', {}, { pull_request: { base: { sha: '--help' }, head: f.event.pull_request.head } },
    { pull_request: { base: { sha: '0'.repeat(40) }, head: f.event.pull_request.head } },
    { pull_request: { base: { sha: f.git('rev-parse', 'HEAD:packages/brain/package.json') }, head: f.event.pull_request.head } },
    { pull_request: { base: f.event.pull_request.base, head: f.event.pull_request.base } }]) {
    const result = f.run(body);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /PR_VERSION_EVENT|PR_VERSION_GIT/);
  }
  for (const overrides of [{ GITHUB_EVENT_NAME: 'unknown-event' }, { GITHUB_EVENT_NAME: undefined },
    { GITHUB_EVENT_PATH: join(f.directory, 'missing-event.json') }]) {
    const result = f.run(f.event, overrides);
    assert.equal(result.status, 1, result.stdout + result.stderr); assert.match(result.stdout, /PR_VERSION_EVENT/);
  }
});

test('真实PR入口支持实际合并checkout，非PR明确不适用且不注册skip', t => {
  const f = versionFixture(t, { version: '1.0.1' });
  f.git('checkout', '-qb', 'merge-checkout', f.event.pull_request.base.sha);
  f.git('merge', '--no-ff', '-qm', 'test merge', f.event.pull_request.head.sha);
  const merged = f.run();
  assert.equal(merged.status, 0, merged.stdout + merged.stderr); assert.match(merged.stdout, /# pass 1\b/);
  for (const eventName of ['push', 'workflow_dispatch']) {
    const result = f.run({}, { GITHUB_EVENT_NAME: eventName });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /not_applicable: PR-only Brain version policy/);
    assert.match(result.stdout, /# pass 1\b/);
    assert.match(result.stdout, /# skipped 0\b/);
    assert.doesNotMatch(result.stdout, /checked actual checkout/);
  }
});

test('实际guard的signal与启动错误必须阻断，不能将null状态当作成功', t => {
  const signalled = versionFixture(t, { version: '1.0.1' });
  writeFileSync(join(signalled.directory, 'scripts/ci/check-brain-version-bump.sh'), '#!/bin/bash\nkill -TERM "$$"\n');
  signalled.git('add', '.'); signalled.git('commit', '-qm', 'guard signal fixture');
  signalled.event.pull_request.head.sha = signalled.git('rev-parse', 'HEAD');
  const signal = signalled.run();
  assert.equal(signal.status, 1, signal.stdout + signal.stderr); assert.match(signal.stdout, /PR_VERSION_GUARD: signal SIGTERM/);
  const missingBash = versionFixture(t, { version: '1.0.1' });
  const bin = join(missingBash.directory, 'git-only'); mkdirSync(bin);
  symlinkSync('/usr/bin/git', join(bin, 'git'));
  const error = missingBash.run(missingBash.event, { PATH: bin });
  assert.equal(error.status, 1, error.stdout + error.stderr); assert.match(error.stdout, /spawnSync bash ENOENT/);
});

test('真实guard拦截TERM也必须超时失败并收尾本人进程组', async t => {
  const f = versionFixture(t, { version: '1.0.1' }), entry = join(f.directory, versionTestPath);
  const source = readFileSync(entry, 'utf8'), budget = /(cwd: root, env, encoding: 'utf8', timeout: )20000/g;
  assert.equal([...source.matchAll(budget)].length, 1);
  // 仅私有副本缩短真实期限；实际入口仍保留20秒预算及全部校验。
  writeFileSync(entry, source.replace(budget, (_match, prefix) => prefix + '100'));
  const guard = 'scripts/ci/check-brain-version-bump.sh';
  writeFileSync(join(f.directory, guard), '#!/usr/bin/env bash\ntrap "" TERM\nprintf ready > "${VERSION_TEST_READY:?}"\nwhile :; do :; done\n');
  f.git('add', '--', versionTestPath, guard); f.git('commit', '-qm', 'TERM guard fixture');
  f.event.pull_request.head.sha = f.git('rev-parse', 'HEAD');
  const eventPath = join(f.directory, 'event.json'), ready = join(f.directory, 'guard-ready');
  writeFileSync(eventPath, JSON.stringify(f.event));
  const child = spawn(process.execPath, ['--test', `--test-name-pattern=^${versionEntry}$`, versionTestPath], {
    cwd: f.directory, detached: true,
    env: { ...f.env, GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: eventPath, VERSION_TEST_READY: ready },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const kill = () => { if (child.pid) try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
  let expired = false, output = '';
  child.stdout.on('data', bytes => { output += bytes; }); child.stderr.on('data', bytes => { output += bytes; });
  const timer = setTimeout(() => { expired = true; kill(); }, 2000);
  try {
    const result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
    assert.ok(existsSync(ready), output); assert.equal(expired, false, 'guard ignored its timeout');
    assert.equal(result.code, 1, output); assert.equal(result.signal, null); assert.match(output, /ETIMEDOUT/);
  } finally { clearTimeout(timer); kill(); }
});

test('正式scripts入口自动选择新的实际PR版本策略文件且不使用名称过滤', () => {
  const steps = commandsFor('scripts');
  assert.equal(steps[0].command, 'node');
  assert.equal(steps[0].args[0], '--test');
  assert.equal(steps[0].args.filter(path => path === versionTestPath).length, 1);
  assert.ok(!steps[0].args.some(arg => arg.startsWith('--test-name-pattern')));
  assert.ok(planChecks([versionTestPath]).some(row => row.component === 'scripts'));
});
