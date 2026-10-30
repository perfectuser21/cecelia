// 验证实际新入口与真实 Git 差分，避免 workflow/fs 改动令 Brain 守卫整片漏跑。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scopeCli = fileURLToPath(new URL('../../../../scripts/ci/basic-scope.mjs', import.meta.url));
let repo, base;
const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString().trim();
function scopeFor(changedFile) {
  git('checkout', '-q', '-B', 'pr', base);
  fs.mkdirSync(path.dirname(path.join(repo, changedFile)), { recursive: true });
  fs.writeFileSync(path.join(repo, changedFile), `${Date.now()}\n`);
  git('add', '-A'); git('commit', '-q', '-m', 'change');
  const output = execFileSync(process.execPath, [scopeCli, '--base', base, '--head', 'HEAD'], {
    cwd: repo, env: {...process.env, GITHUB_OUTPUT: ''}, encoding: 'utf8',
  });
  return JSON.parse(output).include;
}
describe('Brain 完整组件测试范围判定', () => {
  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-unit-scope-'));
    git('init', '-q', '-b', 'main'); git('config', 'core.hooksPath', '/dev/null');
    git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
    fs.writeFileSync(path.join(repo, 'README'), 'base'); git('add', '.'); git('commit', '-qm', 'base');
    base = git('rev-parse', 'HEAD');
  });
  afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));
  it('只改 workflow 仍运行全部六个 Brain 分片，fs 守卫不会整片跳过', () => {
    expect(scopeFor('.github/workflows/ci.yml').filter(row => row.component === 'brain-unit'))
      .toEqual([1, 2, 3, 4, 5, 6].map(shard => ({component: 'brain-unit', shard})));
  });
  it('改 Brain 源码运行完整分片和真实集成，避免 import 图漏掉动态依赖', () => {
    const matrix = scopeFor('packages/brain/src/x.js');
    expect(matrix.filter(row => row.component === 'brain-unit')).toHaveLength(6);
    expect(matrix).toContainEqual({component: 'brain-integration'});
  });
});
