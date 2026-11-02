import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const checker = join(source, 'scripts/devgate/check-dod-mapping.cjs');
const require = createRequire(import.meta.url);
const mapping = '- [ ] 验证真实功能\n  Test: tests/actual.test.mjs\n';

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'dod-mapping-'));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE']) delete env[key];
  const put = (path, content) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); };
  const execute = (cmd, args) => spawnSync(cmd, args, { cwd: root, env, encoding: 'utf8', timeout: 15000 });
  try {
    mkdirSync(join(root, '.git'));
    put('tests/actual.test.mjs', "import assert from 'node:assert/strict'; assert.equal(2 + 2, 4);\n");
    return run({ root, env, put, execute });
  } finally { rmSync(root, { recursive: true, force: true }); }
}

function check(content, prepare = () => {}) {
  return fixture(context => {
    context.put('.dod.md', content);
    prepare(context);
    return context.execute(process.execPath, [checker]);
  });
}

test('新CLI接受存在的自动测试映射，pending不冒充完成', () => {
  const result = check(mapping);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /映射检查通过/);
});

test('新CLI验证真实manual命令但不执行命令', () => {
  fixture(({ root, put, execute }) => {
    put('.dod.md', '- [x] 命令映射\n  Test: manual:node -e "require(\'fs\').writeFileSync(\'executed\', \'yes\')"\n');
    const result = execute(process.execPath, [checker]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(existsSync(join(root, 'executed')), false, '映射检查不能执行业务命令');
  });
});

test('新CLI解析真实YAML合同并拒绝不存在的RCI', () => {
  const prepare = ({ put }) => put('regression-contract.yaml', 'hooks:\n  - id: RCI-A\n');
  assert.equal(check('- [x] 合同\n  Test: contract:RCI-A\n', prepare).status, 0);
  const result = check('- [x] 合同\n  Test: contract:RCI-MISSING\n', prepare);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /RCI ID 不存在/);
});

for (const [name, content, diagnostic] of [
  ['缺Test', '- [x] 无映射\n', /缺少 Test 字段/],
  ['文件不存在', '- [ ] 缺文件\n  Test: tests/missing.test.mjs\n', /测试文件不存在/],
  ['echo假测试', '- [x] 假验证\n  Test: manual:echo passed\n', /假测试/],
  ['test-f假测试', '- [x] 假验证\n  Test: manual:test -f tests/actual.test.mjs\n', /假测试/],
  ['空DoD', '# DoD\n', /未找到验收项/],
]) test(`新CLI拒绝${name}`, () => {
  const result = check(content);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, diagnostic);
});

test('新CLI缺少DoD返回读取错误，不能发成功凭据', () => {
  const result = fixture(({ execute }) => execute(process.execPath, [checker, 'missing.md']));
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stderr, /DoD 文件不存在/);
});

function prepush(content, missingChecker = false) {
  return fixture(({ root, put, execute }) => {
    rmSync(join(root, '.git'), { recursive: true });
    for (const path of ['scripts/pre-push-check.sh', ...(!missingChecker ? ['scripts/devgate/check-dod-mapping.cjs'] : [])]) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      copyFileSync(join(source, path), join(root, path));
    }
    mkdirSync(join(root, 'node_modules'));
    symlinkSync(dirname(require.resolve('js-yaml/package.json')), join(root, 'node_modules/js-yaml'), 'dir');
    put('.gitignore', 'node_modules/\n');
    for (const args of [['init', '-q', '-b', 'fixture'], ['config', 'core.hooksPath', '/dev/null'], ['config', 'user.name', 'fixture'], ['config', 'user.email', 'fixture@example.invalid'], ['add', '.'], ['commit', '-qm', 'base'], ['update-ref', 'refs/remotes/origin/main', 'HEAD']]) {
      const result = execute('git', args); assert.equal(result.status, 0, result.stderr);
    }
    put('.dod-fixture.md', content);
    return execute('bash', ['scripts/pre-push-check.sh']);
  });
}

test('pre-push无Quality包也接受真实DoD映射', () => {
  const result = prepush(mapping);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /DoD 映射检查通过/);
});

test('pre-push实际校验发现的DoD，拒绝假映射', () => {
  const result = prepush('- [x] 假验证\n  Test: manual:echo passed\n');
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /DoD 映射检查失败/);
});

test('pre-push缺失正式checker时拒绝通过', () => {
  const result = prepush(mapping, true);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /DoD 映射检查失败/);
});
