import assert from 'node:assert/strict';
import {describe, it, beforeEach, afterEach} from 'node:test';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {basename, join} from 'node:path';
import {nativeWorktreeFixture, WORKTREE_MANAGE, worktreePathFromOutput} from './fixtures/native-worktree-fixture.mjs';

describe('真实worktree路径与删除边界', () => {
  let fixture;
  beforeEach(() => { fixture = nativeWorktreeFixture(); });
  afterEach(() => fixture.dispose());
  function shell(source, ...args) {
    const result = fixture.shell(source, [WORKTREE_MANAGE, ...args]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return result.stdout.trim();
  }
  it('新owner通过真实bash语法检查', () => {
    assert.equal(fixture.run('bash', ['-n', WORKTREE_MANAGE]).status, 0);
  });
  it('显式WORKTREE_BASE与未设置时隔离HOME的路径规则保持', () => {
    assert.equal(shell('source "$1"; generate_worktree_path "$2"', 'task'), join(fixture.worktrees, basename(fixture.repo), 'task'));
    assert.equal(shell('unset WORKTREE_BASE; source "$1"; generate_worktree_path "$2"', 'task'), join(fixture.home, 'worktrees', basename(fixture.repo), 'task'));
  });
  it('create真实建立父目录并把仓库内worktree加入gitignore', () => {
    const base = join(fixture.repo, '.claude/worktrees');
    assert.equal(existsSync(base), false);
    const result = fixture.run('bash', [WORKTREE_MANAGE, 'create', 'nested'], {WORKTREE_BASE: base});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const path = join(base, basename(fixture.repo), 'nested');
    assert.equal(worktreePathFromOutput(result.stdout), path);
    assert.equal(existsSync(join(path, '.git')), true);
    assert.equal(fixture.git('check-ignore', '.claude/worktrees/repo/nested'), '.claude/worktrees/repo/nested');
    assert.ok(fixture.git('worktree', 'list', '--porcelain').includes(`worktree ${path}`));
  });
  for (const kind of ['persistent', 'legacy']) it(`git移除失败时安全fallback能清理${kind}路径`, () => {
    const path = kind === 'persistent' ? join(fixture.worktrees, basename(fixture.repo), 'remove-me')
      : join(fixture.repo, '.claude/worktrees/remove-me');
    fixture.git('worktree', 'add', '-q', '-b', 'cp-remove-fixture', path, 'main');
    shell('source "$1"; git() { if [[ "$1" == worktree && "$2" == remove ]]; then return 1; fi; command git "$@"; }; cmd_remove "$2"', 'cp-remove-fixture');
    assert.equal(existsSync(path), false);
    assert.ok(!fixture.git('worktree', 'list', '--porcelain').includes(`worktree ${path}`));
  });
  it('safe_rm_rf拒绝允许父目录以外的路径并保留真实文件', () => {
    const keep = join(fixture.base, 'keep'); mkdirSync(keep); writeFileSync(join(keep, 'sentinel'), 'keep');
    const result = fixture.shell('source "$1"; safe_rm_rf "$2" "$3"', [WORKTREE_MANAGE, keep, fixture.repo]);
    assert.equal(result.status, 1);
    assert.equal(readFileSync(join(keep, 'sentinel'), 'utf8'), 'keep');
  });
});
