/**
 * Tests for zombie-cleaner.js
 * 覆盖：R1 stale slot 清理、R2 孤儿 worktree 识别、runZombieCleanup 统一入口
 */

// 固定测试用 WORKTREE_BASE（跟本文件里各测试硬编码的 worktree 路径前缀保持一致：
// /Users/administrator/worktrees/cecelia，也是 zombie-cleaner.js 顶层常量
// process.env.WORKTREE_BASE || `${HOME}/worktrees/cecelia` 在本机的实际求值结果）。
// 必须在 import 模块之前设置好（顶层常量只在 import 时求值一次），且不能依赖 CI 跑
// 这份测试时的 $HOME 是什么值——显式钉死，否则测试自己造的路径可能不在生产代码的
// 管理范围过滤器内，"是否 managed worktree" 的判断会永远短路成 false。
process.env.WORKTREE_BASE = '/Users/administrator/worktrees/cecelia';

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
    readdirSync: vi.fn(),
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

// Mock cleanup-lock — fs mock 让真锁失败，pass-through 让单测走原路径
vi.mock('../utils/cleanup-lock.js', () => ({
  withLock: vi.fn(async (_opts, fn) => fn()),
  acquireLock: vi.fn().mockResolvedValue(true),
  releaseLock: vi.fn(),
  LOCK_DIR_DEFAULT: '/tmp/cecelia-cleanup.lock',
}));

// Mock platform-utils — anyProcessHasCwdUnder 默认返回 false（无存活进程持有 cwd）
vi.mock('../platform-utils.js', () => ({
  anyProcessHasCwdUnder: vi.fn().mockReturnValue(false),
  IS_DARWIN: false,
  IS_LINUX: true,
}));

import { existsSync, readFileSync, rmSync, statSync, readdirSync } from 'fs';
import { execSync } from 'child_process';
import { resolveTaskPids } from '../watchdog.js';
import { removeActiveProcess } from '../executor.js';
import { anyProcessHasCwdUnder } from '../platform-utils.js';

