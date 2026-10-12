// lib/ci-precheck.mjs：推上 GitHub 之前在本地跑 CI 的规矩类门禁（审计 P1 #4，对应旧 harness「CI 门禁三件套前置进 generator 验收」）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git, gitPlain, initCommittableRepo } from './helpers/git.mjs';
import { defaultChecks, checksFor, runPrechecks, prKindOf, PR_SIZE_LIMIT } from '../lib/ci-precheck.mjs';

const REPOS = JSON.parse(fs.readFileSync(new URL('../repos.json', import.meta.url), 'utf8')).repos;
const ZJ = REPOS.find((r) => r.key === 'zenithjoy-workspace');
const CECELIA = REPOS.find((r) => r.key === 'cecelia');

describe('defaultChecks', () => {
  it('覆盖 ci-passed 里能本地离线复现的规矩类门禁，base 用 origin/main；feature PR 传 PR_LABELS=feature', () => {
    const checks = defaultChecks({ branch: 'cp-10100039-cw-05ae922c', feature: true });
    expect(checks.map((c) => c.name)).toEqual([
      'lint-test-pairing', 'lint-feature-has-smoke', 'lint-tdd-commit-order', 'lint-test-quality', 'lint-no-mock-only-test',
      'lint-no-fake-test', 'lint-gp-anchor-artifact', 'branch-naming', 'registry-lint', 'lint-migration-unique-version', 'pr-size-check',
      'smoke-registration', 'smoke-write-guard',
    ]);
    // 金丝雀 4（PR #6232）：写入型 smoke 没登记 write-targets、curl 没带 -q，到 CI 才红 → 左移到本地预检
    expect(checks.find((c) => c.name === 'smoke-write-guard').cmd).toEqual(['node', '--test', 'packages/quality/tests/smoke-production-guard.node-test.mjs']);
    const smoke = checks.find((c) => c.name === 'lint-feature-has-smoke');
    expect(smoke.cmd).toEqual(['bash', '.github/workflows/scripts/lint-feature-has-smoke.sh', 'origin/main']);
    expect(smoke.env).toEqual({ PR_LABELS: 'feature' });
    expect(defaultChecks({ branch: 'b', feature: false }).find((c) => c.name === 'lint-feature-has-smoke').env).toEqual({ PR_LABELS: '' });
    expect(checks.find((c) => c.name === 'branch-naming').cmd).toEqual(['bash', 'scripts/ci/check-branch-naming.sh', 'cp-10100039-cw-05ae922c']);
  });
});

describe('prKindOf（与 publish 的 PR 标题同一判据）', () => {
  it('01 标题以 修复/fix/bug 开头 → fix，否则 feat', () => {
    expect(prKindOf('修复 Brain 非法 id')).toBe('fix');
    expect(prKindOf('Fix: x')).toBe('fix');
    expect(prKindOf('bug 修复')).toBe('fix');
    expect(prKindOf('新增 status 页')).toBe('feat');
  });
});

describe('runPrechecks', () => {
  let root;
  let worktree;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'precheck-'));
    const origin = path.join(root, 'origin.git');
    gitPlain('init', '--bare', '-q', '-b', 'main', origin);
    worktree = path.join(root, 'wt');
    fs.mkdirSync(worktree);
    initCommittableRepo(worktree, path.join(root, 'no-hooks'));
    git(worktree, 'remote', 'add', 'origin', origin);
    git(worktree, 'push', '-q', 'origin', 'HEAD:main');
    git(worktree, 'fetch', '-q', 'origin');
    git(worktree, 'checkout', '-q', '-b', 'cp-10100039-cw-05ae922c');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('逐项跑：0 退出算过，非 0 带输出尾部算失败；env 传给命令；脚本不存在的项跳过并记 skipped', async () => {
    const r = await runPrechecks(worktree, {
      checks: [
        { name: 'ok', cmd: ['bash', '-c', 'echo fine'] },
        { name: 'bad', cmd: ['bash', '-c', 'echo "缺 smoke 脚本: $PR_LABELS"; exit 1'], env: { PR_LABELS: 'feature' } },
        { name: 'absent', cmd: ['bash', '.github/workflows/scripts/lint-nope.sh', 'origin/main'] },
      ],
    });
    expect(r.map((c) => [c.name, c.ok, c.skipped ?? false])).toEqual([['ok', true, false], ['bad', false, false], ['absent', true, true]]);
    expect(r[1].output_tail).toContain('缺 smoke 脚本: feature');
  });

  // 金丝雀 3e8414f6（PR #6160）实证：CI 修复补的 smoke 脚本没登记，被 Smoke Ratchet Gate 判「未登记脚本」打红
  it('smoke-registration：smoke 目录每个 .sh 都要在 allowlist / denylist / debt 之一；分类文件缺失则跳过', async () => {
    const only = (c) => c.name === 'smoke-registration';
    const check = () => runPrechecks(worktree, { checks: defaultChecks({ branch: 'b', feature: false }).filter(only) });
    expect((await check())[0]).toMatchObject({ ok: true, skipped: true });
    fs.mkdirSync(path.join(worktree, 'packages/brain/scripts/smoke'), { recursive: true });
    fs.mkdirSync(path.join(worktree, 'packages/quality'), { recursive: true });
    fs.writeFileSync(path.join(worktree, 'packages/brain/scripts/smoke/old-smoke.sh'), '#!/bin/bash\n');
    fs.writeFileSync(path.join(worktree, 'packages/brain/scripts/smoke/new-smoke.sh'), '#!/bin/bash\n');
    fs.writeFileSync(path.join(worktree, 'packages/quality/smoke-allowlist.txt'), '# 注释\nold-smoke.sh\n');
    fs.writeFileSync(path.join(worktree, 'packages/quality/smoke-denylist.txt'), '');
    fs.writeFileSync(path.join(worktree, 'packages/quality/smoke-debt.txt'), '');
    let [r] = await check();
    expect(r).toMatchObject({ ok: false });
    expect(r.output_tail).toContain('new-smoke.sh');
    expect(r.output_tail).toContain('smoke-allowlist.txt');
    fs.appendFileSync(path.join(worktree, 'packages/quality/smoke-debt.txt'), 'new-smoke.sh\n');
    [r] = await check();
    expect(r).toMatchObject({ ok: true });
  });

  it('pr-size-check：相对 origin/main 新增行数超过上限 → 失败（sprint md 链也算，同 CI）', async () => {
    fs.writeFileSync(path.join(worktree, 'big.txt'), 'x\n'.repeat(PR_SIZE_LIMIT + 1));
    git(worktree, 'add', '.');
    git(worktree, 'commit', '-q', '-m', 'feat: big');
    const [size] = await runPrechecks(worktree, { checks: defaultChecks({ branch: 'b', feature: false }).filter((c) => c.name === 'pr-size-check') });
    expect(size).toMatchObject({ name: 'pr-size-check', ok: false });
    expect(size.output_tail).toContain(String(PR_SIZE_LIMIT + 1));
  });
});

