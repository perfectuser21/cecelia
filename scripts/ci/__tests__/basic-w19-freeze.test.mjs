import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, symlinkSync, chmodSync, cpSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { planChecks } from '../basic-scope.mjs';
import { commandsFor } from '../run-basic-check.mjs';

const BASE = '289ddd8d0690f154006c5586926277c48e10f716';
const root = fileURLToPath(new URL('../../../', import.meta.url));
let home, fixture;
// Git定位、索引及全局配置不能从调用prepush的仓库继承。
const gitEnv = { ...process.env };
for (const name of Object.keys(gitEnv)) if (name.startsWith('GIT_')) delete gitEnv[name];
gitEnv.GIT_CONFIG_GLOBAL = '/dev/null'; gitEnv.GIT_CONFIG_SYSTEM = '/dev/null';
const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args],
  { cwd: fixture || root, env: gitEnv, encoding: 'utf8' }).trim();
before(() => {
  home = mkdtempSync(join(tmpdir(), 'w19-frozen-'));
  fixture = join(home, 'source');
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', 'worktree', 'add', '--detach', fixture, BASE],
    { cwd: root, env: gitEnv, stdio: 'pipe' });
});
beforeEach(() => {
  git('reset', '--hard', BASE);
  writeFileSync(join(fixture, 'playground/README.md'), readFileSync(join(root, 'playground/README.md')));
});
after(() => {
  if (fixture) execFileSync('git', ['-c', 'core.hooksPath=/dev/null', 'worktree', 'remove', '--force', fixture], { cwd: root, env: gitEnv });
  if (home) rmSync(home, { recursive: true, force: true });
});

function check() {
  const step = commandsFor('scripts').find(step => step.command === 'node'
    && step.args[0] === 'scripts/ci/check-w19-frozen.mjs');
  assert.ok(step, '实际scripts跑道必须调用冻结检查，不能以无应用矩阵冒充通过');
  return spawnSync(process.execPath, [join(root, step.args[0]), '--root', fixture],
    { encoding: 'utf8', timeout: 10000, env: gitEnv });
}

test('旧样机的代码/依赖/配置/新增路径只选scripts，普通全量矩阵保持14项', () => {
  for (const path of ['playground/server.js', 'playground/package.json', 'playground/package-lock.json',
    'playground/vitest.config.js', 'playground/new-code.js', 'playground/README.md']) {
    assert.deepEqual(planChecks([path]), [{ component: 'scripts' }], path);
  }
  assert.equal(planChecks([], { full: true }).length, 14);
  assert.equal(planChecks([], { full: true }).some(row => row.component === 'playground'), false);
});

test('实际冻结字节及带历史身份的资料更新可通过，检查必达', () => {
  writeFileSync(join(fixture, 'playground/README.md'), readFileSync(join(root, 'playground/README.md'), 'utf8')
    + '\n历史来源补充：未声称现役部署。\n');
  const result = check();
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /W19_FROZEN_OK/);
});

for (const kind of ['dependency', 'old-code', 'delete', 'new-file', 'symlink', 'parent-symlink', 'executable']) {
  test(`真实tracked非文档${kind}变化必须拒绝`, () => {
    const server = join(fixture, 'playground/server.js');
    if (kind === 'dependency') writeFileSync(join(fixture, 'playground/package.json'), '{"name":"changed"}\n');
    if (kind === 'old-code') writeFileSync(server, readFileSync(server, 'utf8') + '\n// changed frozen implementation\n');
    if (kind === 'delete') rmSync(server);
    if (kind === 'new-file') {
      writeFileSync(join(fixture, 'playground/new-code.js'), 'export const newExecution=true;\n');
      git('add', 'playground/new-code.js');
    }
    if (kind === 'symlink') { rmSync(server); symlinkSync('/tmp/not-owned-playground', server); }
    if (kind === 'parent-symlink') {
      const source = join(fixture, 'playground/tests'), foreign = join(home, 'foreign-tests');
      cpSync(source, foreign, { recursive: true });
      rmSync(source, { recursive: true });
      symlinkSync(foreign, source);
    }
    if (kind === 'executable') chmodSync(server, 0o755);
    const result = check();
    assert.ifError(result.error);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /W19_FROZEN_DRIFT/);
  });
}

