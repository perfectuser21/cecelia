/**
 * Tests for zombie-cleaner.js
 *
 * Section A: Tick Integration API
 * - cleanZombieSlots: stale slot 清理（lock dir + worktree + DB 状态）
 * - detectOrphanTasks: 孤儿检测（in_progress > 4h，无进程）
 * - 边界条件: < 4h 不清理，有进程仅 warn
 * - getZombieStats: 24h 统计
 *
 * Section B: Nightly Cleanup (R1/R2)
 * - cleanupStaleSlots (R1): stale slot 清理
 * - findTaskIdForWorktree: .dev-mode UUID 解析
 * - cleanupOrphanWorktrees (R2): 孤儿 worktree 识别和清理
 * - runZombieCleanup: 统一入口
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================
// Section A mocks: db.js, event-bus.js, emergency-cleanup.js
// ============================================================

vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
  },
}));

vi.mock('../event-bus.js', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../emergency-cleanup.js', () => ({
  emergencyCleanup: vi.fn(() => ({
    worktree: true,
    lock: true,
    devMode: true,
    errors: [],
  })),
}));

// ============================================================
// Section B mocks: fs, child_process, watchdog.js, executor.js
// ============================================================

vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    rmSync: vi.fn(),
    statSync: vi.fn(),
  };
});

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../watchdog.js', () => ({
  resolveTaskPids: vi.fn(),
}));

vi.mock('../executor.js', () => ({
  removeActiveProcess: vi.fn(),
}));

// ============================================================
// Section A imports
// ============================================================

import pool from '../db.js';
import { emit } from '../event-bus.js';
import { emergencyCleanup } from '../emergency-cleanup.js';
import {
  cleanZombieSlots,
  detectOrphanTasks,
  getZombieStats,
  _cleanHistory,
  ORPHAN_THRESHOLD_HOURS,
  ORPHAN_WARN_HOURS,
  cleanupStaleSlots,
  cleanupOrphanWorktrees,
  runZombieCleanup,
  findTaskIdForWorktree,
  STALE_SLOT_MIN_AGE_MS,
  ORPHAN_WORKTREE_MIN_AGE_MS,
} from '../zombie-cleaner.js';

// ============================================================
// Section B imports
// ============================================================

import { existsSync, readFileSync, rmSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { resolveTaskPids } from '../watchdog.js';
import { removeActiveProcess } from '../executor.js';

// ============================================================
// Test helpers
// ============================================================

function makePool(rows = []) {
  return {
    query: vi.fn().mockResolvedValue({ rows }),
  };
}

// ============================================================
// Section A: Tick Integration API Tests
// ============================================================

describe('zombie-cleaner — Section A: Tick Integration API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _cleanHistory.splice(0, _cleanHistory.length);
  });

  describe('constants', () => {
    it('should have ORPHAN_THRESHOLD_HOURS = 4', () => {
      expect(ORPHAN_THRESHOLD_HOURS).toBe(4);
    });

    it('should have ORPHAN_WARN_HOURS = 8', () => {
      expect(ORPHAN_WARN_HOURS).toBe(8);
    });
  });

  describe('cleanZombieSlots', () => {
    it('should return empty array when no stale slots', async () => {
      const results = await cleanZombieSlots([]);
      expect(results).toEqual([]);
    });

    it('should return empty array for null input', async () => {
      const results = await cleanZombieSlots(null);
      expect(results).toEqual([]);
    });

    it('should call emergencyCleanup and update DB for each stale slot', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'task-1' }] });

      const staleSlots = [{ slot: 'slot-0', taskId: 'task-1' }];
      const results = await cleanZombieSlots(staleSlots);

      expect(emergencyCleanup).toHaveBeenCalledWith('task-1', 'slot-0');
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE tasks'),
        ['task-1', 'zombie_process_gone']
      );
      expect(results).toHaveLength(1);
      expect(results[0].taskId).toBe('task-1');
      expect(results[0].slot).toBe('slot-0');
      expect(results[0].cleaned).toBe(true);
      expect(results[0].dbUpdated).toBe(true);
      expect(results[0].errors).toEqual([]);
    });

    it('should emit zombie_cleaned event after cleanup', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'task-2' }] });

      await cleanZombieSlots([{ slot: 'slot-1', taskId: 'task-2' }]);

      expect(emit).toHaveBeenCalledWith('zombie_cleaned', 'zombie-cleaner', {
        task_id: 'task-2',
        slot: 'slot-1',
        cleaned: true,
        db_updated: true,
      });
    });

    it('should handle emergencyCleanup errors gracefully (continue to DB update)', async () => {
      emergencyCleanup.mockImplementationOnce(() => {
        throw new Error('cleanup failed');
      });
      pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'task-3' }] });

      const results = await cleanZombieSlots([{ slot: 'slot-2', taskId: 'task-3' }]);

      expect(results[0].errors).toEqual(expect.arrayContaining([expect.stringContaining('cleanup failed')]));
      expect(results[0].dbUpdated).toBe(true); // DB update still happens
    });

    it('should handle DB errors gracefully (continue to emit)', async () => {
      pool.query.mockRejectedValueOnce(new Error('db error'));

      const results = await cleanZombieSlots([{ slot: 'slot-3', taskId: 'task-4' }]);

      expect(results[0].dbUpdated).toBe(false);
      expect(results[0].errors).toEqual(expect.arrayContaining([expect.stringContaining('db error')]));
      // emit still called (even if db failed, cleaned=true from emergencyCleanup)
      expect(emit).toHaveBeenCalled();
    });

    it('should process multiple stale slots', async () => {
      pool.query
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 't1' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 't2' }] });

      const staleSlots = [
        { slot: 'slot-0', taskId: 't1' },
        { slot: 'slot-1', taskId: 't2' },
      ];
      const results = await cleanZombieSlots(staleSlots);

      expect(results).toHaveLength(2);
      expect(emergencyCleanup).toHaveBeenCalledTimes(2);
    });

    it('should record to _cleanHistory when cleanup successful', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'task-5' }] });

      await cleanZombieSlots([{ slot: 'slot-4', taskId: 'task-5' }]);

      expect(_cleanHistory.length).toBe(1);
      expect(_cleanHistory[0].type).toBe('zombie');
    });

    it('should NOT record to history when both cleanup and db update fail', async () => {
      emergencyCleanup.mockReturnValueOnce({ worktree: false, lock: false, devMode: false, errors: ['err'] });
      pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // no rows updated

      await cleanZombieSlots([{ slot: 'slot-5', taskId: 'task-6' }]);

      expect(_cleanHistory.length).toBe(0);
    });
  });

  describe('detectOrphanTasks', () => {
    it('should return zero stats when no old in_progress tasks', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const stats = await detectOrphanTasks(new Map());
      expect(stats.orphans_fixed).toBe(0);
      expect(stats.warnings).toBe(0);
      expect(stats.errors).toBe(0);
    });

    it('should mark task as failed when in_progress > 4h and no process', async () => {
      const startedAt = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(); // 5h ago
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 'orphan-1', title: 'Orphan task', started_at: startedAt }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'orphan-1' }] });

      const pidMap = new Map(); // empty — no active processes
      const stats = await detectOrphanTasks(pidMap);

      expect(pool.query).toHaveBeenNthCalledWith(2,
        expect.stringContaining('UPDATE tasks'),
        ['orphan-1', 'orphan_no_process']
      );
      expect(stats.orphans_fixed).toBe(1);
    });

    it('should emit orphan_detected event for each fixed orphan', async () => {
      const startedAt = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 'orphan-2', title: 'Test task', started_at: startedAt }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'orphan-2' }] });

      await detectOrphanTasks(new Map());

      expect(emit).toHaveBeenCalledWith('orphan_detected', 'zombie-cleaner', expect.objectContaining({
        task_id: 'orphan-2',
        reason: 'orphan_no_process',
      }));
    });

    it('should NOT mark task as failed when it has an active process', async () => {
      const startedAt = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'active-1', title: 'Active task', started_at: startedAt }]
      });

      // pidMap contains this task — it has a live process
      const pidMap = new Map([['active-1', { pid: 1234, slot: 'slot-0' }]]);
      const stats = await detectOrphanTasks(pidMap);

      // No DB update call for the task
      expect(pool.query).toHaveBeenCalledTimes(1); // only the SELECT
      expect(stats.orphans_fixed).toBe(0);
    });

    it('should warn for task > 8h with active process (no kill)', async () => {
      const startedAt = new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString(); // 9h ago
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'long-1', title: 'Long task', started_at: startedAt }]
      });

      const pidMap = new Map([['long-1', { pid: 5678, slot: 'slot-1' }]]);
      const stats = await detectOrphanTasks(pidMap);

      expect(stats.warnings).toBe(1);
      expect(stats.orphans_fixed).toBe(0);
    });

    it('should NOT process tasks < 4h (boundary condition)', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const stats = await detectOrphanTasks(new Map());
      expect(stats.orphans_fixed).toBe(0);
    });

    it('should handle DB errors gracefully', async () => {
      pool.query.mockRejectedValueOnce(new Error('connection lost'));

      const stats = await detectOrphanTasks(new Map());
      expect(stats.errors).toBe(1);
    });

    it('should record orphan events to _cleanHistory', async () => {
      const startedAt = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 'orphan-3', title: 'Task', started_at: startedAt }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'orphan-3' }] });

      await detectOrphanTasks(new Map());

      expect(_cleanHistory.filter(e => e.type === 'orphan').length).toBe(1);
    });
  });

  describe('getZombieStats', () => {
    it('should return zero stats when no history', () => {
      const stats = getZombieStats();
      expect(stats.zombies_cleaned_24h).toBe(0);
      expect(stats.orphans_fixed_24h).toBe(0);
      expect(stats.last_cleanup_at).toBeNull();
    });

    it('should count zombie and orphan events separately', async () => {
      // 2 zombies: each cleanZombieSlots call needs 1 DB query (UPDATE)
      pool.query
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 't1' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 't2' }] });
      await cleanZombieSlots([
        { slot: 'slot-0', taskId: 't1' },
        { slot: 'slot-1', taskId: 't2' },
      ]);

      // 1 orphan: detectOrphanTasks needs 2 DB queries (SELECT + UPDATE)
      const startedAt = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 't3', title: 'Task', started_at: startedAt }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 't3' }] });
      await detectOrphanTasks(new Map());

      const stats = getZombieStats();
      expect(stats.zombies_cleaned_24h).toBe(2);
      expect(stats.orphans_fixed_24h).toBe(1);
      expect(stats.last_cleanup_at).not.toBeNull();
    });

    it('should exclude events older than 24h', () => {
      // Manually inject an old event (> 24h ago)
      const oldTs = Date.now() - 25 * 60 * 60 * 1000;
      _cleanHistory.push({ type: 'zombie', ts: oldTs });
      _cleanHistory.push({ type: 'orphan', ts: oldTs });

      const stats = getZombieStats();
      expect(stats.zombies_cleaned_24h).toBe(0);
      expect(stats.orphans_fixed_24h).toBe(0);
      expect(stats.last_cleanup_at).toBeNull();
    });

    it('should return ISO string for last_cleanup_at when events exist', () => {
      _cleanHistory.push({ type: 'zombie', ts: Date.now() });

      const stats = getZombieStats();
      expect(stats.last_cleanup_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });
});

// ============================================================
// Section B: Nightly Cleanup Tests (R1/R2)
// ============================================================

describe('cleanupStaleSlots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('空 staleSlots → 不清理任何东西', () => {
    resolveTaskPids.mockReturnValue({ pidMap: new Map(), staleSlots: [] });

    const result = cleanupStaleSlots();

    expect(result.reclaimed).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(rmSync).not.toHaveBeenCalled();
  });

  it('slot 目录不存在 → 只调用 removeActiveProcess', () => {
    resolveTaskPids.mockReturnValue({
      pidMap: new Map(),
      staleSlots: [{ slot: 'slot-0', taskId: 'task-abc' }],
    });
    existsSync.mockReturnValue(false); // slot dir not found

    const result = cleanupStaleSlots();

    expect(rmSync).not.toHaveBeenCalled();
    expect(removeActiveProcess).toHaveBeenCalledWith('task-abc');
    expect(result.reclaimed).toBe(0); // not counted (dir already gone)
  });

  it('slot 存在但年龄 < 60s → 跳过清理', () => {
    resolveTaskPids.mockReturnValue({
      pidMap: new Map(),
      staleSlots: [{ slot: 'slot-0', taskId: 'task-abc' }],
    });
    existsSync.mockReturnValue(true);
    // mtime = 30 秒前（小于 STALE_SLOT_MIN_AGE_MS=60s）
    statSync.mockReturnValue({ mtimeMs: Date.now() - 30_000 });

    const result = cleanupStaleSlots();

    expect(rmSync).not.toHaveBeenCalled();
    expect(removeActiveProcess).not.toHaveBeenCalled();
    expect(result.reclaimed).toBe(0);
  });

  it('slot 存在且年龄 > 60s → 清理目录并移除 activeProcess', () => {
    resolveTaskPids.mockReturnValue({
      pidMap: new Map(),
      staleSlots: [{ slot: 'slot-0', taskId: 'task-abc' }],
    });
    existsSync.mockReturnValue(true);
    // mtime = 120 秒前（超过 STALE_SLOT_MIN_AGE_MS=60s）
    statSync.mockReturnValue({ mtimeMs: Date.now() - 120_000 });

    const result = cleanupStaleSlots();

    expect(rmSync).toHaveBeenCalledWith(expect.stringContaining('slot-0'), { recursive: true, force: true });
    expect(removeActiveProcess).toHaveBeenCalledWith('task-abc');
    expect(result.reclaimed).toBe(1);
  });

  it('多个 stale slots → 逐一清理', () => {
    resolveTaskPids.mockReturnValue({
      pidMap: new Map(),
      staleSlots: [
        { slot: 'slot-0', taskId: 'task-a' },
        { slot: 'slot-1', taskId: 'task-b' },
      ],
    });
    existsSync.mockReturnValue(true);
    statSync.mockReturnValue({ mtimeMs: Date.now() - 200_000 });

    const result = cleanupStaleSlots();

    expect(result.reclaimed).toBe(2);
    expect(removeActiveProcess).toHaveBeenCalledTimes(2);
  });

  it('resolveTaskPids 抛出异常 → 返回 errors，不崩溃', () => {
    resolveTaskPids.mockImplementation(() => { throw new Error('pid scan failed'); });

    const result = cleanupStaleSlots();

    expect(result.reclaimed).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('resolveTaskPids');
  });

  it('stat 抛出异常 → 跳过该 slot，继续下一个', () => {
    resolveTaskPids.mockReturnValue({
      pidMap: new Map(),
      staleSlots: [
        { slot: 'slot-0', taskId: 'task-a' },
        { slot: 'slot-1', taskId: 'task-b' },
      ],
    });
    existsSync.mockReturnValue(true);
    statSync
      .mockImplementationOnce(() => { throw new Error('ENOENT'); })
      .mockReturnValueOnce({ mtimeMs: Date.now() - 120_000 });

    const result = cleanupStaleSlots();

    expect(result.reclaimed).toBe(1); // slot-1 被清理
    expect(result.errors).toHaveLength(1); // slot-0 stat 失败
  });

  it('threshold: ageMs 刚好 59s → 跳过清理', () => {
    resolveTaskPids.mockReturnValue({
      pidMap: new Map(),
      staleSlots: [{ slot: 'slot-0', taskId: 'task-abc' }],
    });
    existsSync.mockReturnValue(true);
    // mtime = 59 秒前 → ageMs < STALE_SLOT_MIN_AGE_MS → 跳过
    statSync.mockReturnValue({ mtimeMs: Date.now() - STALE_SLOT_MIN_AGE_MS + 1000 });

    const result = cleanupStaleSlots();

    expect(result.reclaimed).toBe(0);
  });
});

describe('findTaskIdForWorktree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('.dev-mode 包含 UUID → 返回 UUID', () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue('branch: cp-xxx\ntask_id: abc12345-1234-1234-1234-abcdef123456\n');

    const result = findTaskIdForWorktree('/some/worktree');
    expect(result).toBe('abc12345-1234-1234-1234-abcdef123456');
  });

  it('.dev-mode 不存在 → 返回 null', () => {
    existsSync.mockReturnValue(false);

    const result = findTaskIdForWorktree('/some/worktree');
    expect(result).toBeNull();
  });

  it('.dev-mode 没有 UUID → 返回 null', () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue('branch: cp-03071033\nstarted: 2026-03-07\n');

    const result = findTaskIdForWorktree('/some/worktree');
    expect(result).toBeNull();
  });

  it('readFileSync 抛异常 → 返回 null 不崩溃', () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockImplementation(() => { throw new Error('read error'); });

    const result = findTaskIdForWorktree('/some/worktree');
    expect(result).toBeNull();
  });
});

describe('cleanupOrphanWorktrees', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('git worktree list 失败 → 返回 errors，不崩溃', async () => {
    execSync.mockImplementation(() => { throw new Error('git not found'); });

    const dbPool = makePool([]);
    const result = await cleanupOrphanWorktrees(dbPool);

    expect(result.removed).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('git worktree list');
  });

  it('无 managed worktrees → 不查 DB，直接返回', async () => {
    // worktree list 只返回主仓库（不在 WORKTREE_BASE 下）
    execSync.mockReturnValue('worktree /some/other/path\nHEAD abc123\nbranch main\n\n');

    const dbPool = makePool([]);
    const result = await cleanupOrphanWorktrees(dbPool);

    expect(dbPool.query).not.toHaveBeenCalled();
    expect(result.removed).toBe(0);
  });

  it('DB 查询失败 → 返回 errors，不清理', async () => {
    const WORKTREE_BASE = process.env.WORKTREE_BASE || '/Users/administrator/perfect21/cecelia/.claude/worktrees';
    execSync.mockReturnValue(`worktree ${WORKTREE_BASE}/some-wt\nHEAD abc123\nbranch cp-xxx\n\n`);

    const dbPool = { query: vi.fn().mockRejectedValue(new Error('db error')) };
    const result = await cleanupOrphanWorktrees(dbPool);

    expect(result.removed).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('db query');
  });

  it('worktree 有对应活跃任务 → 不清理', async () => {
    const WORKTREE_BASE = process.env.WORKTREE_BASE || '/Users/administrator/perfect21/cecelia/.claude/worktrees';
    const wtPath = `${WORKTREE_BASE}/task-uuid-wt`;
    const taskId = 'aabbccdd-1234-1234-1234-aabbccddeeff';

    execSync.mockReturnValueOnce(`worktree ${wtPath}\nHEAD abc123\nbranch cp-xxx\n\n`);
    existsSync.mockReturnValue(true);
    // 年龄 > 30min
    statSync.mockReturnValue({ mtimeMs: Date.now() - 40 * 60 * 1000 });
    // .dev-mode 包含 taskId
    readFileSync.mockReturnValue(`branch: cp-xxx\ntask_id: ${taskId}\n`);

    const dbPool = makePool([{ id: taskId }]); // task is active

    const result = await cleanupOrphanWorktrees(dbPool);

    expect(result.removed).toBe(0);
    // execSync 只调用了 git worktree list，没有 remove
    expect(execSync).toHaveBeenCalledTimes(1);
  });

  it('worktree 年龄 < 30min → 不清理', async () => {
    const WORKTREE_BASE = process.env.WORKTREE_BASE || '/Users/administrator/perfect21/cecelia/.claude/worktrees';
    const wtPath = `${WORKTREE_BASE}/some-wt`;

    execSync.mockReturnValueOnce(`worktree ${wtPath}\nHEAD abc123\nbranch cp-xxx\n\n`);
    existsSync.mockReturnValue(true);
    // 年龄 < 30min
    statSync.mockReturnValue({ mtimeMs: Date.now() - 10 * 60 * 1000 });

    const dbPool = makePool([]); // no active tasks

    const result = await cleanupOrphanWorktrees(dbPool);

    expect(result.removed).toBe(0);
    // execSync 只调用了 git worktree list
    expect(execSync).toHaveBeenCalledTimes(1);
  });

  it('孤儿 worktree 年龄 > 30min → 执行 git worktree remove', async () => {
    const WORKTREE_BASE = process.env.WORKTREE_BASE || '/Users/administrator/perfect21/cecelia/.claude/worktrees';
    const wtPath = `${WORKTREE_BASE}/orphan-wt`;

    execSync
      .mockReturnValueOnce(`worktree ${wtPath}\nHEAD abc123\nbranch cp-xxx\n\n`)
      .mockReturnValueOnce(''); // git worktree remove --force

    existsSync.mockReturnValue(true);
    // 年龄 > 30min
    statSync.mockReturnValue({ mtimeMs: Date.now() - 45 * 60 * 1000 });
    // .dev-mode 不存在（或无 UUID）
    readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const dbPool = makePool([]); // no active tasks

    const result = await cleanupOrphanWorktrees(dbPool);

    expect(result.removed).toBe(1);
    const removeCalls = execSync.mock.calls.filter(c => c[0].includes('worktree remove'));
    expect(removeCalls).toHaveLength(1);
    expect(removeCalls[0][0]).toContain('--force');
    expect(removeCalls[0][0]).toContain(wtPath);
  });

  it('git worktree remove 失败 → 降级到 rmSync', async () => {
    const WORKTREE_BASE = process.env.WORKTREE_BASE || '/Users/administrator/perfect21/cecelia/.claude/worktrees';
    const wtPath = `${WORKTREE_BASE}/orphan-wt`;

    execSync
      .mockReturnValueOnce(`worktree ${wtPath}\nHEAD abc123\nbranch cp-xxx\n\n`) // list
      .mockImplementationOnce(() => { throw new Error('remove failed'); })         // remove --force
      .mockReturnValueOnce(''); // git worktree prune

    existsSync.mockReturnValue(true);
    statSync.mockReturnValue({ mtimeMs: Date.now() - 45 * 60 * 1000 });
    readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const dbPool = makePool([]);

    const result = await cleanupOrphanWorktrees(dbPool);

    expect(result.removed).toBe(1);
    expect(rmSync).toHaveBeenCalledWith(wtPath, { recursive: true, force: true });
  });
});

describe('runZombieCleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('返回结构化报告', async () => {
    // cleanupStaleSlots: 无 stale slots
    resolveTaskPids.mockReturnValue({ pidMap: new Map(), staleSlots: [] });
    // cleanupOrphanWorktrees: git worktree list 返回空
    execSync.mockReturnValue('worktree /main/repo\nHEAD abc\nbranch main\n\n');

    const dbPool = makePool([]);
    const report = await runZombieCleanup(dbPool);

    expect(report).toMatchObject({
      slotsReclaimed: 0,
      worktreesRemoved: 0,
      timestamp: expect.any(String),
      errors: expect.any(Array),
    });
  });

  it('cleanupStaleSlots 内部错误 → 报告 errors，仍然执行 worktree 清理', async () => {
    // resolveTaskPids 抛异常，被 cleanupStaleSlots 内部捕获，返回 errors: ['resolveTaskPids: ...']
    resolveTaskPids.mockImplementation(() => { throw new Error('fatal pid error'); });
    execSync.mockReturnValue('worktree /main/repo\nHEAD abc\nbranch main\n\n');

    const dbPool = makePool([]);
    const report = await runZombieCleanup(dbPool);

    // 内部捕获的错误包含 'resolveTaskPids'
    expect(report.errors.some(e => e.includes('resolveTaskPids'))).toBe(true);
    // worktrees 部分仍然执行（无孤儿）
    expect(report.worktreesRemoved).toBe(0);
  });
});

describe('constants (Section B)', () => {
  it('STALE_SLOT_MIN_AGE_MS = 60 seconds', () => {
    expect(STALE_SLOT_MIN_AGE_MS).toBe(60 * 1000);
  });

  it('ORPHAN_WORKTREE_MIN_AGE_MS = 30 minutes', () => {
    expect(ORPHAN_WORKTREE_MIN_AGE_MS).toBe(30 * 60 * 1000);
  });
});
