import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, symlinkSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { planChecks } from '../basic-scope.mjs';
import { commandsFor } from '../run-basic-check.mjs';

const BASE = '289ddd8d0690f154006c5586926277c48e10f716';
const root = fileURLToPath(new URL('../../../', import.meta.url));
let home, fixture;
const git = (...args) => execFileSync('git', args, { cwd: fixture || root, encoding: 'utf8' }).trim();
before(() => {
  home = mkdtempSync(join(tmpdir(), 'w19-frozen-'));
  fixture = join(home, 'source');
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', 'worktree', 'add', '--detach', fixture, BASE],
    { cwd: root, stdio: 'pipe' });
});
beforeEach(() => {
  git('reset', '--hard', BASE);
  writeFileSync(join(fixture, 'playground/README.md'), readFileSync(join(root, 'playground/README.md')));
});
after(() => {
  if (fixture) execFileSync('git', ['worktree', 'remove', '--force', fixture], { cwd: root });
  if (home) rmSync(home, { recursive: true, force: true });
});

function check() {
  const step = commandsFor('scripts').find(step => step.command === 'node'
    && step.args[0] === 'scripts/ci/check-w19-frozen.mjs');
  assert.ok(step, '实际scripts跑道必须调用冻结检查，不能以无应用矩阵冒充通过');
  return spawnSync(process.execPath, [join(root, step.args[0]), '--root', fixture],
    { encoding: 'utf8', timeout: 10000 });
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

for (const kind of ['dependency', 'old-code', 'delete', 'new-file', 'symlink', 'executable']) {
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
  const tree = execFileSync('git', ['hash-object', '-t', 'tree', '--stdin'],
    { cwd: fixture, input: '', encoding: 'utf8' }).trim();
  const unrelated = git('-c', 'user.name=Owned Fixture', '-c', 'user.email=fixture@example.invalid',
    'commit-tree', tree, '-m', 'test: unrelated history');
  git('checkout', '--detach', '--force', unrelated);
  const result = check();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /W19_FROZEN_BASELINE/);
});
