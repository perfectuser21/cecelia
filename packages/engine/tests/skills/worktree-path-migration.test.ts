import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { nativeWorktreeFixture, WORKTREE_MANAGE, CLEANUP, worktreePathFromOutput } from '../helpers/native-worktree-fixture';

const PROJECT_ROOT = resolve(__dirname, '../..');

describe('tracked Worktree path migration', () => {
  let fixture: ReturnType<typeof nativeWorktreeFixture>;
  beforeEach(() => { fixture = nativeWorktreeFixture(); });
  afterEach(() => { fixture.dispose(); });
  function shell(script: string, ...args: string[]) {
    const result = fixture.run('bash', ['-c', script, 'fixture', WORKTREE_MANAGE, ...args]);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    return result.stdout.trim();
  }
  it('tracked worktree-manage通过真实bash语法检查', () => {
    expect(fixture.run('bash', ['-n', WORKTREE_MANAGE]).status).toBe(0);
  });
  it('路径函数遵循WORKTREE_BASE，未设置时只使用隔离HOME', () => {
    expect(shell('source "$1"; generate_worktree_path "$2"', 'task')).toBe(join(fixture.worktrees, basename(fixture.repo), 'task'));
    expect(shell('unset WORKTREE_BASE; source "$1"; generate_worktree_path "$2"', 'task')).toBe(join(fixture.home, 'worktrees', basename(fixture.repo), 'task'));
  });
  it('真实create自动建立父目录并将仓库内worktree路径加入gitignore', () => {
    const base = join(fixture.repo, '.claude/worktrees');
    expect(existsSync(base)).toBe(false);
    const result = fixture.run('bash', [WORKTREE_MANAGE, 'create', 'nested'], { WORKTREE_BASE: base });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const path = join(base, basename(fixture.repo), 'nested');
    expect(worktreePathFromOutput(result.stdout)).toBe(path);
    expect(existsSync(join(path, '.git'))).toBe(true);
    expect(fixture.git('check-ignore', '.claude/worktrees/repo/nested')).toBe('.claude/worktrees/repo/nested');
    expect(fixture.git('worktree', 'list', '--porcelain')).toContain(`worktree ${path}`);
  });
  it.each(['persistent', 'legacy'])('git移除失败时原生安全fallback能清理%s路径', kind => {
    const path = kind === 'persistent'
      ? join(fixture.worktrees, basename(fixture.repo), 'remove-me')
      : join(fixture.repo, '.claude/worktrees/remove-me');
    fixture.git('worktree', 'add', '-q', '-b', 'cp-remove-fixture', path, 'main');
    shell('source "$1"; git() { if [[ "$1" == worktree && "$2" == remove ]]; then return 1; fi; command git "$@"; }; cmd_remove "$2"', 'cp-remove-fixture');
    expect(existsSync(path)).toBe(false);
    expect(fixture.git('worktree', 'list', '--porcelain')).not.toContain(`worktree ${path}`);
  });
  it('safe_rm_rf拒绝允许父目录以外的路径并保留文件', () => {
    const keep = join(fixture.base, 'keep'); mkdirSync(keep); writeFileSync(join(keep, 'sentinel'), 'keep');
    const result = fixture.run('bash', ['-c', 'source "$1"; safe_rm_rf "$2" "$3"', 'fixture', WORKTREE_MANAGE, keep, fixture.repo]);
    expect(result.status).toBe(1);
    expect(readFileSync(join(keep, 'sentinel'), 'utf8')).toBe('keep');
  });
  it('tracked cleanup通过真实bash语法检查', () => {
    expect(fixture.run('bash', ['-n', CLEANUP]).status).toBe(0);
  });
  it('未修改的native cleanup从主仓调度外部GC边界并实际完成本地分支清理', async () => {
    const scripts = join(fixture.base, 'cleanup-image'); mkdirSync(scripts);
    const cleanup = join(scripts, 'cleanup.sh'); copyFileSync(CLEANUP, cleanup);
    writeFileSync(join(scripts, 'worktree-gc.sh'), '#!/bin/sh\npwd > "$HOME/gc-cwd"\n');
    // 调度是被测边界，GC实现不属于本用例；避免macOS没有setsid造成平台性跳过。
    writeFileSync(join(fixture.bin, 'setsid'), '#!/bin/sh\nexec "$@"\n'); chmodSync(join(fixture.bin, 'setsid'), 0o755);
    fixture.git('branch', 'cp-cleanup-fixture');
    const result = fixture.run('bash', [cleanup, 'cp-cleanup-fixture', 'main']);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const marker = join(fixture.home, 'gc-cwd');
    for (let i = 0; i < 100 && !existsSync(marker); i++) await new Promise(resolve => setTimeout(resolve, 10));
    expect(readFileSync(marker, 'utf8').trim()).toBe(fixture.repo);
    expect(fixture.git('branch', '--list', 'cp-cleanup-fixture')).toBe('');
  });
});

describe('本仓原生工作树扫描配置', () => {
  it('.gitignore保留.claude/worktrees/', () => {
    expect(readFileSync(join(PROJECT_ROOT, '.gitignore'), 'utf8')).toContain('.claude/worktrees/');
  });
  it('Vitest排除工作树里的嵌套测试', () => {
    expect(readFileSync(join(PROJECT_ROOT, 'vitest.config.ts'), 'utf8')).toContain('**/.claude/worktrees/**');
  });
});
