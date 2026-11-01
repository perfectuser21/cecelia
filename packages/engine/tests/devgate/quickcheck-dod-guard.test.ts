import { describe, it, expect } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const sourceRoot = resolve(__dirname, '../../../..');
const require = createRequire(import.meta.url);
function quickcheck(dod: string, file = 'DoD.md') {
  const root = mkdtempSync(join(tmpdir(), 'quickcheck-dod-'));
  const env = {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null'};
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE']) delete env[key];
  const git = (...args: string[]) => {
    const result = spawnSync('git', args, {cwd: root, encoding: 'utf8', env});
    expect(result.status, result.stderr).toBe(0);
    return result.stdout.trim();
  };
  try {
    for (const path of ['scripts/quickcheck.sh', 'scripts/lib/quickcheck-lock.sh', 'scripts/lib/worktree-node-modules.sh',
      'packages/quality/scripts/devgate/check-dod-mapping.cjs']) {
      mkdirSync(dirname(join(root, path)), {recursive: true});
      copyFileSync(join(sourceRoot, path), join(root, path));
    }
    mkdirSync(join(root, 'node_modules'), {recursive: true});
    symlinkSync(dirname(require.resolve('js-yaml/package.json')), join(root, 'node_modules/js-yaml'), 'dir');
    writeFileSync(join(root, '.gitignore'), 'node_modules/\n');
    mkdirSync(join(root, 'tests'), {recursive: true});
    writeFileSync(join(root, 'tests/actual.test.mjs'), "import assert from 'node:assert/strict'; assert.equal(2+2,4);\n");
    git('init', '-q', '-b', 'main'); git('config', 'core.hooksPath', '/dev/null');
    git('config', 'user.name', 'fixture'); git('config', 'user.email', 'fixture@example.invalid');
    git('add', '.'); git('commit', '-qm', 'fixture base');
    git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'HEAD'));
    mkdirSync(dirname(join(root, file)), {recursive: true}); writeFileSync(join(root, file), dod);
    git('add', file); git('commit', '-qm', 'change only DoD');
    const result = spawnSync('bash', ['scripts/quickcheck.sh'], {cwd: root, encoding: 'utf8', env, timeout: 10000});
    expect(result.error).toBeUndefined();
    expect(result.stdout).not.toContain('▶ packages/');
    return result;
  } finally { rmSync(root, {recursive: true, force: true}); }
}

describe('quickcheck真实DoD映射门禁', () => {
  it('允许push之后才能核验的pending条目，真实validator验证映射而不制造完成', () => {
    const result = quickcheck('- [ ] GitHub候选CI真实完成\n  Test: manual:node --test tests/actual.test.mjs\n');
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain('DoD ↔ Test 映射检查');
  });
  it('pending条目可直接映射存在的自动化测试文件', () => {
    const result = quickcheck('- [ ] 独立测试完成\n  Test: tests/actual.test.mjs\n');
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });
  it.each([' ', 'x'])('缺少映射即使状态[%s]也必须失败', state => {
    const result = quickcheck(`- [${state}] 没有验收证据映射\n`);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('缺少 Test 字段');
  });
  it.each(['manual:echo passed', 'manual:test -f tests/actual.test.mjs', 'tests/missing.test.mjs'])('拒绝假测试或不存在的映射：%s', mapping => {
    const result = quickcheck(`- [x] 不能用勾选冒充验证\n  Test: ${mapping}\n`);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toMatch(/假测试|测试文件不存在/);
  });
  it('嵌套DoD文件同样使用真实映射校验', () => {
    const result = quickcheck('- [ ] 合并后读回\n  Test: tests/actual.test.mjs\n', 'sprints/fixture/DoD-release.md');
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain('DoD ↔ Test 映射检查');
  });
});

describe('e2e-integrity-check使用当前DoD映射入口', () => {
  it('完整性检查核对真实validator及其接线，而不要求pending先勾选', () => {
    const content = readFileSync(join(sourceRoot, 'packages/engine/scripts/e2e-integrity-check.sh'), 'utf8');
    expect(content).toContain('check-dod-mapping.cjs');
    expect(content).not.toContain("grep -q 'DoD 未勾选'");
  });
});
