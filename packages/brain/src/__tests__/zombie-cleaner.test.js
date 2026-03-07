/**
 * Tests for zombie-cleaner.js
 * 覆盖：R1 stale slot 清理、R2 孤儿 worktree 识别、runZombieCleanup 统一入口
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs
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

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

// Mock watchdog
vi.mock('../watchdog.js', () => ({
  resolveTaskPids: vi.fn(),
}));

// Mock executor
vi.mock('../executor.js', () => ({
  removeActiveProcess: vi.fn(),
}));

import { existsSync, readFileSync, rmSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { resolveTaskPids } from '../watchdog.js';
import { removeActiveProcess } from '../executor.js';

import {
  cleanupStaleSlots,
  cleanupOrphanWorktrees,
  runZombieCleanup,
  findTaskIdForWorktree,
  STALE_SLOT_MIN_AGE_MS,
  ORPHAN_WORKTREE_MIN_AGE_MS,
} from '../zombie-cleaner.js';

// ============================================================
// Test helpers
// ============================================================

function makePool(rows = []) {
  return {
    query: vi.fn().mockResolvedValue({ rows }),
  };
}

// ============================================================
// cleanupStaleSlots (R1)
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

// ============================================================
// findTaskIdForWorktree
// ============================================================

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

// ============================================================
// cleanupOrphanWorktrees (R2)
// ============================================================

describe('cleanupOrphanWorktrees', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('git worktree list 失败 → 返回 errors，不崩溃', async () => {
    execSync.mockImplementation(() => { throw new Error('git not found'); });

    const pool = makePool([]);
    const result = await cleanupOrphanWorktrees(pool);

    expect(result.removed).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('git worktree list');
  });

  it('无 managed worktrees → 不查 DB，直接返回', async () => {
    // worktree list 只返回主仓库（不在 WORKTREE_BASE 下）
    execSync.mockReturnValue('worktree /some/other/path\nHEAD abc123\nbranch main\n\n');

    const pool = makePool([]);
    const result = await cleanupOrphanWorktrees(pool);

    expect(pool.query).not.toHaveBeenCalled();
    expect(result.removed).toBe(0);
  });

  it('DB 查询失败 → 返回 errors，不清理', async () => {
    const WORKTREE_BASE = process.env.WORKTREE_BASE || '/Users/administrator/perfect21/cecelia/.claude/worktrees';
    execSync.mockReturnValue(`worktree ${WORKTREE_BASE}/some-wt\nHEAD abc123\nbranch cp-xxx\n\n`);

    const pool = { query: vi.fn().mockRejectedValue(new Error('db error')) };
    const result = await cleanupOrphanWorktrees(pool);

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

    const pool = makePool([{ id: taskId }]); // task is active

    const result = await cleanupOrphanWorktrees(pool);

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

    const pool = makePool([]); // no active tasks

    const result = await cleanupOrphanWorktrees(pool);

    expect(result.removed).toBe(0);
    // execSync 只调用了 git worktree list
    expect(execSync).toHaveBeenCalledTimes(1);
  });

  it('孤儿 worktree 年龄 > 30min → 执行 git worktree remove', async () => {
    const WORKTREE_BASE = process.env.WORKTREE_BASE || '/Users/administrator/perfect21/cecelia/.claude/worktrees';
    const wtPath = `${WORKTREE_BASE}/orphan-wt`;

    // First call: git worktree list
    // Second call: git worktree remove
    execSync
      .mockReturnValueOnce(`worktree ${wtPath}\nHEAD abc123\nbranch cp-xxx\n\n`)
      .mockReturnValueOnce(''); // git worktree remove --force

    existsSync.mockReturnValue(true);
    // 年龄 > 30min
    statSync.mockReturnValue({ mtimeMs: Date.now() - 45 * 60 * 1000 });
    // .dev-mode 不存在（或无 UUID）
    readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const pool = makePool([]); // no active tasks

    const result = await cleanupOrphanWorktrees(pool);

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

    const pool = makePool([]);

    const result = await cleanupOrphanWorktrees(pool);

    expect(result.removed).toBe(1);
    expect(rmSync).toHaveBeenCalledWith(wtPath, { recursive: true, force: true });
  });
});

// ============================================================
// runZombieCleanup (统一入口)
// ============================================================

describe('runZombieCleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('返回结构化报告', async () => {
    // cleanupStaleSlots: 无 stale slots
    resolveTaskPids.mockReturnValue({ pidMap: new Map(), staleSlots: [] });
    // cleanupOrphanWorktrees: git worktree list 返回空
    execSync.mockReturnValue('worktree /main/repo\nHEAD abc\nbranch main\n\n');

    const pool = makePool([]);
    const report = await runZombieCleanup(pool);

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

    const pool = makePool([]);
    const report = await runZombieCleanup(pool);

    // 内部捕获的错误包含 'resolveTaskPids'
    expect(report.errors.some(e => e.includes('resolveTaskPids'))).toBe(true);
    // worktrees 部分仍然执行（无孤儿）
    expect(report.worktreesRemoved).toBe(0);
  });
});

// ============================================================
// 常量验证
// ============================================================

describe('constants', () => {
  it('STALE_SLOT_MIN_AGE_MS = 60 seconds', () => {
    expect(STALE_SLOT_MIN_AGE_MS).toBe(60 * 1000);
  });

  it('ORPHAN_WORKTREE_MIN_AGE_MS = 30 minutes', () => {
    expect(ORPHAN_WORKTREE_MIN_AGE_MS).toBe(30 * 60 * 1000);
  });
});
