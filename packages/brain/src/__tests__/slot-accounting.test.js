/**
 * Slot Accounting — DB-authoritative in_progress 对齐测试
 *
 * 诊断：calculateSlotBudget() 中 totalRunning = Math.max(sessions.total, ceceliaUsed + autoDispatchUsed)
 * 当 DB in_progress=0 但有 8 个孤儿进程仍在 ps 时，sessions.total=8 导致 available=0，
 * dispatcher 死锁（task_pool.used=0 但 available=0 + dispatch_allowed=false）。
 *
 * Fix：让 totalRunning 纯用 DB 值（ceceliaUsed + autoDispatchUsed），不再取 max(ps, db)。
 * ps 检测只用于 headless_count 展示，不影响 Pool C 计算。
 *
 * C1 (red → green) 场景：
 *   (a) DB in_progress=N → task_pool.used=N + task_pool.available 正确
 *   (b) DB in_progress=0 → task_pool.used=0 + available=effectiveSlots + dispatch_allowed=true
 *   (c) DB in_progress=0 + 8 zombie ps 进程 → 不再被 ps 影响，available 仍为正值
 *   (d) DB query 失败 → fallback 安全（used=0，available 仍可为正值）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  execSync: vi.fn(() => ''),
}));

vi.mock('../executor.js', () => ({
  MAX_SEATS: 12,
  PHYSICAL_CAPACITY: 12,
  getEffectiveMaxSeats: vi.fn(() => 12),
  getBudgetCap: vi.fn(() => ({ budget: null, physical: 12, effective: 12 })),
  checkServerResources: vi.fn(() => ({
    effectiveSlots: 8,
    metrics: { max_pressure: 0.1 },
  })),
  getActiveProcessCount: vi.fn(() => 0),
  getTokenPressure: vi.fn(() => Promise.resolve({
    token_pressure: 0,
    available_accounts: 3,
    details: 'mock',
  })),
}));

vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(() => Promise.resolve({ rows: [{ count: '0' }] })),
  },
}));

vi.mock('../token-budget-planner.js', () => ({
  calculateBudgetState: vi.fn(() => Promise.resolve({
    state: 'abundant',
    avg_remaining_pct: 100,
    pool_c_scale: 1.0,
    autonomous_reserve_pct: 0.70,
    user_reserve_pct: 0.30,
    accounts: [],
    budget_breakdown: {},
  })),
  shouldDowngrade: vi.fn(() => false),
  getExecutorAffinity: vi.fn(() => ({ primary: 'claude', fallback: 'codex', no_downgrade: false })),
}));

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal();
  return { default: { ...actual, freemem: vi.fn(() => 8 * 1024 * 1024 * 1024) } };
});

vi.mock('../fleet-resource-cache.js', () => ({
  getFleetStatus: vi.fn(() => []),
  getRemoteCapacity: vi.fn(() => null),
  isServerOnline: vi.fn(() => false),
}));

import { execSync } from 'child_process';
import { checkServerResources } from '../executor.js';
import pool from '../db.js';
import {
  _resetSlotBuffer,
  calculateSlotBudget,
} from '../slot-allocator.js';

describe('Slot Accounting — DB-authoritative in_progress 对齐', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetSlotBuffer();
    execSync.mockReturnValue(''); // 默认：无 ps 进程
    checkServerResources.mockReturnValue({
      effectiveSlots: 8,
      metrics: { max_pressure: 0.1 },
    });
    pool.query.mockResolvedValue({ rows: [{ count: '0' }] });
  });

  // (a) DB in_progress=N → task_pool.used 准确反映 DB 值
  it('(a) DB in_progress=3 → task_pool.used=3, available=effectiveSlots-3', async () => {
    // 无用户进程（absent mode，userReserve=0）
    pool.query
      .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // countCeceliaInProgress
      .mockResolvedValueOnce({ rows: [{ count: '3' }] }) // countAutoDispatchInProgress
      .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // getQueueDepth
      .mockResolvedValueOnce({ rows: [{ count: '0' }] }); // countCodexInProgress

    const budget = await calculateSlotBudget();
    expect(budget.taskPool.used).toBe(3);
    // available = effectiveSlots(8) - totalRunning(3) - userReserve(0) = 5
    expect(budget.taskPool.available).toBe(5);
    expect(budget.dispatchAllowed).toBe(true);
  });

  // (b) DB in_progress=0 → used=0, available=effectiveSlots, dispatch_allowed=true
  it('(b) DB in_progress=0 → task_pool.used=0, available=effectiveSlots, dispatch_allowed=true', async () => {
    const budget = await calculateSlotBudget();
    expect(budget.taskPool.used).toBe(0);
    expect(budget.taskPool.available).toBe(8); // effectiveSlots - 0 - 0
    expect(budget.dispatchAllowed).toBe(true);
  });

  // (c) DB in_progress=0 但有 8 个孤儿 ps 进程 → ps 不再干扰 Pool C 计算
  it('(c) DB in_progress=0 + 8 zombie headless procs → available 仍为正值, dispatch_allowed=true', async () => {
    // 模拟 8 个无头孤儿进程（任务已完成但进程还在 ps 里）
    const zombieLine = Array.from({ length: 8 }, (_, i) =>
      `${10000 + i} 3600 claude claude -p "zombie task ${i}"`
    ).join('\n') + '\n';
    execSync.mockReturnValue(zombieLine);

    // DB 是真值：in_progress=0
    pool.query.mockResolvedValue({ rows: [{ count: '0' }] });

    const budget = await calculateSlotBudget();
    // task_pool.used 必须等于 DB 值，不受 ps 污染
    expect(budget.taskPool.used).toBe(0);
    // available 应为正值（不被 8 个僵尸进程清零）
    expect(budget.taskPool.available).toBeGreaterThan(0);
    expect(budget.dispatchAllowed).toBe(true);
  });

  // (d) DB query 失败 → fallback 安全：used=0, available 仍可为正值
  it('(d) DB query 失败 → fallback 安全: used=0, available≥0, 不崩溃', async () => {
    pool.query.mockRejectedValue(new Error('DB connection failed'));

    const budget = await calculateSlotBudget();
    expect(budget.taskPool.used).toBe(0); // fallback: countAutoDispatchInProgress returns 0
    expect(budget.taskPool.available).toBeGreaterThanOrEqual(0); // 不为负数
    // 不抛出异常
  });

  // (e) orphan headless 孤儿进程不污染 Pool C 计算
  it('(e) orphan headless 孤儿进程不再膨胀 totalRunning', async () => {
    // ps 检测到 6 个进程（3 headed + 3 orphan headless，任务已完成但进程未退出）
    execSync.mockReturnValue(
      '100 300 claude claude\n' +
      '200 300 claude claude\n' +
      '300 300 claude claude\n' +
      '400 300 claude claude -p "orphan1"\n' +
      '500 300 claude claude -p "orphan2"\n' +
      '600 300 claude claude -p "orphan3"\n'
    );
    // DB: ceceliaUsed=0, autoDispatchUsed=1（只有 1 个真实 in_progress）
    pool.query
      .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // countCeceliaInProgress
      .mockResolvedValueOnce({ rows: [{ count: '1' }] }) // countAutoDispatchInProgress
      .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // getQueueDepth
      .mockResolvedValueOnce({ rows: [{ count: '0' }] }); // countCodexInProgress

    const budget = await calculateSlotBudget();
    // task_pool.used = DB 值 = 1（不是 ps 的 6 或 3）
    expect(budget.taskPool.used).toBe(1);
    // 3 headed sessions → team mode → userReserve=1
    // totalRunning = userSlotsUsed(3) + ceceliaUsed(0) + autoDispatchUsed(1) = 4
    //   (3 orphan headless 不再被计入 totalRunning)
    // available = 8 - 4 - 1(reserve) = 3
    expect(budget.taskPool.available).toBe(3);
    expect(budget.dispatchAllowed).toBe(true);
  });
});
