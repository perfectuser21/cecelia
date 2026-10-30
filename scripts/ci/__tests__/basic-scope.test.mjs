import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {planChecks} from '../basic-scope.mjs';

const cli = fileURLToPath(new URL('../basic-scope.mjs', import.meta.url));
const components = rows => [...new Set(rows.map(row => row.component))];
const all = ['brain-unit', 'brain-integration', 'image', 'engine', 'quality', 'mcp', 'api', 'dashboard', 'ops', 'scripts'];

test('全量只覆盖现役组件；旧frontend自身改动仍明确验证', () => {
  assert.equal(planChecks([], {full: true}).some(row => row.component === 'frontend'), false);
  assert.deepEqual(components(planChecks(['frontend/src/App.tsx'])), ['frontend', 'scripts']);
  assert.ok(components(planChecks(['frontend/vite.config.ts'])).includes('frontend'));
});

test('文档改动仍运行基础 CI 回归，且不触发应用测试', () => {
  assert.deepEqual(planChecks(['docs/guide.md', 'README.md', 'docs/diagram.svg']), [{component: 'scripts'}]);
});

test('Android改动必须执行真实Android单测，不能用JS测试替代', () => {
  assert.deepEqual(components(planChecks(['apps/android-agent/app/src/main/java/Agent.kt'])), ['android', 'scripts']);
  assert.ok(components(planChecks(['apps/android-agent/tsconfig.json'])).includes('android'));
});

test('Brain、Engine 与 API 共享依赖，完整运行相关组件与六个 Brain 分片', () => {
  for (const path of ['packages/brain/src/routes.js', 'packages/engine/src/index.ts', 'apps/api/src/index.ts']) {
    const rows = planChecks([path]);
    assert.deepEqual(components(rows), ['brain-unit', 'brain-integration', 'image', 'engine', 'api', 'ops', 'scripts']);
    assert.deepEqual(rows.filter(row => row.component === 'brain-unit').map(row => row.shard), [1, 2, 3, 4, 5, 6]);
  }
});

test('独立组件选择完整测试范围，结果去重且顺序稳定', () => {
  const paths = ['apps/dashboard/src/App.tsx', 'frontend/src/App.tsx', 'packages/quality/tests/guard.test.js', 'packages/mcp-readonly/server.js'];
  const expected = ['quality', 'mcp', 'dashboard', 'frontend', 'scripts'];
  assert.deepEqual(components(planChecks(paths)), expected);
  assert.deepEqual(planChecks([...paths].reverse().concat(paths)), planChecks(paths));
});

test('共享脚本、根依赖与任意层级测试或编译配置改动都运行全量', () => {
  for (const path of ['.github/actions/action.yml', 'scripts/ci/basic-scope.mjs', 'config/test.json',
    'package.json', 'package-lock.json', 'npm-shrinkwrap.json', '.npmrc', '.skills-source.json',
    'packages/brain/vitest.config.js', 'packages/brain/vitest.integration.config.js',
    'apps/api/tsconfig.build.json', 'apps/api/eslint.config.js',
    'packages/brain/.eslintrc.json', 'apps/dashboard/vite.config.ts']) {
    assert.deepEqual(components(planChecks([path])), all, path);
  }
});

test('未知可执行路径、未知包和文档目录内代码都保守运行全量', () => {
  for (const path of ['packages/new-service/main.js', 'tools/helper.py', 'docker/runner/Dockerfile', 'new-folder/data.json', 'docs/example.js']) {
    assert.deepEqual(components(planChecks([path])), all, path);
  }
});