import {
  cleanupStaleSlots,
  cleanupOrphanWorktrees,
  runZombieCleanup,
  findTaskIdForWorktree,
  isWorktreeActive,
  STALE_SLOT_MIN_AGE_MS,
  ORPHAN_WORKTREE_MIN_AGE_MS,
  ACTIVE_WORKTREE_SIGNAL_THRESHOLD_MS,
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
    // 实现用 readdirSync 扫描 .dev-mode* 文件名，不是 existsSync 判断单一路径
    readdirSync.mockReturnValue(['.dev-mode']);
    readFileSync.mockReturnValue('branch: cp-xxx\ntask_id: abc12345-1234-1234-1234-abcdef123456\n');

    const result = findTaskIdForWorktree('/some/worktree');
    expect(result).toBe('abc12345-1234-1234-1234-abcdef123456');
  });

  it('.dev-mode 不存在 → 返回 null', () => {
    readdirSync.mockReturnValue([]); // 无 .dev-mode* 文件

    const result = findTaskIdForWorktree('/some/worktree');
    expect(result).toBeNull();
  });

  it('.dev-mode 没有 UUID → 返回 null', () => {
    readdirSync.mockReturnValue(['.dev-mode']);
    readFileSync.mockReturnValue('branch: cp-03071033\nstarted: 2026-03-07\n');

    const result = findTaskIdForWorktree('/some/worktree');
    expect(result).toBeNull();
  });

  it('readFileSync 抛异常 → 返回 null 不崩溃', () => {
    readdirSync.mockReturnValue(['.dev-mode']);
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
    vi.clearAllMocks(); // 只清 calls/results，不清 vi.mock() 工厂设的实现（如 withLock pass-through）——resetAllMocks 会连 withLock 一起清掉，导致 remove 从未真正被调用
    // 默认无 .dev-mode* 文件（isWorktreeActive 返回 false），不影响原有 case 行为
    readdirSync.mockReturnValue([]);
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
    // .dev-mode 包含 taskId（findTaskIdForWorktree 用 readdirSync 扫描文件名，不是 existsSync）
    readdirSync.mockReturnValue(['.dev-mode']);
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
    // Second call: git status --porcelain（无未提交改动）
    // Third call: git worktree remove
    execSync
      .mockReturnValueOnce(`worktree ${wtPath}\nHEAD abc123\nbranch cp-xxx\n\n`)
      .mockReturnValueOnce('') // git status --porcelain
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
      .mockReturnValueOnce('') // git status --porcelain（无未提交改动）
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

  it('worktree 有 fresh .dev-mode.branch → 跳过清理（活跃信号预检）', async () => {
    const now = Date.now();
    execSync.mockReturnValue('worktree /Users/administrator/worktrees/cecelia/active-wt\n\n');
    existsSync.mockReturnValue(true);
    statSync.mockImplementation((p) => {
      if (p.endsWith('.dev-mode.cp-yyy')) return { mtimeMs: now - 10_000 };
      // worktree 目录本身的 mtime 用于 age 判定
      return { mtimeMs: now - 40 * 60 * 1000 }; // 40 min, 超 30 min grace
    });
    readdirSync.mockReturnValue(['.dev-mode.cp-yyy', 'packages']);
    readFileSync.mockReturnValue('');
    const pool = makePool([]);

    const result = await cleanupOrphanWorktrees(pool);

    expect(result.removed).toBe(0);
    // 未调 git worktree remove
    const removeCalls = execSync.mock.calls.filter(c => String(c[0]).includes('worktree remove'));
    expect(removeCalls).toHaveLength(0);
  });

  it('worktree 无 .dev-mode* 文件 → 正常清理（不受新信号影响）', async () => {
    const now = Date.now();
    execSync
      .mockReturnValueOnce('worktree /Users/administrator/worktrees/cecelia/dead-wt\n\n')
      .mockReturnValueOnce('') // git status --porcelain（无未提交改动）
      .mockReturnValueOnce(''); // git worktree remove 成功
    existsSync.mockReturnValue(true);
    statSync.mockReturnValue({ mtimeMs: now - 60 * 60 * 1000 }); // 1h age 超 grace
    readdirSync.mockReturnValue(['packages', 'docs']); // 无 .dev-mode*
    const pool = makePool([]);

    const result = await cleanupOrphanWorktrees(pool);

    expect(result.removed).toBe(1);
  });

  it('有未提交改动的孤儿 worktree 不删除（数据丢失防护）', async () => {
    const WORKTREE_BASE = process.env.WORKTREE_BASE || '/Users/administrator/perfect21/cecelia/.claude/worktrees';
    const wtPath = `${WORKTREE_BASE}/dirty-orphan-wt`;

    execSync.mockImplementation((cmd) => {
      const c = String(cmd);
      if (c.includes('worktree list')) return `worktree ${wtPath}\nHEAD abc123\nbranch cp-xxx\n\n`;
      if (c.includes('status --porcelain')) return ' M uncommitted-fix.js\n';
      return '';
    });
    existsSync.mockReturnValue(true);
    statSync.mockReturnValue({ mtimeMs: Date.now() - 45 * 60 * 1000 }); // 年龄 > 30min
    readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const pool = makePool([]); // no active tasks

    const result = await cleanupOrphanWorktrees(pool);

    expect(result.removed).toBe(0);
    const removeCalls = execSync.mock.calls.filter(c => String(c[0]).includes('worktree remove'));
    expect(removeCalls).toHaveLength(0);
    expect(rmSync).not.toHaveBeenCalled();
  });

  it('git status 检查本身失败时保守跳过不删除', async () => {
    const WORKTREE_BASE = process.env.WORKTREE_BASE || '/Users/administrator/perfect21/cecelia/.claude/worktrees';
    const wtPath = `${WORKTREE_BASE}/status-check-fail-wt`;

    execSync.mockImplementation((cmd) => {
      const c = String(cmd);
      if (c.includes('worktree list')) return `worktree ${wtPath}\nHEAD abc123\nbranch cp-xxx\n\n`;
      if (c.includes('status --porcelain')) throw new Error('not a git repo');
      return '';
    });
    existsSync.mockReturnValue(true);
    statSync.mockReturnValue({ mtimeMs: Date.now() - 45 * 60 * 1000 });
    readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const pool = makePool([]);

    const result = await cleanupOrphanWorktrees(pool);

    const removeCalls = execSync.mock.calls.filter(c => String(c[0]).includes('worktree remove'));
    expect(removeCalls).toHaveLength(0);
    expect(rmSync).not.toHaveBeenCalled();
  });

  // ─── Guard C ──────────────────────────────────────────────────────────────
  describe('Guard C', () => {
    // zombie-cleaner.js 的 WORKTREE_BASE 常量在 ESM 模块加载时求值，此时 process.env.WORKTREE_BASE
    // 尚未被第 12 行赋值，因此使用 HOME fallback。测试 wtPath 必须与模块实际值对齐。
    const ZOMBIE_CLEANER_WORKTREE_BASE = `${process.env.HOME}/worktrees/cecelia`;
    const wtPath = `${ZOMBIE_CLEANER_WORKTREE_BASE}/guard-c-wt`;
    const taskId = 'aabb1122-0000-0000-0000-aabbccddeeff';

    beforeEach(() => {
      // 孤儿 worktree 基础 setup：存在 >30min，git status 干净，找到 taskId
      // statSync.mockImplementation 区分 .dev-mode 文件（25h → isWorktreeActive=false）
      // 与 worktree 目录本身（45min → age check 通过 >30min）
      //
      // execSync.mockReset()：pre-existing failing tests（WORKTREE_BASE 路径不匹配导致 managedWorktrees=[]
      // 提前返回）会在 execSync 队列里留下未消耗的 mockReturnValueOnce 值，污染后续测试。
      // vi.clearAllMocks() 只清 calls，不清 once 队列；必须在 inner beforeEach 显式 reset。
      execSync.mockReset();
      execSync
        .mockReturnValueOnce(`worktree ${wtPath}\nHEAD abc123\nbranch cp-gc-test\n\n`)
        .mockReturnValueOnce(''); // git status --porcelain clean
      existsSync.mockReturnValue(true);
      statSync.mockImplementation((p) => {
        if (String(p).includes('.dev-mode')) {
          // 25h > ACTIVE_WORKTREE_SIGNAL_THRESHOLD_MS(24h) → isWorktreeActive=false，不提前 skip
          return { mtimeMs: Date.now() - 25 * 60 * 60 * 1000 };
        }
        return { mtimeMs: Date.now() - 45 * 60 * 1000 }; // 45min > 30min grace
      });
      readdirSync.mockReturnValue(['.dev-mode']); // findTaskIdForWorktree 能找到 taskId
      readFileSync.mockReturnValue(`branch: cp-gc-test\ntask_id: ${taskId}\n`);
      anyProcessHasCwdUnder.mockReturnValue(false);
    });

    it('C-1: task claimed_by 非空 → skip', async () => {
      // 模拟 .dev-mode mtime 过期（isWorktreeActive=false）→ 跳过 B2 活跃预检
      // activeTasks query: task NOT in_progress（已完成 or 其他状态）
      // Guard C-1 claimed_by query: IS NOT NULL → skip
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [] })               // activeTasks: task not in_progress
          .mockResolvedValueOnce({ rows: [{ id: taskId }] }), // Guard C-1 claimed_by: claimed!
      };

      const result = await cleanupOrphanWorktrees(pool);

      expect(result.removed).toBe(0);
      const removeCalls = execSync.mock.calls.filter(c => String(c[0]).includes('worktree remove'));
      expect(removeCalls).toHaveLength(0);
    });

    it('C-2: 存活进程持有 cwd → skip', async () => {
      anyProcessHasCwdUnder.mockReturnValue(true);
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [] })  // activeTasks
          .mockResolvedValueOnce({ rows: [] }), // Guard C-1 claimed_by: not claimed
      };

      const result = await cleanupOrphanWorktrees(pool);

      expect(result.removed).toBe(0);
      expect(anyProcessHasCwdUnder).toHaveBeenCalledWith(wtPath);
    });

    it('C-2: 进程已死 → 正常删除', async () => {
      anyProcessHasCwdUnder.mockReturnValue(false);
      // beforeEach 已注入: [worktree-list, git-status]，追加第 3 个调用 worktree remove
      execSync.mockReturnValueOnce(''); // git worktree remove --force
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [] })  // activeTasks
          .mockResolvedValueOnce({ rows: [] }), // Guard C-1 claimed_by: not claimed
      };

      const result = await cleanupOrphanWorktrees(pool);

      expect(result.removed).toBe(1);
    });

    it('C-2: cwd 检查抛出异常 → 保守 skip', async () => {
      anyProcessHasCwdUnder.mockImplementation(() => { throw new Error('lsof failed'); });
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [] })  // activeTasks
          .mockResolvedValueOnce({ rows: [] }), // Guard C-1 claimed_by
      };

      const result = await cleanupOrphanWorktrees(pool);

      expect(result.removed).toBe(0);
      const removeCalls = execSync.mock.calls.filter(c => String(c[0]).includes('worktree remove'));
      expect(removeCalls).toHaveLength(0);
    });

    it('C-1 claimed_by 查询抛出异常 → 保守 skip', async () => {
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [] })         // activeTasks
          .mockRejectedValueOnce(new Error('DB down')), // Guard C-1 claimed_by throws
      };

      const result = await cleanupOrphanWorktrees(pool);

      expect(result.removed).toBe(0);
    });
  });
});

