import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { nativeWorktreeFixture, WORKTREE_MANAGE, worktreePathFromOutput } from '../helpers/native-worktree-fixture';

// guardian若继承创建锁FD201，父进程退出后下一次create仍会被锁住。
describe('tracked worktree-manage FD201 guardian回归', () => {
  let fixture: ReturnType<typeof nativeWorktreeFixture>;
  beforeEach(() => { fixture = nativeWorktreeFixture(); });
  afterEach(() => { fixture.dispose(); });
  function create(name: string) {
    const result = fixture.run('bash', [WORKTREE_MANAGE, 'create', name]);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    return worktreePathFromOutput(result.stdout);
  }
  it('显式WORKTREE_BASE不向隔离HOME的默认worktrees目录泄漏', () => {
    const path = create('first');
    expect(path).toBe(join(fixture.worktrees, basename(fixture.repo), 'first'));
    expect(existsSync(path)).toBe(true);
    expect(existsSync(join(fixture.home, 'worktrees'))).toBe(false);
  });
  it('真实guardian存活时父进程已释放FD201，锁可重取且第二次create成功', () => {
    create('first');
    const lights = fixture.guardians();
    expect(lights).toHaveLength(1);
    const owner = fixture.run('ps', ['-p', String(lights[0].guardian_pid), '-o', 'args=']);
    expect(owner.status, owner.stderr).toBe(0);
    expect(owner.stdout).toContain(join(fixture.repo, '.cecelia/hb.sh'));
    const relock = fixture.run('flock', ['-n', join(fixture.repo, '.git/worktree-create.lock'), 'true']);
    expect(relock.status, relock.stderr).toBe(0);
    expect(create('second')).toBe(join(fixture.worktrees, basename(fixture.repo), 'second'));
    expect(fixture.guardians()).toHaveLength(2);
  });
  it('fork入口显式关闭201，静态防线补充真实锁回归', () => {
    const lines = readFileSync(WORKTREE_MANAGE, 'utf8').split('\n').filter(line => /nohup\s+bash/.test(line));
    expect(lines.some(line => line.includes('201>&-'))).toBe(true);
  });
});
