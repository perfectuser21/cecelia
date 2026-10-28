import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
const root = resolve(process.cwd(), '../..');
function scenario(paths: string[], failed = '', missingBase = false, remove = '', manifest = '') {
  const dir = mkdtempSync(join(tmpdir(), 'quickcheck-scope-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  try {
    git('init', '-q', '-b', 'main'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'test');
    git('config', 'core.hooksPath', '/dev/null');
    for (const sub of ['scripts', '.github/workflows/scripts']) {
      mkdirSync(join(dir, sub), { recursive: true });
    }
    cpSync(join(root, 'scripts/quickcheck.sh'), join(dir, 'scripts/quickcheck.sh'));
    cpSync(join(root, 'scripts/lib'), join(dir, 'scripts/lib'), { recursive: true });
    cpSync(join(root, '.github/workflows/scripts/list-fs-guard-tests.sh'), join(dir, '.github/workflows/scripts/list-fs-guard-tests.sh'));
    for (const p of ['packages/brain/src/__tests__/read.test.js', 'packages/brain/src/lib/__tests__/nested.test.js', 'tests/gp/f1/guard.test.js', 'tests/regression/guard.test.js', 'packages/brain/scripts/guard.test.mjs', 'packages/brain/node_modules/external/evil.test.js', 'packages/brain/tests/shared.test.js', 'tests/shared.test.js']) {
      mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), 'readFileSync("fixture")');
    }
    if (manifest) {
      writeFileSync(join(dir, 'packages/brain/src/existing-ops-source.js'), 'export const original = true;');
      writeFileSync(join(dir, '.implementation-source-relations.json'), JSON.stringify({schema_version:1, repo:'perfectuser21/cecelia', relations:[{owner_path:'packages/brain/src/existing-ops-source.js', path:'packages/brain/src/__tests__/read.test.js', role:'verification'}]}));
    }
    cpSync(join(root, 'packages/brain/vitest.config.js'), join(dir, 'packages/brain/vitest.config.js'));
    git('add', '.'); git('commit', '-qm', 'base'); if (!missingBase) git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    for (const p of paths) { mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), 'change'); }
    if (manifest) {
      const prior = {owner_path:'packages/brain/src/existing-ops-source.js', path:'packages/brain/src/__tests__/read.test.js', role:'verification'};
      const added = {owner_path:prior.owner_path, path:'packages/brain/src/lib/__tests__/helpers/existing-ops-proof-builder.test.js', role:'verification'};
      const doc = {schema_version:1, repo:'perfectuser21/cecelia', relations:[prior, added, {owner_path:prior.owner_path,path:'changes/cp-10280802-test-native-yield.md',role:'release'}]};
      if (manifest === 'delete') doc.relations.shift();
      if (manifest === 'modify') prior.role = 'documentation';
      if (manifest === 'role') added.role = 'new_role';
      if (manifest === 'missing') added.path = 'packages/brain/src/absent.test.js';
      if (manifest === 'escape') added.path = '../outside.test.js';
      if (manifest === 'owner') added.owner_path = 'packages/brain/src/missing.js';
      writeFileSync(join(dir, '.implementation-source-relations.json'), manifest === 'bad' ? '{bad' : JSON.stringify(doc));
    }
    if (remove) rmSync(join(dir, remove));
    git('add', '-A'); git('commit', '-qm', 'change');
    mkdirSync(join(dir, 'node_modules/.bin'), { recursive: true });
    writeFileSync(join(dir, 'node_modules/.bin/vitest'), `#!/bin/bash\nprintf '%s\\n' "$*" >> '${dir}/calls'\n[[ "$*" != *'${failed || '__never__'}'* ]] || exit 7\nexit 0\n`, { mode: 0o755 });
    const r = spawnSync('bash', ['scripts/quickcheck.sh'], { cwd: dir, encoding: 'utf8', env: { ...process.env, QUICKCHECK_LOCK_WAIT_SEC: '2' } });
    let calls = ''; try { calls = readFileSync(join(dir, 'calls'), 'utf8'); } catch {}
    return { status: r.status, calls, output: r.stdout + r.stderr };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
