/**
 * startup-recovery.js 增强功能单元测试
 *
 * 覆盖：
 * - cleanupStaleWorktrees: git worktree prune + 删除孤立目录
 * - cleanupStaleLockSlots: 检查 pid 存活，释放无主 slot
 * - cleanupStaleDevModeFiles: 删除死分支的 .dev-mode* 文件
 * - runStartupRecovery: 串联调用并输出清理统计
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({ execSync: vi.fn() }));
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  rmSync: vi.fn(),
  readFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

import { execSync } from 'child_process';
import { existsSync, readdirSync, rmSync, readFileSync, unlinkSync } from 'fs';
import {
  cleanupStaleWorktrees,
  cleanupStaleLockSlots,
  cleanupStaleDevModeFiles,
  runStartupRecovery,
} from '../startup-recovery.js';

const TEST_REPO = '/tmp/test-repo';
const TEST_WORKTREES = '/tmp/test-worktrees';
const TEST_LOCK_DIR = '/tmp/test-locks';

describe('cleanupStaleWorktrees', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('成功 prune 并删除不在 worktree list 中的孤立目录', async () => {
    // git worktree prune 成功
    execSync.mockReturnValueOnce('');
    // git worktree list --porcelain 返回只有 main worktree
    execSync.mockReturnValueOnce('worktree /tmp/test-repo\nHEAD abc123\nbranch refs/heads/main\n');

    existsSync.mockReturnValue(true);
    readdirSync.mockReturnValue([
      { name: 'stale-wt', isDirectory: () => true },
      { name: 'not-a-dir', isDirectory: () => false },
    ]);
    rmSync.mockReturnValue(undefined);

    const stats = await cleanupStaleWorktrees({ repoRoot: TEST_REPO, worktreeBase: TEST_WORKTREES });

    expect(stats.pruned).toBe(1);
    expect(stats.removed).toBe(1); // stale-wt removed
    expect(stats.errors).toHaveLength(0);
    expect(rmSync).toHaveBeenCalledWith(
      expect.stringContaining('stale-wt'),
      { recursive: true, force: true }
    );
  });

  it('worktree prune 失败时：记录 errors，继续扫描目录', async () => {
    execSync.mockImplementationOnce(() => { throw new Error('git error'); });
    execSync.mockReturnValueOnce('worktree /tmp/test-repo\n');

    existsSync.mockReturnValue(true);
    readdirSync.mockReturnValue([]);

    const stats = await cleanupStaleWorktrees({ repoRoot: TEST_REPO, worktreeBase: TEST_WORKTREES });

    expect(stats.pruned).toBe(0);
    expect(stats.errors).toHaveLength(1);
    expect(stats.errors[0]).toContain('prune');
  });

  it('WORKTREE_BASE 不存在时：跳过扫描，不报错', async () => {
    execSync.mockReturnValue('');
    existsSync.mockReturnValue(false);

    const stats = await cleanupStaleWorktrees({ repoRoot: TEST_REPO, worktreeBase: '/nonexistent' });

    expect(stats.removed).toBe(0);
    expect(rmSync).not.toHaveBeenCalled();
  });

  it('目录在 active paths 中时：不删除', async () => {
    execSync.mockReturnValueOnce('');
    execSync.mockReturnValueOnce(`worktree ${TEST_WORKTREES}/active-wt\nHEAD abc\n`);

    existsSync.mockReturnValue(true);
    readdirSync.mockReturnValue([
      { name: 'active-wt', isDirectory: () => true },
    ]);

    const stats = await cleanupStaleWorktrees({ repoRoot: TEST_REPO, worktreeBase: TEST_WORKTREES });

    expect(stats.removed).toBe(0);
    expect(rmSync).not.toHaveBeenCalled();
  });
});

describe('cleanupStaleLockSlots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lockDir 不存在时：直接返回空统计', async () => {
    existsSync.mockReturnValue(false);

    const stats = await cleanupStaleLockSlots({ lockDir: '/nonexistent' });

    expect(stats.slots_freed).toBe(0);
    expect(stats.errors).toHaveLength(0);
  });

  it('进程不存在（ESRCH）时：释放 slot', async () => {
    existsSync.mockImplementation(path => {
      if (path === TEST_LOCK_DIR) return true;
      if (path.includes('info.json')) return true;
      if (path.includes('slot-0')) return true;
      return false;
    });
    readdirSync.mockReturnValue([
      { name: 'slot-0', isDirectory: () => true },
    ]);
    readFileSync.mockReturnValue(JSON.stringify({ pid: 99999, task_id: 'task-1' }));
    // process.kill(99999, 0) throws ESRCH
    const killSpy = vi.spyOn(process, 'kill').mockImplementationOnce(() => {
      const err = new Error('No such process');
      err.code = 'ESRCH';
      throw err;
    });
    rmSync.mockReturnValue(undefined);

    const stats = await cleanupStaleLockSlots({ lockDir: TEST_LOCK_DIR });

    expect(stats.slots_freed).toBe(1);
    expect(rmSync).toHaveBeenCalledWith(expect.stringContaining('slot-0'), { recursive: true, force: true });
    killSpy.mockRestore();
  });

  it('进程存活（EPERM）时：保留 slot', async () => {
    existsSync.mockImplementation(path => {
      if (path === TEST_LOCK_DIR) return true;
      if (path.includes('info.json')) return true;
      if (path.includes('slot-1')) return true;
      return false;
    });
    readdirSync.mockReturnValue([
      { name: 'slot-1', isDirectory: () => true },
    ]);
    readFileSync.mockReturnValue(JSON.stringify({ pid: 1234, task_id: 'task-2' }));
    const killSpy = vi.spyOn(process, 'kill').mockImplementationOnce(() => {
      const err = new Error('Operation not permitted');
      err.code = 'EPERM';
      throw err;
    });

    const stats = await cleanupStaleLockSlots({ lockDir: TEST_LOCK_DIR });

    expect(stats.slots_freed).toBe(0);
    expect(rmSync).not.toHaveBeenCalled();
    killSpy.mockRestore();
  });

  it('进程存活（kill 返回正常）时：保留 slot', async () => {
    existsSync.mockImplementation(path => {
      if (path === TEST_LOCK_DIR) return true;
      if (path.includes('info.json')) return true;
      return false;
    });
    readdirSync.mockReturnValue([
      { name: 'slot-2', isDirectory: () => true },
    ]);
    readFileSync.mockReturnValue(JSON.stringify({ pid: 5678 }));
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);

    const stats = await cleanupStaleLockSlots({ lockDir: TEST_LOCK_DIR });

    expect(stats.slots_freed).toBe(0);
    killSpy.mockRestore();
  });

  it('info.json 不存在时：视为孤立 slot，删除', async () => {
    existsSync.mockImplementation(path => {
      if (path === TEST_LOCK_DIR) return true;
      if (path.includes('slot-3')) return true;
      if (path.includes('info.json')) return false;
      return false;
    });
    readdirSync.mockReturnValue([
      { name: 'slot-3', isDirectory: () => true },
    ]);
    rmSync.mockReturnValue(undefined);

    const stats = await cleanupStaleLockSlots({ lockDir: TEST_LOCK_DIR });

    expect(stats.slots_freed).toBe(1);
  });

  it('info.json JSON 损坏时：视为孤立 slot', async () => {
    existsSync.mockImplementation(path => {
      if (path === TEST_LOCK_DIR) return true;
      if (path.includes('slot-4')) return true;
      if (path.includes('info.json')) return true;
      return false;
    });
    readdirSync.mockReturnValue([
      { name: 'slot-4', isDirectory: () => true },
    ]);
    readFileSync.mockReturnValue('{ invalid json }');
    rmSync.mockReturnValue(undefined);

    const stats = await cleanupStaleLockSlots({ lockDir: TEST_LOCK_DIR });

    expect(stats.slots_freed).toBe(1);
  });

  it('非 slot-* 目录被忽略', async () => {
    existsSync.mockReturnValue(true);
    readdirSync.mockReturnValue([
      { name: 'other-dir', isDirectory: () => true },
      { name: 'slot-file', isDirectory: () => false },
    ]);

    const stats = await cleanupStaleLockSlots({ lockDir: TEST_LOCK_DIR });

    expect(stats.slots_freed).toBe(0);
    expect(rmSync).not.toHaveBeenCalled();
  });
});

describe('cleanupStaleDevModeFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('死分支对应的 .dev-mode.* 文件被删除', async () => {
    readdirSync.mockReturnValue([
      '.dev-mode.cp-old-branch',
      '.dev-lock.cp-old-branch',
      '.dev-mode',         // no suffix → skip
      'some-other-file',
    ]);
    // git branch --list "cp-old-branch" returns empty → branch doesn't exist
    execSync.mockReturnValue('');
    unlinkSync.mockReturnValue(undefined);

    const stats = await cleanupStaleDevModeFiles({ repoRoot: TEST_REPO });

    expect(stats.devmode_cleaned).toBe(2);
    expect(unlinkSync).toHaveBeenCalledTimes(2);
  });

  it('活跃分支对应的文件不被删除', async () => {
    readdirSync.mockReturnValue(['.dev-mode.cp-active-branch']);
    // git branch --list returns non-empty → branch exists
    execSync.mockReturnValue('  cp-active-branch\n');

    const stats = await cleanupStaleDevModeFiles({ repoRoot: TEST_REPO });

    expect(stats.devmode_cleaned).toBe(0);
    expect(unlinkSync).not.toHaveBeenCalled();
  });

  it('.dev-mode（无后缀）被跳过', async () => {
    readdirSync.mockReturnValue(['.dev-mode']);

    const stats = await cleanupStaleDevModeFiles({ repoRoot: TEST_REPO });

    expect(stats.devmode_cleaned).toBe(0);
    expect(execSync).not.toHaveBeenCalled();
  });

  it('branch check 抛出异常时：保守跳过，记录 error', async () => {
    readdirSync.mockReturnValue(['.dev-mode.cp-some-branch']);
    execSync.mockImplementation(() => { throw new Error('git fail'); });

    const stats = await cleanupStaleDevModeFiles({ repoRoot: TEST_REPO });

    expect(stats.devmode_cleaned).toBe(0);
    expect(stats.errors).toHaveLength(1);
    expect(unlinkSync).not.toHaveBeenCalled();
  });
});

describe('runStartupRecovery（串联清理统计）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: execSync success, no stale entries
    execSync.mockReturnValue('');
    existsSync.mockReturnValue(false);
    readdirSync.mockReturnValue([]);
  });

  it('返回值包含 worktrees_pruned, slots_freed, devmode_cleaned 字段', async () => {
    const mockQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] }); // no orphan tasks
    const mockPool = { query: mockQuery };

    const result = await runStartupRecovery(mockPool);

    expect(result).toHaveProperty('requeued');
    expect(result).toHaveProperty('worktrees_pruned');
    expect(result).toHaveProperty('slots_freed');
    expect(result).toHaveProperty('devmode_cleaned');
  });

  it('清理失败不阻塞 DB 孤儿任务恢复', async () => {
    // Force all cleanup functions to throw by making execSync throw
    execSync.mockImplementation(() => { throw new Error('git unavailable'); });
    existsSync.mockReturnValue(false);

    const orphan = { id: 'task-uuid-1', title: '孤儿任务' };
    const mockQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [orphan] })
      .mockResolvedValueOnce({ rows: [] });
    const mockPool = { query: mockQuery };

    const result = await runStartupRecovery(mockPool);

    expect(result.requeued).toHaveLength(1);
    expect(result.requeued[0].id).toBe('task-uuid-1');
  });
});
