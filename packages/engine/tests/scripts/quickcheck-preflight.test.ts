import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const source = resolve(__dirname, '../../../..');
const packages = [
  ['packages/brain', 'lint'], ['packages/engine', 'typecheck'],
  ['apps/api', 'typecheck'], ['apps/dashboard', 'build'],
] as const;

function fixture(changes: string[], options: { missingScript?: boolean; failure?: number; missingTool?: boolean; missingRunner?: boolean; noBase?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'qc-preflight-'));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE']) delete env[key];
  const put = (path: string, content: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); };
  const git = (...args: string[]) => {
    const result = spawnSync('git', args, { cwd: root, env, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
  };
  try {
    for (const path of ['scripts/quickcheck.sh', 'scripts/lib/quickcheck-lock.sh', 'scripts/lib/worktree-node-modules.sh',
      'scripts/ci/run-basic-check.mjs', 'scripts/ci/ops-checks.mjs']) {
      mkdirSync(dirname(join(root, path)), { recursive: true }); copyFileSync(join(source, path), join(root, path));
    }
    put('.gitignore', 'marker.log\n');
    for (const [path, script] of packages) {
      put(`${path}/package.json`, JSON.stringify({ scripts: options.missingScript ? {} : {
        [script]: options.missingTool ? 'missing-quickcheck-tool' : `node check.cjs ${script}`,
        test: 'node forbidden.cjs',
      } }));
      put(`${path}/check.cjs`, `require('node:fs').appendFileSync(${JSON.stringify(join(root, 'marker.log'))}, ${JSON.stringify(`${path}:${script}\n`)}); process.exit(${options.failure || 0});`);
      put(`${path}/forbidden.cjs`, 'throw new Error("local full unit suite must not run");');
    }
    // 真正执行 production runner 的 scripts 分支；边界命令只写隔离目录里的标记。
    put('scripts/ci/__tests__/basic-fixture.test.mjs', `import {appendFileSync} from 'node:fs'; appendFileSync(${JSON.stringify(join(root, 'marker.log'))}, 'scripts:node-test\\n');`);
    put('scripts/facts-check.mjs', ''); put('scripts/check-version-sync.sh', '#!/bin/bash\nexit 0\n');
    put('.github/workflows/scripts/lint-migration-unique-version.cjs', ''); put('scripts/skill_source_ownership.py', '');
    git('init', '-q', '-b', 'main'); git('config', 'core.hooksPath', '/dev/null');
    git('config', 'user.name', 'fixture'); git('config', 'user.email', 'fixture@example.invalid');
    git('add', '.'); git('commit', '-qm', 'base');
    if (!options.noBase) git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    for (const path of changes) put(path, path.endsWith('.json') ? '{}\n' : 'changed\n');
    git('add', '.'); git('commit', '-qm', 'change');
    if (options.missingRunner) rmSync(join(root, 'scripts/ci/run-basic-check.mjs'));
    const result = spawnSync('bash', ['scripts/quickcheck.sh'], { cwd: root, env, encoding: 'utf8', timeout: 15000 });
    expect(result.error).toBeUndefined();
    const markers = existsSync(join(root, 'marker.log')) ? readFileSync(join(root, 'marker.log'), 'utf8').trim().split('\n') : [];
    return { ...result, markers };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

describe('quickcheck 快速准备检查，完整单测由GitHub必需检查负责', () => {
  it.each(packages)('仅运行改动包 %s 的 npm run %s', (path, script) => {
    const result = fixture([`${path}/changed.txt`]);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.markers).toEqual([`${path}:${script}`]);
    expect(result.stdout).toContain('本地准备检查通过');
    expect(result.stdout).toContain('源码保底通过');
  });
  it('多个改动包各跑一次准备命令，不触发test脚本', () => {
    const result = fixture(['packages/brain/a.js', 'packages/brain/b.js', 'apps/api/a.ts']);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.markers.sort()).toEqual(['apps/api:typecheck', 'packages/brain:lint']);
  });
  it.each(['scripts/ci/change.mjs', '.github/workflows/change.yml', 'package-lock.json', 'package.json'])('共享入口 %s 实际执行 scripts CI runner', path => {
    const result = fixture([path]);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.markers).toEqual(['scripts:node-test']);
  });
  it.each([{ missingScript: true }, { missingTool: true }, { failure: 17 }])('缺入口/工具或真实命令非零时阻止push：%j', options => {
    const result = fixture(['packages/engine/changed.txt'], options);
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain('本地准备检查通过');
    if ('failure' in options) {
      expect(result.markers).toEqual(['packages/engine:typecheck']);
      expect(result.stdout).toContain('exit=17');
    } else if ('missingScript' in options) expect(result.stdout + result.stderr).toContain('Missing script');
    else expect(result.stdout + result.stderr).toContain('missing-quickcheck-tool');
  });
  it('scripts入口缺失时阻止push', () => {
    const result = fixture(['scripts/ci/change.mjs'], { missingRunner: true });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('Cannot find module');
  });
  it('缺少真实diff基线时不能把异常当作无变更成功', () => {
    const result = fixture(['docs/change.md'], { noBase: true });
    expect(result.status).not.toBe(0);
  });
});
