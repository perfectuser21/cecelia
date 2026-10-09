// lib/ci-precheck.mjs：推上 GitHub 之前在本地跑 CI 的规矩类门禁（审计 P1 #4，对应旧 harness「CI 门禁三件套前置进 generator 验收」）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git, gitPlain, initCommittableRepo } from './helpers/git.mjs';
import { defaultChecks, runPrechecks, prKindOf, PR_SIZE_LIMIT } from '../lib/ci-precheck.mjs';

describe('defaultChecks', () => {
  it('覆盖 ci-passed 里能本地离线复现的规矩类门禁，base 用 origin/main；feature PR 传 PR_LABELS=feature', () => {
    const checks = defaultChecks({ branch: 'cp-10100039-cw-05ae922c', feature: true });
    expect(checks.map((c) => c.name)).toEqual([
      'lint-test-pairing', 'lint-feature-has-smoke', 'lint-tdd-commit-order', 'lint-test-quality', 'lint-no-mock-only-test',
      'lint-no-fake-test', 'lint-gp-anchor-artifact', 'branch-naming', 'registry-lint', 'lint-migration-unique-version', 'pr-size-check',
    ]);
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

  it('pr-size-check：相对 origin/main 新增行数超过上限 → 失败（sprint md 链也算，同 CI）', async () => {
    fs.writeFileSync(path.join(worktree, 'big.txt'), 'x\n'.repeat(PR_SIZE_LIMIT + 1));
    git(worktree, 'add', '.');
    git(worktree, 'commit', '-q', '-m', 'feat: big');
    const [size] = await runPrechecks(worktree, { checks: defaultChecks({ branch: 'b', feature: false }).filter((c) => c.name === 'pr-size-check') });
    expect(size).toMatchObject({ name: 'pr-size-check', ok: false });
    expect(size.output_tail).toContain(String(PR_SIZE_LIMIT + 1));
  });
});
