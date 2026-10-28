import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
const root = resolve(process.cwd(), '../..');
function scenario(paths: string[], failed = '', missingBase = false) {
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
    for (const p of ['packages/brain/src/__tests__/read.test.js', 'packages/brain/src/lib/__tests__/nested.test.js']) {
      mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), 'readFileSync("fixture")');
    }
    git('add', '.'); git('commit', '-qm', 'base'); if (!missingBase) git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    for (const p of paths) { mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), 'change'); }
    git('add', '.'); git('commit', '-qm', 'change');
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
  expect(r.calls).toContain('src/__tests__/read.test.js'); expect(r.calls).toContain('src/lib/__tests__/nested.test.js');
  expect(r.calls.trim().split('\n')).toHaveLength(2);
});
for (const p of ['package-lock.json', 'packages/brain/vitest.config.js', '.github/workflows/scripts/list-fs-guard-tests.sh', 'unknown.dat']) {
  it(`范围不明或配置 ${p} 回退全包`, () => { const r = scenario(['packages/brain/src/simple.js', p]); expect(r.status).toBe(0); expect(r.calls).toBe('run\n'); });
}
it('缺少可信base仍全包而非空成功', () => { const r = scenario(['packages/brain/src/simple.js'], '', true); expect(r.calls).toBe('run\n'); });
it('changed非零阻断且不抹去错误', () => { expect(scenario(['packages/brain/src/simple.js'], '--changed').status).toBe(1); });
it('完整守卫非零也阻断', () => { expect(scenario(['packages/brain/src/simple.js'], 'nested.test.js').status).toBe(1); });
it('其他包保持全包', () => { const r = scenario(['packages/engine/simple.ts']); expect(r.calls).toBe('run\n'); });