test('非法输入不能静默当作无变更', () => {
  for (const input of [[], null, 'README.md', [''], ['../file'], ['/file'], ['a/../file'], ['a\0b'], [42], ['a//b']]) {
    assert.throws(() => planChecks(input), /path|路径/i, JSON.stringify(input));
  }
  assert.deepEqual(components(planChecks([], {full: true})), all);
  assert.throws(() => planChecks(['../file'], {full: true}), /path|路径/i);
});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'basic-scope-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'core.hooksPath=/dev/null', ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  git('init', '-q');
  const commit = (path, content) => {
    mkdirSync(dirname(join(root, path)), {recursive: true});
    writeFileSync(join(root, path), content);
    git('add', '.');
    git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  return {root, git, commit};
}

test('CLI 使用真实 Git 差分及 NUL 路径，输出单行 Actions matrix', t => {
  const f = fixture(t);
  const base = f.commit('README.md', 'base');
  const head = f.commit('apps/dashboard/src/a file\nname.tsx', 'export default 1;');
  const output = join(f.root, 'actions-output');
  const result = spawnSync(process.execPath, [cli, '--base', base, '--head', head], {cwd: f.root, encoding: 'utf8', env: {...process.env, GITHUB_OUTPUT: output}});
  assert.equal(result.status, 0, result.stderr);
  const matrix = JSON.parse(result.stdout);
  assert.deepEqual(matrix, {include: [{component: 'dashboard'}, {component: 'scripts'}]});
  assert.equal(readFileSync(output, 'utf8'), `matrix=${JSON.stringify(matrix)}\n`);
});

test('主分支全量仍读取真实差分并补上本次修改的客户端', t => {
  const f = fixture(t);
  const base = f.commit('README.md', 'base');
  f.commit('frontend/src/legacy.tsx', 'export default 1;');
  const head = f.commit('apps/android-agent/app/src/Agent.kt', 'class Agent');
  const result = spawnSync(process.execPath, [cli, '--full', '--base', base, '--head', head], { cwd: f.root, encoding: 'utf8', env: {...process.env, GITHUB_OUTPUT: ''} });
  assert.equal(result.status, 0, result.stderr);
  const selected = components(JSON.parse(result.stdout).include);
  assert.ok(selected.includes('android'));
  assert.ok(selected.includes('frontend'));
  for (const component of all) assert.ok(selected.includes(component));
});

test('CLI revision 不存在、差分为空、参数缺失均失败，全量模式仍验证明确传入 revision', t => {
  const f = fixture(t);
  const head = f.commit('README.md', 'base');
  for (const args of [[], ['--base', 'missing', '--head', head], ['--base', head, '--head', head], ['--base', head], ['--unknown'], ['--full', '--head', 'missing']]) {
    const result = spawnSync(process.execPath, [cli, ...args], {cwd: f.root, encoding: 'utf8', env: {...process.env, GITHUB_OUTPUT: ''}});
    assert.notEqual(result.status, 0, JSON.stringify(args));
  }
  const full = spawnSync(process.execPath, [cli, '--full'], {cwd: f.root, encoding: 'utf8', env: {...process.env, GITHUB_OUTPUT: ''}});
  assert.equal(full.status, 0, full.stderr);
  assert.deepEqual(components(JSON.parse(full.stdout).include), all);
});

test('CLI 拒绝把 Git 选项当 revision，且不丢失删除路径', t => {
  const f = fixture(t);
  const base = f.commit('apps/dashboard/src/removed.tsx', 'export default 1;');
  f.git('rm', 'apps/dashboard/src/removed.tsx');
  f.git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'delete');
  const head = f.git('rev-parse', 'HEAD');
  const deleted = spawnSync(process.execPath, [cli, '--base', base, '--head', head], {cwd: f.root, encoding: 'utf8', env: {...process.env, GITHUB_OUTPUT: ''}});
  assert.equal(deleted.status, 0, deleted.stderr);
  assert.deepEqual(components(JSON.parse(deleted.stdout).include), ['dashboard', 'scripts']);
  const invalid = spawnSync(process.execPath, [cli, '--base', '--all', '--head', head], {cwd: f.root, encoding: 'utf8', env: {...process.env, GITHUB_OUTPUT: ''}});
  assert.notEqual(invalid.status, 0);
});
