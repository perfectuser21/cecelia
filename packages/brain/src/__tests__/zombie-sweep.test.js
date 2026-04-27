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

    it('T1 Channel 2: UUID 命中但 mtime stale → 仍清理（短路失效）', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          { branch: 'cp-02020000-active-task', id: 'task-uuid-1' },
          { branch: null, id: 'task-uuid-stale' },
        ],
      });
      statSync.mockReturnValue({ birthtimeMs: Date.now() - GRACE_PERIOD_MS - 1000 });

      findTaskIdForWorktree.mockReturnValue('task-uuid-stale');
      isWorktreeActive.mockReturnValue(false); // mtime 都过期

      const result = await sweepStaleWorktrees();
      // Channel 2 的 AND isWorktreeActive 条件失败 → stale-wt 被清
      expect(result.removed).toBe(1);
    });

    it('DB 查询失败时返回 error 且不删除任何 worktree', async () => {
      pool.query.mockRejectedValueOnce(new Error('DB connection failed'));

      const result = await sweepStaleWorktrees();
      expect(result.errors).toHaveLength(1);
      expect(result.removed).toBe(0);
    });
  });

  // ─── sweepOrphanProcesses ─────────────────────────────────────────────────

  describe('sweepOrphanProcesses', () => {
    // 模拟 ps -eo pid=,ppid=,args= 的输出
    const makePsOutput = (procs) =>
      procs.map(p => `  ${p.pid}   ${p.ppid} ${p.cmd}`).join('\n');

    it('杀死 ppid=1 的孤儿 claude 进程', async () => {
      vi.useFakeTimers();

      // ps 返回：tracked claude -p 进程 + 孤儿 subagent（ppid=1）
      execSync.mockReturnValueOnce(makePsOutput([
        { pid: 1001, ppid: 100, cmd: 'claude -p "do stuff"' },
        { pid: 1002, ppid: 1, cmd: 'claude' },    // 孤儿 subagent
        { pid: 100, ppid: 1, cmd: 'bash' },        // 非 claude 进程
      ]));

      getActiveProcesses.mockReturnValue([{ pid: 1001, taskId: 'task-1' }]);
      pool.query.mockResolvedValueOnce({ rows: [] });
      existsSync.mockReturnValue(false); // no lock slot dir

      const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid, sig) => {
        if (sig === 0) throw new Error('ESRCH');
        return undefined;
      });

      const sweepPromise = sweepOrphanProcesses();
      await vi.runAllTimersAsync();
      const result = await sweepPromise;

      // 1001 tracked, 1002 孤儿 → 2 checked, 1 killed
      expect(result.checked).toBe(2);
      expect(result.killed).toBe(1);

      killSpy.mockRestore();
      vi.useRealTimers();
    });

    it('tracked 进程的子进程（subagent）不被杀', async () => {
      vi.useFakeTimers();

      // ps: tracked 主进程 1001，其 subagent 1002（ppid=1001）
      execSync.mockReturnValueOnce(makePsOutput([
        { pid: 1001, ppid: 100, cmd: 'claude -p "task"' },
        { pid: 1002, ppid: 1001, cmd: 'claude' },   // subagent of tracked
        { pid: 100, ppid: 1, cmd: 'bash' },
      ]));

      getActiveProcesses.mockReturnValue([{ pid: 1001, taskId: 'task-1' }]);
      pool.query.mockResolvedValueOnce({ rows: [] });
      existsSync.mockReturnValue(false);

      const killSpy = vi.spyOn(process, 'kill').mockReturnValue(undefined);

      const sweepPromise = sweepOrphanProcesses();
      await vi.runAllTimersAsync();
      const result = await sweepPromise;

      // 1002 是 1001 的后代，不应被杀
      expect(result.killed).toBe(0);

      killSpy.mockRestore();
      vi.useRealTimers();
    });

    it('交互式 claude 会话（非 -p，ppid!=1）不被杀', async () => {
      vi.useFakeTimers();

      // ps: 用户手动启动的 claude（没有 -p，ppid 不是 1）
      execSync.mockReturnValueOnce(makePsOutput([
        { pid: 2001, ppid: 500, cmd: 'claude' },   // 交互式会话
        { pid: 500, ppid: 1, cmd: 'zsh' },
      ]));

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
      // ps 返回非 claude 进程
      execSync.mockReturnValueOnce(makePsOutput([
        { pid: 1, ppid: 0, cmd: 'launchd' },
        { pid: 100, ppid: 1, cmd: 'bash' },
      ]));

      getActiveProcesses.mockReturnValue([]);

      const result = await sweepOrphanProcesses();
      expect(result.checked).toBe(0);
      expect(result.killed).toBe(0);
    });

    it('DB 失败时不杀任何进程（保守策略）', async () => {
      execSync.mockReturnValueOnce(makePsOutput([
        { pid: 5001, ppid: 1, cmd: 'claude -p "orphan"' },
      ]));
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

      execSync.mockReturnValueOnce(makePsOutput([
        { pid: 3001, ppid: 1, cmd: 'claude -p "task"' },   // ppid=1 但在 lock slot 中
      ]));

      getActiveProcesses.mockReturnValue([]);
      pool.query.mockResolvedValueOnce({ rows: [] });

      // lock slot 包含 pid 3001
      existsSync.mockImplementation((p) => true);
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
