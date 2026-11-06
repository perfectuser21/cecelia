import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const lint = join(repo, 'scripts/registry-lint.mjs');

function run(root, home) {
  // 只执行已读的纯文件目录检查，不继承凭据、Git 覆盖或业务环境。
  const result = spawnSync(process.execPath, [join(root, 'scripts/registry-lint.mjs')], {
    cwd: root, encoding: 'utf8', timeout: 15000,
    env: {PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, TMPDIR: home, LANG: 'C', TZ: 'UTC'},
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.ok(result.status === 0 || result.status === 1);
  const output = result.stdout + result.stderr;
  assert.match(output, /systems: \d+/);
  assert.match(output, /检查完成: \d+ PASS, \d+ FAIL, \d+ WARN/);
  return {status: result.status, output,
    testFailures: output.split('\n').filter(line => /FAIL\s+.*tests\.(unit|integration|e2e|regression)\b/.test(line))};
}

function owned(fn) {
  const root = mkdtempSync(join(tmpdir(), 'registry-path-contract-'));
  try { return fn(root); } finally { rmSync(root, {recursive: true, force: true}); }
}

function fixture(root, {missingTest = false, missingSkill = false} = {}) {
  mkdirSync(join(root, 'scripts'), {recursive: true});
  mkdirSync(join(root, 'docs/registry/features'), {recursive: true});
  mkdirSync(join(root, 'src'), {recursive: true});
  copyFileSync(lint, join(root, 'scripts/registry-lint.mjs'));
  writeFileSync(join(root, 'src/example.js'), 'export const example = true;\n');
  if (!missingTest) writeFileSync(join(root, 'src/example.test.js'), '// fixture existence only; never executed\n');
  writeFileSync(join(root, 'docs/registry/system-registry.yml'), `schema_version: "2.0.0"
systems:
  - id: example
    features_file: features/example.yml
    feature_count: 1
`);
  writeFileSync(join(root, 'docs/registry/features/example.yml'), `# Schema: v2.0.0
system_id: example
features:
  - feature_id: example
    maturity: 2
    entry_files: [src/example.js]
    skills:
${missingSkill ? '      - skill_id: fixture_skill\n        entry_file: skills/fixture/SKILL.md' : '      []'}
    tests:
      unit: [src/example.test.js]
    capabilities:
      - id: example_capability
        entry_file: src/example.js
        tests:
          unit: [src/example.test.js]
`);
}

test('现行目录登记的测试路径均被实际目录检查识别为存在', () => owned(home => {
  const result = run(repo, home);
  assert.match(result.output, /PASS\s+tests\.unit:/);
  // 这里只断言测试引用；未恢复的固定 Skill 不能被说成全目录通过。
  assert.deepEqual(result.testFailures, []);
}));

test('实际检查器接受存在的 feature/capability 测试路径', () => owned(root => {
  fixture(root);
  const result = run(root, root);
  assert.equal(result.status, 0);
  assert.deepEqual(result.testFailures, []);
}));

test('实际检查器拒绝缺失测试，feature 与 capability 两处都必须报出', () => owned(root => {
  fixture(root, {missingTest: true});
  const result = run(root, root);
  assert.equal(result.status, 1);
  assert.equal(result.testFailures.length, 2);
  assert.ok(result.testFailures.every(line => line.includes('src/example.test.js')));
}));

test('Skill 未恢复仍真实报错，不冒充测试路径错误或全目录成功', () => owned(root => {
  fixture(root, {missingSkill: true});
  const result = run(root, root);
  assert.equal(result.status, 1);
  assert.match(result.output, /FAIL\s+example: skill fixture_skill entry_file 不存在/);
  assert.deepEqual(result.testFailures, []);
}));