// C6：预检清单按仓库（repos.json prechecks）。zenithjoy 以它自己的 CI 为准：L2 Consistency 的 Orphan Test Check
// （*.test.ts/tsx/js、*.spec.ts/tsx/js 必须登记 test-registry.yaml，.test.mjs 不受约束）、registry sync、product-map 校验与漂移，
// Smoke Glob Gate 的 lint-smoke-baseline，L1 的测试配对 / TDD 顺序 / 测试质量 / 无假测试 / 版本号 bump；cecelia 专属门禁不跑。
describe('checksFor：按仓库挑预检清单', () => {
  it('cecelia（及没传 profile 的旧调用方）= defaultChecks，口径不变', () => {
    const opts = { branch: 'cp-10100039-cw-05ae922c', feature: true };
    expect(checksFor(CECELIA, opts)).toEqual(defaultChecks(opts));
    expect(checksFor(undefined, opts)).toEqual(defaultChecks(opts));
  });

  it('zenithjoy：按它自己的 CI 挑门禁，不跑 cecelia 专属的（branch-naming / registry-lint / 迁移编号 / smoke allowlist / pr-size）', () => {
    const names = checksFor(ZJ, { branch: 'cp-10100039-cw-05ae922c', feature: true }).map((c) => c.name);
    expect(names).toEqual([
      'lint-test-pairing', 'lint-tdd-commit-order', 'lint-test-quality', 'lint-no-fake-test', 'lint-agent-version-bump',
      'lint-line04-manifest-version-bump', 'lint-smoke-baseline', 'orphan-test-registry', 'registry-sync', 'product-map-validate',
      'wf-plan-check', 'gen-step-dod-check',
    ]);
    const byName = Object.fromEntries(checksFor(ZJ, { branch: 'b', feature: false }).map((c) => [c.name, c]));
    expect(byName['lint-smoke-baseline'].cmd).toEqual(['bash', '.github/workflows/scripts/lint-smoke-baseline.sh', 'origin/main']);
    expect(byName['registry-sync'].cmd).toEqual(['node', 'scripts/sync-registry.cjs']);
    expect(byName['wf-plan-check'].cmd).toEqual(['node', 'scripts/product-map/wf-plan.mjs', '--check']);
    expect(byName['orphan-test-registry'].builtin).toBe('orphan-test-registry');
  });
});

describe('orphan-test-registry（同 zenithjoy ci-l2-consistency.yml Orphan Test Check）', () => {
  let root;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'orphan-')); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (rel, text = 'x\n') => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  const check = async () => (await runPrechecks(root, { checks: [{ name: 'orphan-test-registry', builtin: 'orphan-test-registry' }] }))[0];
  const REGISTRY = 'version: "1.0.0"\ntests:\n  - id: a\n    path: "apps/api/src/a.test.ts"\n    type: unit\n';

  it('没有 test-registry.yaml → 跳过（同 CI 的 SKIP）', async () => {
    write('apps/api/src/b.test.js');
    expect(await check()).toMatchObject({ ok: true, skipped: true });
  });

  it('新增未登记的 foo.test.js → 失败并点名；登记过的、.test.mjs、node_modules / dist 下的不算', async () => {
    write('test-registry.yaml', REGISTRY);
    write('apps/api/src/a.test.ts');
    write('scripts/x/__tests__/ok.test.mjs');
    write('node_modules/pkg/z.test.js');
    write('apps/web/dist/y.spec.js');
    expect(await check()).toMatchObject({ ok: true });
    write('services/foo/foo.test.js');
    const r = await check();
    expect(r.ok).toBe(false);
    expect(r.output_tail).toContain('services/foo/foo.test.js');
    expect(r.output_tail).toContain('test-registry.yaml');
    expect(r.output_tail).not.toContain('a.test.ts');
  });

  it('.spec.tsx 也要登记；登记后通过', async () => {
    write('test-registry.yaml', REGISTRY);
    write('apps/web/src/Page.spec.tsx');
    expect((await check()).ok).toBe(false);
    fs.appendFileSync(path.join(root, 'test-registry.yaml'), '  - id: p\n    path: apps/web/src/Page.spec.tsx\n');
    expect((await check()).ok).toBe(true);
  });
});
