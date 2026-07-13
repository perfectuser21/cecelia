/**
 * Tests for Zombie Sweep Module
 *
 * 三维清理逻辑单元测试：
 * 1. Stale Worktree
 * 2. Orphan Process
 * 3. Stale Lock Slot
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn()
}));

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  rmSync: vi.fn(),
  readFileSync: vi.fn(),
  statSync: vi.fn()
}));

// Mock db
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn()
  }
}));

// Mock event-bus
vi.mock('../event-bus.js', () => ({
  emit: vi.fn()
}));

// Mock executor (getActiveProcesses)
vi.mock('../executor.js', () => ({
  getActiveProcesses: vi.fn()
}));

// Mock zombie-cleaner (T1 Channel 2 依赖)
vi.mock('../zombie-cleaner.js', () => ({
  findTaskIdForWorktree: vi.fn(),
  isWorktreeActive: vi.fn(),
}));

// Mock platform-utils — anyProcessHasCwdUnder 默认返回 false（无存活进程持有 cwd）
// listProcessesWithPpid 改为可直接控制返回值（不再耦合 execSync ps 输出格式）
vi.mock('../platform-utils.js', () => ({
  listProcessesWithPpid: vi.fn().mockReturnValue([]),
  anyProcessHasCwdUnder: vi.fn().mockReturnValue(false),
  IS_DARWIN: false,
  IS_LINUX: true,
}));

// Mock cleanup-lock — fs 被 mock 了，真锁会失败，pass-through 让单测走原路径
vi.mock('../utils/cleanup-lock.js', () => ({
  withLock: vi.fn(async (_opts, fn) => fn()),
  acquireLock: vi.fn().mockResolvedValue(true),
  releaseLock: vi.fn(),
  LOCK_DIR_DEFAULT: '/tmp/cecelia-cleanup.lock',
}));

import { execSync } from 'child_process';
import { existsSync, readdirSync, rmSync, readFileSync, statSync } from 'fs';
import pool from '../db.js';
import { getActiveProcesses } from '../executor.js';
import { findTaskIdForWorktree, isWorktreeActive } from '../zombie-cleaner.js';
import { listProcessesWithPpid, anyProcessHasCwdUnder } from '../platform-utils.js';
import {
  parseWorktreeList,
  sweepStaleWorktrees,
  sweepOrphanProcesses,
  sweepStaleLockSlots,
  zombieSweep,
  getZombieSweepStatus,
  isPidAlive,
  GRACE_PERIOD_MS,
  LOCK_SLOT_DIR
} from '../zombie-sweep.js';

describe('zombie-sweep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── parseWorktreeList ────────────────────────────────────────────────────

  describe('parseWorktreeList', () => {
    it('解析 git worktree list --porcelain 输出', () => {
      const output = `worktree /Users/admin/project
HEAD abc123
branch refs/heads/main

worktree /tmp/project-wt1
HEAD def456
branch refs/heads/cp-03071530-task1

worktree /tmp/project-wt2
HEAD ghi789
branch refs/heads/feature/test`;

      const result = parseWorktreeList(output);
      expect(result).toHaveLength(3);
      expect(result[0]).toMatchObject({ path: '/Users/admin/project', branch: 'main' });
      expect(result[1]).toMatchObject({ path: '/tmp/project-wt1', branch: 'cp-03071530-task1' });
      expect(result[2]).toMatchObject({ path: '/tmp/project-wt2', branch: 'feature/test' });
    });

    it('处理空输出', () => {
      expect(parseWorktreeList('')).toEqual([]);
    });

    it('处理无 branch 的 detached HEAD', () => {
      const output = `worktree /tmp/detached
HEAD abc123
detached`;
      const result = parseWorktreeList(output);
      expect(result[0].branch).toBeUndefined();
    });
  });

  // ─── isPidAlive ───────────────────────────────────────────────────────────

  describe('isPidAlive', () => {
    it('当 kill -0 成功时返回 true', () => {
      const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);
      expect(isPidAlive(1234)).toBe(true);
      killSpy.mockRestore();
    });

    it('当 kill -0 抛出时返回 false', () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
        throw new Error('ESRCH');
      });
      expect(isPidAlive(9999)).toBe(false);
      killSpy.mockRestore();
    });
  });

  // ─── sweepStaleWorktrees ──────────────────────────────────────────────────

  describe('sweepStaleWorktrees', () => {
    const MAIN_REPO = '/Users/admin/project';
    const PORCELAIN_OUTPUT = `worktree ${MAIN_REPO}
HEAD abc123
branch refs/heads/main

worktree /tmp/stale-wt
HEAD def456
branch refs/heads/cp-01010000-old-task

worktree /tmp/active-wt
HEAD ghi789
branch refs/heads/cp-02020000-active-task`;

    beforeEach(() => {
      execSync.mockImplementation((cmd) => {
        if (cmd.includes('rev-parse --show-toplevel')) return MAIN_REPO + '\n';
        if (cmd.includes('worktree list --porcelain')) return PORCELAIN_OUTPUT;
        return '';
      });
      // Guard C-1 called_by 检查默认返回空（不影响已有用例的 remove 断言）
      pool.query.mockResolvedValue({ rows: [] });
    });

    it('移除对应任务已完成的 stale worktree', async () => {
      // DB: only active-task is in_progress
      pool.query.mockResolvedValueOnce({
        rows: [{ branch: 'cp-02020000-active-task', id: '1', status: 'in_progress' }]
      });

      // stat: both worktrees are older than grace period
      statSync.mockReturnValue({ birthtimeMs: Date.now() - GRACE_PERIOD_MS - 1000 });

      const result = await sweepStaleWorktrees();

      expect(result.checked).toBe(2); // 2 non-main worktrees
      expect(result.removed).toBe(1); // stale-wt removed
      expect(result.skipped).toBe(1); // active-wt skipped
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('worktree remove --force'),
        expect.any(Object)
      );
    });

    it('grace period 内的 worktree 不删除', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] }); // no in_progress tasks

      // stat: both worktrees are within grace period
      statSync.mockReturnValue({ birthtimeMs: Date.now() - 1000 }); // 1 second old

      const result = await sweepStaleWorktrees();
      expect(result.removed).toBe(0);
      expect(result.skipped).toBe(2);
    });

    it('当前 worktree (self) 不删除', async () => {
      // Make cwd = /tmp/stale-wt
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/tmp/stale-wt');

      pool.query.mockResolvedValueOnce({ rows: [] });
      statSync.mockReturnValue({ birthtimeMs: Date.now() - GRACE_PERIOD_MS - 1000 });

      const result = await sweepStaleWorktrees();
      expect(result.skipped).toBeGreaterThanOrEqual(1);

      // verify /tmp/stale-wt was not removed
      const removeCalls = execSync.mock.calls.filter(c =>
        c[0].includes('worktree remove') && c[0].includes('/tmp/stale-wt')
      );
      expect(removeCalls).toHaveLength(0);

      cwdSpy.mockRestore();
    });

    it('git 命令失败时返回 error', async () => {
      execSync.mockImplementation((cmd) => {
        if (cmd.includes('rev-parse --show-toplevel')) return MAIN_REPO + '\n';
        if (cmd.includes('worktree list --porcelain')) throw new Error('git error');
        return '';
      });

      const result = await sweepStaleWorktrees();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('git worktree list failed');
    });

    it('T1 Channel 2: payload.branch 缺失但 UUID + mtime 活跃 → 跳过（救援）', async () => {
      // stale-wt 的 branch 不在 inProgressBranches 里（payload 无 branch），但 UUID 命中 + mtime 活跃
      pool.query.mockResolvedValueOnce({
        rows: [
          // active-task 有 branch，正常 Channel 1 命中
          { branch: 'cp-02020000-active-task', id: 'task-uuid-1' },
          // stale-wt 对应的 task — payload 无 branch，只有 id
          { branch: null, id: 'task-uuid-stale-rescue' },
        ],
      });
      statSync.mockReturnValue({ birthtimeMs: Date.now() - GRACE_PERIOD_MS - 1000 });

      findTaskIdForWorktree.mockImplementation((wtPath) => {
        if (wtPath === '/tmp/stale-wt') return 'task-uuid-stale-rescue';
        return null;
      });
      isWorktreeActive.mockImplementation((wtPath) => wtPath === '/tmp/stale-wt');

      const result = await sweepStaleWorktrees();

      expect(result.removed).toBe(0); // 两个都 skip（Channel 1 + Channel 2）
      expect(result.skipped).toBe(2);
      // Channel 2 路径被调用
      expect(findTaskIdForWorktree).toHaveBeenCalledWith('/tmp/stale-wt');
      expect(isWorktreeActive).toHaveBeenCalledWith('/tmp/stale-wt');
    });

    it('Guard C-1: task in_progress + mtime stale → skip（07-10 实证，全 commit 后 .dev-mode 过期）', async () => {
      // 模拟 07-10 事故：有头会话全部 commit 后 .dev-mode mtime 过期
      // Channel 2 需要 mtime fresh（isWorktreeActive=false → miss），Guard A 通过（全 clean）
      // Guard C-1 检测到 taskId in inProgressTaskIds → 保护，不删
      pool.query.mockResolvedValueOnce({
        rows: [
          { branch: 'cp-02020000-active-task', id: 'task-uuid-1' },
          { branch: null, id: 'task-uuid-stale' }, // in_progress 但 mtime stale
        ],
      });
      statSync.mockReturnValue({ birthtimeMs: Date.now() - GRACE_PERIOD_MS - 1000 });

      findTaskIdForWorktree.mockReturnValue('task-uuid-stale');
      isWorktreeActive.mockReturnValue(false); // mtime 过期 → Channel 2 miss

      const result = await sweepStaleWorktrees();
      // Guard C-1 补正：in_progress 无 mtime 要求 → skip
      expect(result.removed).toBe(0);
      expect(result.skipped).toBe(2);
    });

    it('DB 查询失败时返回 error 且不删除任何 worktree', async () => {
      pool.query.mockRejectedValueOnce(new Error('DB connection failed'));

      const result = await sweepStaleWorktrees();
      expect(result.errors).toHaveLength(1);
      expect(result.removed).toBe(0);
    });

    it('有未提交改动的 stale worktree 不删除（数据丢失防护）', async () => {
      // active-wt 通过 Channel 1 branch 匹配跳过（保持跟其它测试一致的 DB mock 方式），
      // stale-wt 无对应 in_progress 任务，走到新加的 git status 检查
      pool.query.mockResolvedValueOnce({
        rows: [{ branch: 'cp-02020000-active-task', id: '1', status: 'in_progress' }]
      });
      statSync.mockReturnValue({ birthtimeMs: Date.now() - GRACE_PERIOD_MS - 1000 });

      execSync.mockImplementation((cmd) => {
        if (cmd.includes('rev-parse --show-toplevel')) return MAIN_REPO + '\n';
        if (cmd.includes('worktree list --porcelain')) return PORCELAIN_OUTPUT;
        if (cmd.includes('status --porcelain')) return ' M some-file.js\n'; // stale-wt 有未提交改动
        return '';
      });

      const result = await sweepStaleWorktrees();

      // 两个 worktree 都不应被删除：active-wt 因 branch 匹配跳过，stale-wt 因未提交改动跳过
      expect(result.removed).toBe(0);
      expect(result.skipped).toBe(2);
      const removeCalls = execSync.mock.calls.filter(c =>
        String(c[0]).includes('worktree remove') && String(c[0]).includes('/tmp/stale-wt')
      );
      expect(removeCalls).toHaveLength(0);
    });

    it('git status 检查本身失败时保守跳过不删除', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ branch: 'cp-02020000-active-task', id: '1', status: 'in_progress' }]
      });
      statSync.mockReturnValue({ birthtimeMs: Date.now() - GRACE_PERIOD_MS - 1000 });

      execSync.mockImplementation((cmd) => {
        if (cmd.includes('rev-parse --show-toplevel')) return MAIN_REPO + '\n';
        if (cmd.includes('worktree list --porcelain')) return PORCELAIN_OUTPUT;
        if (cmd.includes('status --porcelain')) throw new Error('not a git repo');
        return '';
      });

      const result = await sweepStaleWorktrees();
      const removeCalls = execSync.mock.calls.filter(c => String(c[0]).includes('worktree remove'));
      expect(removeCalls).toHaveLength(0);
    });

    it('clean worktree 正常删除（git status 守卫不阻断）', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] }); // no in_progress tasks

      statSync.mockReturnValue({ birthtimeMs: Date.now() - GRACE_PERIOD_MS - 1000 });

      execSync.mockImplementation((cmd) => {
        if (cmd.includes('rev-parse --show-toplevel')) return MAIN_REPO + '\n';
        if (cmd.includes('worktree list --porcelain')) return PORCELAIN_OUTPUT;
        if (cmd.includes('status --porcelain')) return ''; // clean
        if (cmd.includes('worktree remove')) return '';
        return '';
      });

      const result = await sweepStaleWorktrees();

      expect(result.removed).toBe(2);
      expect(result.skipped).toBe(0);
    });

    // ─── Guard C ────────────────────────────────────────────────────────────
    describe('Guard C', () => {
      // 公共 setup：stale-wt 无 in_progress 任务匹配 + git status 干净
      beforeEach(() => {
        pool.query.mockResolvedValueOnce({
          rows: [{ branch: 'cp-02020000-active-task', id: 'task-uuid-active' }],
        });
        statSync.mockReturnValue({ birthtimeMs: Date.now() - GRACE_PERIOD_MS - 1000 });
        execSync.mockImplementation((cmd) => {
          if (cmd.includes('rev-parse --show-toplevel')) return MAIN_REPO + '\n';
          if (cmd.includes('worktree list --porcelain')) return PORCELAIN_OUTPUT;
          if (cmd.includes('status --porcelain')) return ''; // Guard A 通过
          if (cmd.includes('worktree remove')) return '';
          return '';
        });
        findTaskIdForWorktree.mockReturnValue(null);
        isWorktreeActive.mockReturnValue(false);
        anyProcessHasCwdUnder.mockReturnValue(false); // 默认无存活进程
      });

      it('C-1: task claimed_by 非空（branch 匹配）→ skip', async () => {
        // 第一次 pool.query 已由 beforeEach 消费（initial DB query），
        // Guard C-1 branch check 使用默认 mockResolvedValue({ rows: [] })
        // 这里覆盖 branch check 结果：claimed_by IS NOT NULL 命中
        pool.query
          .mockResolvedValueOnce({ rows: [{ id: 'task-claimed' }] }); // Guard C-1 claimed_by check

        const result = await sweepStaleWorktrees();

        // stale-wt 被 Guard C-1 保护，active-wt 被 Channel 1 skip
        expect(result.removed).toBe(0);
        expect(result.skipped).toBe(2);
        const removeCalls = execSync.mock.calls.filter(c =>
          String(c[0]).includes('worktree remove') && String(c[0]).includes('/tmp/stale-wt')
        );
        expect(removeCalls).toHaveLength(0);
      });

      it('C-2: 存活进程持有 cwd → skip', async () => {
        anyProcessHasCwdUnder.mockReturnValue(true); // 存活进程在 worktree 内

        const result = await sweepStaleWorktrees();

        expect(result.removed).toBe(0);
        expect(result.skipped).toBe(2); // stale-wt (Guard C-2) + active-wt (Channel 1)
        expect(anyProcessHasCwdUnder).toHaveBeenCalledWith('/tmp/stale-wt');
      });

      it('C-2: 进程已死 → 正常删除', async () => {
        anyProcessHasCwdUnder.mockReturnValue(false);

        const result = await sweepStaleWorktrees();

        // stale-wt 无保护 → remove; active-wt Channel 1 skip
        expect(result.removed).toBe(1);
      });

      it('C-2: cwd 检查抛出异常 → 保守 skip', async () => {
        anyProcessHasCwdUnder.mockImplementation(() => { throw new Error('lsof failed'); });

        const result = await sweepStaleWorktrees();

        // 保守 skip：宁可漏删不误删
        expect(result.removed).toBe(0);
        const removeCalls = execSync.mock.calls.filter(c =>
          String(c[0]).includes('worktree remove') && String(c[0]).includes('/tmp/stale-wt')
        );
        expect(removeCalls).toHaveLength(0);
      });

      it('C-1 claimed_by 检查抛出异常 → 保守 skip', async () => {
        // Guard C-1 第一个 pool.query（initial DB）已由 beforeEach mockResolvedValueOnce 消费
        // 第二个调用（Guard C-1 branch check）抛出
        pool.query.mockRejectedValueOnce(new Error('DB timeout'));

        const result = await sweepStaleWorktrees();

        expect(result.removed).toBe(0);
      });
    });
  });

  // ─── sweepOrphanProcesses ─────────────────────────────────────────────────

  describe('sweepOrphanProcesses', () => {
    it('杀死 ppid=1 的孤儿 claude 进程', async () => {
      vi.useFakeTimers();

      listProcessesWithPpid.mockReturnValueOnce([
        { pid: 1001, ppid: 100, cmd: 'claude -p "do stuff"' },
        { pid: 1002, ppid: 1,   cmd: 'claude' },   // 孤儿 subagent
        { pid: 100,  ppid: 1,   cmd: 'bash' },     // 非 claude
      ]);

      getActiveProcesses.mockReturnValue([{ pid: 1001, taskId: 'task-1' }]);
      pool.query.mockResolvedValueOnce({ rows: [] });
      existsSync.mockReturnValue(false);

      const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid, sig) => {
        if (sig === 0) throw new Error('ESRCH');
        return undefined;
      });

      const sweepPromise = sweepOrphanProcesses();
      await vi.runAllTimersAsync();
      const result = await sweepPromise;

      expect(result.checked).toBe(2);
      expect(result.killed).toBe(1);

      killSpy.mockRestore();
      vi.useRealTimers();
    });

    it('tracked 进程的子进程（subagent）不被杀', async () => {
      vi.useFakeTimers();

      listProcessesWithPpid.mockReturnValueOnce([
        { pid: 1001, ppid: 100,  cmd: 'claude -p "task"' },
        { pid: 1002, ppid: 1001, cmd: 'claude' },  // subagent of tracked
        { pid: 100,  ppid: 1,   cmd: 'bash' },
      ]);

      getActiveProcesses.mockReturnValue([{ pid: 1001, taskId: 'task-1' }]);
      pool.query.mockResolvedValueOnce({ rows: [] });
      existsSync.mockReturnValue(false);

      const killSpy = vi.spyOn(process, 'kill').mockReturnValue(undefined);

      const sweepPromise = sweepOrphanProcesses();
      await vi.runAllTimersAsync();
      const result = await sweepPromise;

      expect(result.killed).toBe(0);

      killSpy.mockRestore();
      vi.useRealTimers();
    });

    it('交互式 claude 会话（非 -p，ppid!=1）不被杀', async () => {
      vi.useFakeTimers();

      listProcessesWithPpid.mockReturnValueOnce([
        { pid: 2001, ppid: 500, cmd: 'claude' },  // 交互式会话
        { pid: 500,  ppid: 1,   cmd: 'zsh' },
      ]);

      getActiveProcesses.mockReturnValue([]);
      pool.query.mockResolvedValueOnce({ rows: [] });
      existsSync.mockReturnValue(false);

      const killSpy = vi.spyOn(process, 'kill').mockReturnValue(undefined);

      const sweepPromise = sweepOrphanProcesses();
      await vi.runAllTimersAsync();
      const result = await sweepPromise;

      expect(result.killed).toBe(0);

      killSpy.mockRestore();
      vi.useRealTimers();
    });

    it('ps 无 claude 进程时返回空结果', async () => {
      listProcessesWithPpid.mockReturnValueOnce([
        { pid: 1,   ppid: 0, cmd: 'launchd' },
        { pid: 100, ppid: 1, cmd: 'bash' },
      ]);

      getActiveProcesses.mockReturnValue([]);

      const result = await sweepOrphanProcesses();
      expect(result.checked).toBe(0);
      expect(result.killed).toBe(0);
    });

    it('DB 失败时不杀任何进程（保守策略）', async () => {
      listProcessesWithPpid.mockReturnValueOnce([
        { pid: 5001, ppid: 1, cmd: 'claude -p "orphan"' },
      ]);
      getActiveProcesses.mockReturnValue([]);
      pool.query.mockRejectedValueOnce(new Error('DB error'));

      const killSpy = vi.spyOn(process, 'kill').mockReturnValue(undefined);
      const result = await sweepOrphanProcesses();

      expect(result.killed).toBe(0);
      expect(result.errors).toHaveLength(1);
      killSpy.mockRestore();
    });

    it('lock slot 中的 PID 受保护', async () => {
      vi.useFakeTimers();

      listProcessesWithPpid.mockReturnValueOnce([
        { pid: 3001, ppid: 1, cmd: 'claude -p "task"' },  // ppid=1 但在 lock slot 中
      ]);

      getActiveProcesses.mockReturnValue([]);
      pool.query.mockResolvedValueOnce({ rows: [] });

      existsSync.mockImplementation(() => true);
      readdirSync.mockReturnValue(['slot-0']);
      readFileSync.mockReturnValue(JSON.stringify({ pid: 3001, child_pid: 3002 }));

      const killSpy = vi.spyOn(process, 'kill').mockReturnValue(undefined);

      const sweepPromise = sweepOrphanProcesses();
      await vi.runAllTimersAsync();
      const result = await sweepPromise;

      expect(result.killed).toBe(0);

      killSpy.mockRestore();
      vi.useRealTimers();
    });
  });

  // ─── sweepStaleLockSlots ──────────────────────────────────────────────────

  describe('sweepStaleLockSlots', () => {
    beforeEach(() => {
      existsSync.mockReturnValue(true);
    });

    it('删除对应进程已死亡的 lock slot', () => {
      readdirSync.mockReturnValue(['slot-abc', 'slot-def']);
      existsSync.mockImplementation((p) => {
        // info.json exists for both
        return true;
      });
      readFileSync.mockImplementation((p) => {
        if (p.includes('slot-abc')) return JSON.stringify({ pid: 9991 });
        return JSON.stringify({ pid: 9992 });
      });

      // Both PIDs are dead
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
        throw new Error('ESRCH');
      });

      sweepStaleLockSlots().then(result => {
        expect(result.checked).toBe(2);
        expect(result.removed).toBe(2);
        expect(rmSync).toHaveBeenCalledTimes(2);
      });

      killSpy.mockRestore();
    });

    it('存活进程的 lock slot 不删除', async () => {
      readdirSync.mockReturnValue(['slot-alive']);
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue(JSON.stringify({ pid: 1234 }));

      // PID 1234 is alive
      const killSpy = vi.spyOn(process, 'kill').mockReturnValue(undefined); // kill -0 succeeds

      const result = await sweepStaleLockSlots();
      expect(result.removed).toBe(0);

      killSpy.mockRestore();
    });

    it('lock slot 目录不存在时直接返回', async () => {
      existsSync.mockReturnValue(false);
      const result = await sweepStaleLockSlots();
      expect(result.checked).toBe(0);
    });

    it('无 info.json 的 slot 被视为 stale 删除', async () => {
      readdirSync.mockReturnValue(['slot-nojson']);
      existsSync.mockImplementation((p) => {
        if (p.includes('info.json')) return false;
        return true; // slot dir exists, lock dir exists
      });

      const result = await sweepStaleLockSlots();
      expect(result.removed).toBe(1);
      expect(rmSync).toHaveBeenCalledTimes(1);
    });
  });

  // ─── zombieSweep (integration) ────────────────────────────────────────────

  describe('zombieSweep', () => {
    it('运行三维清理并写入 working_memory', async () => {
      // No git worktree to sweep
      execSync.mockImplementation((cmd) => {
        if (cmd.includes('rev-parse --show-toplevel')) return '/repo\n';
        if (cmd.includes('worktree list --porcelain')) return 'worktree /repo\nHEAD abc\nbranch refs/heads/main\n';
        if (cmd.includes('ps -eo')) return '    1     0 launchd\n';
        return '';
      });
      existsSync.mockReturnValue(false); // no lock slot dir
      getActiveProcesses.mockReturnValue([]);
      pool.query.mockResolvedValue({ rows: [] });

      const result = await zombieSweep();

      expect(result).toHaveProperty('started_at');
      expect(result).toHaveProperty('completed_at');
      expect(result.worktrees).toHaveProperty('checked');
      expect(result.processes).toHaveProperty('killed');
      expect(result.lock_slots).toHaveProperty('removed');

      // working_memory write: SQL contains 'working_memory', params contain key
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('working_memory'),
        expect.arrayContaining(['zombie_sweep_result'])
      );
    });

    it('单个维度失败不影响其他维度', async () => {
      // git rev-parse 失败 -> worktree sweep 返回 error
      execSync.mockImplementation((cmd) => {
        if (cmd.includes('rev-parse')) throw new Error('git not found');
        if (cmd.includes('ps -eo')) return '    1     0 launchd\n';
        return '';
      });
      existsSync.mockReturnValue(false);
      getActiveProcesses.mockReturnValue([]);
      pool.query.mockResolvedValue({ rows: [] });

      const result = await zombieSweep();
      expect(result.worktrees.errors.length).toBeGreaterThan(0);
      expect(result.completed_at).toBeTruthy(); // still completes
    });
  });

  // ─── getZombieSweepStatus ─────────────────────────────────────────────────

  describe('getZombieSweepStatus', () => {
    it('返回 working_memory 中的上次结果', async () => {
      const mockData = { started_at: '2026-03-07T01:00:00Z', worktrees: { removed: 2 } };
      pool.query.mockResolvedValueOnce({
        rows: [{ value_json: mockData, updated_at: new Date() }]
      });

      const status = await getZombieSweepStatus();
      expect(status.last_sweep).toEqual(mockData);
    });

    it('无数据时返回 null', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      const status = await getZombieSweepStatus();
      expect(status).toBeNull();
    });

    it('DB 失败时返回 null', async () => {
      pool.query.mockRejectedValueOnce(new Error('DB error'));
      const status = await getZombieSweepStatus();
      expect(status).toBeNull();
    });
  });
});
