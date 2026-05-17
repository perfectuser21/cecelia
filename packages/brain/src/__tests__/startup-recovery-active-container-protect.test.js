/**
 * startup-recovery.js — docker container 活跃性保护测试（W7.3 升级）
 *
 * 背景：W7.3 PR #2812 加了 .dev-lock / .dev-mode 保护但没覆盖 docker container 层
 * 活跃 worktree。2026-05-07 实证：W8 task-39d535f3 跑到 reviewer 时 Brain 重启
 * → harness-v2/task-39d535f3 被整个 rm -rf。
 *
 * 三条 [BEHAVIOR]:
 *   1) docker ps 报告活跃 container mount 了某 worktree → 不删
 *   2) docker probe 失败（命令报错）→ 保守跳过删除，记 warn 不抛
 *   3) docker probe 返回空 / 路径不匹配 → 仍按既有逻辑删除真正 orphan
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({ execSync: vi.fn() }));
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  rmSync: vi.fn(),
  readFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  statSync: vi.fn(),
}));
vi.mock('../utils/cleanup-lock.js', () => ({
  withLock: vi.fn(async (_opts, fn) => fn()),
  acquireLock: vi.fn().mockResolvedValue(true),
  releaseLock: vi.fn(),
  LOCK_DIR_DEFAULT: '/tmp/cecelia-cleanup.lock',
}));

import { execSync } from 'child_process';
import { existsSync, readdirSync, rmSync } from 'fs';
import { cleanupStaleWorktrees, getActiveContainerMountPaths } from '../startup-recovery.js';

const TEST_REPO = '/tmp/test-repo';
const TEST_WORKTREES = '/tmp/test-worktrees';

describe('startup-recovery docker container 活跃性保护', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('[BEHAVIOR] 活跃 container mount 了 worktree → 不删，跳过并记日志', async () => {
    const wtName = 'harness-v2-task-39d535f3';
    const wtPath = `${TEST_WORKTREES}/${wtName}`;

    execSync.mockImplementation((cmd) => {
      if (cmd.startsWith('git worktree prune')) return '';
      if (cmd.startsWith('git worktree list')) return 'worktree /tmp/test-repo\n'; // 没列 wtPath（race）
      if (cmd.startsWith('docker ps')) return 'abc123\n';
      if (cmd.startsWith('docker inspect')) {
        return JSON.stringify([{ Type: 'bind', Source: wtPath, Destination: '/workspace' }]);
      }
      return '';
    });

    existsSync.mockReturnValue(true);
    readdirSync.mockImplementation((path) => {
      if (path === TEST_WORKTREES) {
        return [{ name: wtName, isDirectory: () => true }];
      }
      return [];
    });

    const stats = await cleanupStaleWorktrees({ repoRoot: TEST_REPO, worktreeBase: TEST_WORKTREES });

    expect(rmSync).not.toHaveBeenCalled();
    expect(stats.removed).toBe(0);
    expect(stats.skipped_active_container).toBeGreaterThanOrEqual(1);
  });

  it('[BEHAVIOR] docker ps 失败 → 保守跳过删除，不抛错，记 warn', async () => {
    const wtName = 'cp-some-stale';

    execSync.mockImplementation((cmd) => {
      if (cmd.startsWith('git worktree prune')) return '';
      if (cmd.startsWith('git worktree list')) return 'worktree /tmp/test-repo\n';
      if (cmd.startsWith('docker ps')) {
        throw new Error('docker daemon not running');
      }
      return '';
    });

    existsSync.mockReturnValue(true);
    readdirSync.mockImplementation((path) => {
      if (path === TEST_WORKTREES) {
        return [{ name: wtName, isDirectory: () => true }];
      }
      return [];
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const stats = await cleanupStaleWorktrees({ repoRoot: TEST_REPO, worktreeBase: TEST_WORKTREES });

    expect(rmSync).not.toHaveBeenCalled();
    expect(stats.removed).toBe(0);
    expect(stats.skipped_docker_probe).toBeGreaterThanOrEqual(1);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('[BEHAVIOR] docker ps 返回空 → 仍按既有逻辑删除真正 orphan', async () => {
    const wtName = 'truly-orphan';

    execSync.mockImplementation((cmd) => {
      if (cmd.startsWith('git worktree prune')) return '';
      if (cmd.startsWith('git worktree list')) return 'worktree /tmp/test-repo\n';
      if (cmd.startsWith('docker ps')) return '';
      return '';
    });

    existsSync.mockReturnValue(true);
    readdirSync.mockImplementation((path) => {
      if (path === TEST_WORKTREES) {
        return [{ name: wtName, isDirectory: () => true }];
      }
      return [];
    });

    const stats = await cleanupStaleWorktrees({ repoRoot: TEST_REPO, worktreeBase: TEST_WORKTREES });

    expect(rmSync).toHaveBeenCalledWith(
      expect.stringContaining(wtName),
      { recursive: true, force: true }
    );
    expect(stats.removed).toBe(1);
  });

  it('[BEHAVIOR] docker container mount 路径与 worktree 不重叠 → 仍删 orphan', async () => {
    const wtName = 'truly-orphan-2';

    execSync.mockImplementation((cmd) => {
      if (cmd.startsWith('git worktree prune')) return '';
      if (cmd.startsWith('git worktree list')) return 'worktree /tmp/test-repo\n';
      if (cmd.startsWith('docker ps')) return 'xyz999\n';
      if (cmd.startsWith('docker inspect')) {
        return JSON.stringify([{ Type: 'bind', Source: '/var/lib/postgres', Destination: '/data' }]);
      }
      return '';
    });

    existsSync.mockReturnValue(true);
    readdirSync.mockImplementation((path) => {
      if (path === TEST_WORKTREES) {
        return [{ name: wtName, isDirectory: () => true }];
      }
      return [];
    });

    const stats = await cleanupStaleWorktrees({ repoRoot: TEST_REPO, worktreeBase: TEST_WORKTREES });

    expect(rmSync).toHaveBeenCalled();
    expect(stats.removed).toBe(1);
  });
});

describe('getActiveContainerMountPaths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('返回所有活跃 container 的 mount source 集合', () => {
    execSync.mockImplementation((cmd) => {
      if (cmd.startsWith('docker ps')) return 'c1\nc2\n';
      if (cmd.includes('inspect') && cmd.includes('c1')) {
        return JSON.stringify([{ Source: '/path/a', Destination: '/x' }]);
      }
      if (cmd.includes('inspect') && cmd.includes('c2')) {
        return JSON.stringify([
          { Source: '/path/b', Destination: '/y' },
          { Source: '/path/c', Destination: '/z' },
        ]);
      }
      return '';
    });

    const paths = getActiveContainerMountPaths();
    expect(paths.has('/path/a')).toBe(true);
    expect(paths.has('/path/b')).toBe(true);
    expect(paths.has('/path/c')).toBe(true);
  });

  it('docker ps 抛错 → 函数本身抛错（让 caller 决定降级策略）', () => {
    execSync.mockImplementation((cmd) => {
      if (cmd.startsWith('docker ps')) throw new Error('docker not found');
      return '';
    });

    expect(() => getActiveContainerMountPaths()).toThrow();
  });
});