test('不能移除历史角色声明后将样机冒称现役', () => {
  writeFileSync(join(fixture, 'playground/README.md'), '# 当前生产服务\n');
  const result = check();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /W19_FROZEN_ROLE/);
});

test('冻结基准必须是当前候选真实祖先，不接受无关历史', () => {
  const tree = execFileSync('git', ['-c', 'core.hooksPath=/dev/null', 'hash-object', '-t', 'tree', '--stdin'],
    { cwd: fixture, env: gitEnv, input: '', encoding: 'utf8' }).trim();
  const unrelated = git('-c', 'user.name=Owned Fixture', '-c', 'user.email=fixture@example.invalid',
    'commit-tree', tree, '-m', 'test: unrelated history');
  git('checkout', '--detach', '--force', unrelated);
  const result = check();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /W19_FROZEN_BASELINE/);
});


// 运行真实源测试，故意从另一个完全owned仓库/索引继承Git定位与hook配置。
test('真实源fixture隔离继承Git环境，foreign脏文件和索引不变且hook零执行', () => {
  const owned = mkdtempSync(join(tmpdir(), 'w19-foreign-'));
  const foreign = join(owned, 'foreign'), hooks = join(owned, 'hooks');
  const marker = join(owned, 'hook-ran'), sentinel = join(foreign, 'sentinel.txt');
  const foreignIndex = join(owned, 'foreign.index'), config = join(owned, 'gitconfig');
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.startsWith('GIT_')) delete env[name];
  env.GIT_CONFIG_GLOBAL = '/dev/null'; env.GIT_CONFIG_SYSTEM = '/dev/null';
  delete env.NODE_TEST_CONTEXT;
  const run = (cwd, args, input) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args],
    { cwd, env, encoding: 'utf8', input }).trim();
  try {
    mkdirSync(foreign); mkdirSync(hooks);
    run(foreign, ['init', '-q']);
    const common = run(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    writeFileSync(join(foreign, '.git', 'objects', 'info', 'alternates'), join(common, 'objects') + '\n');
    const blob = run(foreign, ['hash-object', '-w', '--stdin'], 'owned committed sentinel\n');
    run(foreign, ['update-index', '--add', '--cacheinfo', '100644', blob, 'sentinel.txt']);
    const tree = run(foreign, ['write-tree']);
    const commit = run(foreign, ['-c', 'user.name=Owned Fixture', '-c', 'user.email=fixture@example.invalid',
      'commit-tree', tree, '-p', BASE, '-m', 'test: owned foreign sentinel']);
    run(foreign, ['update-ref', 'HEAD', commit]);
    writeFileSync(sentinel, 'owned dirty sentinel must survive\n');
    cpSync(join(foreign, '.git', 'index'), foreignIndex);
    const originalIndex = readFileSync(foreignIndex);
    writeFileSync(config, '[core]\n hooksPath = ' + hooks + '\n');
    writeFileSync(join(hooks, 'post-checkout'), '#!/bin/sh\nprintf hook > "' + marker + '"\n', { mode: 0o700 });
    const child = spawnSync(process.execPath, ['--test',
      '--test-name-pattern=实际冻结字节及|冻结基准必须', fileURLToPath(import.meta.url)], {
      cwd: root, timeout: 30000, encoding: 'utf8',
      env: { ...env, GIT_DIR: join(foreign, '.git'), GIT_WORK_TREE: foreign,
        GIT_INDEX_FILE: foreignIndex, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_SYSTEM: config },
    });
    assert.ifError(child.error);
    assert.deepEqual({ exit: child.status,
      dirtySentinel: existsSync(sentinel) ? readFileSync(sentinel, 'utf8') : null,
      indexUnchanged: readFileSync(foreignIndex).equals(originalIndex), hookRan: existsSync(marker),
      positivePassed: /# pass 2(?:\n|\r)/.test(child.stdout),
      machineReadableTap: /^TAP version 13$/m.test(child.stdout),
    }, { exit: 0, dirtySentinel: 'owned dirty sentinel must survive\n', indexUnchanged: true,
      hookRan: false, positivePassed: true, machineReadableTap: true });
  } finally { rmSync(owned, { recursive: true, force: true }); }
});