it('Brain小改运行changed与完整嵌套fs守卫，非全包', () => {
  const r = scenario(['packages/brain/src/simple.js']);
  expect(r.status).toBe(0); expect(r.calls).toMatch(/run --changed [a-f0-9]{40}/);
  expect(r.calls).toContain('src/__tests__/read.test.js'); expect(r.calls).toContain('src/lib/__tests__/nested.test.js'); expect(r.calls).toContain('../../tests/gp/f1/guard.test.js'); expect(r.calls).toContain('../../tests/regression/guard.test.js'); expect(r.calls).toContain('scripts/guard.test.mjs'); expect(r.calls).not.toContain('evil.test.js');
  expect(r.calls.trim().split('\n')).toHaveLength(2);
});
for (const p of ['package-lock.json', 'packages/brain/vitest.config.js', '.github/workflows/scripts/list-fs-guard-tests.sh', 'unknown.dat']) {
  it(`范围不明或配置 ${p} 回退全包`, () => { const r = scenario(['packages/brain/src/simple.js', p]); expect(r.status).toBe(0); expect(r.calls).toBe('run\n'); });
}
it('缺少可信base仍全包而非空成功', () => { const r = scenario(['packages/brain/src/simple.js'], '', true); expect(r.calls).toBe('run\n'); });
it('changed非零阻断且不抹去错误', () => { expect(scenario(['packages/brain/src/simple.js'], '--changed').status).toBe(1); });
it('完整守卫非零也阻断', () => { expect(scenario(['packages/brain/src/simple.js'], 'nested.test.js').status).toBe(1); });
it('其他包保持全包', () => { const r = scenario(['packages/engine/simple.ts']); expect(r.calls).toBe('run\n'); });

it('只有根依赖锁改动也触发Brain全包', () => { expect(scenario(['package-lock.json']).calls).toBe('run\n'); });
it('正常PR审计文档不把源码小改退回全包，仍跑完整守卫', () => {
 const r = scenario(['packages/brain/src/simple.js', '.dod.md', 'changes/cp-example.md']);
 expect(r.calls).toContain('--changed'); expect(r.calls).toContain('nested.test.js');
});

it('删除文件可能不在当前import图，回退全包', () => {
 const r = scenario(['packages/brain/src/simple.js'], '', false, 'packages/brain/src/__tests__/read.test.js');
 expect(r.calls).toBe('run\n');
});
it('选择器缺失不能缩小检查', () => {
 const r = scenario(['packages/brain/src/simple.js'], '', false, '.github/workflows/scripts/list-fs-guard-tests.sh');
 expect(r.calls).toBe('run\n');
});
it('只有未知根路径也不能推断Brain不受影响', () => { expect(scenario(['unknown.dat']).calls).toBe('run\n'); });
it('已知审计文档单独修改保持不触发包测试', () => { expect(scenario(['.dod.md', 'changes/cp-example.md']).calls).toBe(''); });
it('运行Skill类Markdown不是审计文档豁免', () => { expect(scenario(['skills/example/SKILL.md']).calls).toBe('run\n'); });

it('包内tests与仓库根tests同名守卫各自保留正确路径', () => {
 const r = scenario(['packages/brain/src/simple.js']);
 const args = r.calls.split(/\s+/);
 expect(args).toContain('tests/shared.test.js');
 expect(args).toContain('../../tests/shared.test.js');
});

// Fixed ffa3d87ec4 actual 8ef diff paths; no live branch dependency in CI.
const yieldPaths = ['.dod.md', '.implementation-source-relations.json', 'changes/cp-10280802-test-native-yield.md',
 'packages/brain/src/lib/__tests__/existing-ops-runtime-source.test.js',
 'packages/brain/src/lib/__tests__/existing-ops-staging-bootstrap.test.js',
 'packages/brain/src/lib/__tests__/existing-ops-staging-source.test.js',
 'packages/brain/src/lib/__tests__/helpers/existing-ops-proof-builder.test.js'];
it('实际8ef七路径的严格只增源关系仍走affected与完整守卫', () => {
 const r = scenario(yieldPaths, '', false, '', 'valid');
 expect(r.status).toBe(0); expect(r.calls).toContain('--changed'); expect(r.calls).toContain('tests/shared.test.js');
});
for (const mutation of ['delete','modify','role','missing','escape','owner','bad']) {
 it(`源关系${mutation}不能当安全元数据`, () => { expect(scenario(yieldPaths, '', false, '', mutation).calls).toBe('run\n'); });
}