// ============================================================
// runZombieCleanup (统一入口)
// ============================================================

describe('runZombieCleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks(); // 只清 calls/results，不清 vi.mock() 工厂设的实现（如 withLock pass-through）——resetAllMocks 会连 withLock 一起清掉，导致 remove 从未真正被调用
    readdirSync.mockReturnValue([]); // 默认无 .dev-mode* 文件
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

  it('ACTIVE_WORKTREE_SIGNAL_THRESHOLD_MS = 24 hours', () => {
    expect(ACTIVE_WORKTREE_SIGNAL_THRESHOLD_MS).toBe(24 * 60 * 60 * 1000);
  });
});

// ============================================================
// isWorktreeActive (Phase B2-bis active signal)
// ============================================================

describe('isWorktreeActive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fresh .dev-mode.${branch} → true', () => {
    const now = Date.now();
    readdirSync.mockReturnValue(['.dev-mode.cp-xxx-branch', 'packages', 'docs']);
    statSync.mockImplementation((p) => {
      if (p.endsWith('.dev-mode.cp-xxx-branch')) return { mtimeMs: now - 60_000 };
      throw new Error('unexpected stat');
    });
    expect(isWorktreeActive('/fake/wt')).toBe(true);
  });

  it('老 .dev-mode 无后缀 fresh → true', () => {
    const now = Date.now();
    readdirSync.mockReturnValue(['.dev-mode']);
    statSync.mockReturnValue({ mtimeMs: now - 60_000 });
    expect(isWorktreeActive('/fake/wt')).toBe(true);
  });

  it('所有 .dev-mode* stale (>24h) → false', () => {
    const now = Date.now();
    readdirSync.mockReturnValue(['.dev-mode.cp-xxx', '.dev-mode.cp-yyy']);
    statSync.mockReturnValue({ mtimeMs: now - 25 * 60 * 60 * 1000 });
    expect(isWorktreeActive('/fake/wt')).toBe(false);
  });

  it('无 .dev-mode* 文件 → false', () => {
    readdirSync.mockReturnValue(['packages', 'docs', 'README.md']);
    expect(isWorktreeActive('/fake/wt')).toBe(false);
  });

  it('readdirSync throws → false', () => {
    readdirSync.mockImplementation(() => { throw new Error('ENOENT'); });
    expect(isWorktreeActive('/fake/wt')).toBe(false);
  });
});
