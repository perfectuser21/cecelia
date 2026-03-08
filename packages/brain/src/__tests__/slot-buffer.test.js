/**
 * Slot Buffer + Token Pressure Integration Tests
 *
 * 覆盖：
 * - applySlotBuffer ±2/tick 平滑逻辑
 * - calculateSlotBudget token pressure 集成
 * - getSlotStatus API 中的 token 字段
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
    effectiveSlots: 12,
    metrics: { max_pressure: 0.1 },
  })),
  getActiveProcessCount: vi.fn(() => 0),
  getTokenPressure: vi.fn(() => Promise.resolve({
    token_pressure: 0,
    available_accounts: 3,
    details: 'mock',
  })),
  TOKEN_PRESSURE_THRESHOLD: 80,
}));

vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(() => Promise.resolve({ rows: [{ count: '0' }] })),
  },
}));

import { execSync } from 'child_process';
import { checkServerResources, getEffectiveMaxSeats, getBudgetCap, getTokenPressure } from '../executor.js';
import pool from '../db.js';
import {
  applySlotBuffer,
  _resetSlotBuffer,
  SLOT_BUFFER_MAX_DELTA,
  calculateSlotBudget,
  getSlotStatus,
} from '../slot-allocator.js';

// ============================================================
// applySlotBuffer
// ============================================================

describe('applySlotBuffer', () => {
  beforeEach(() => {
    _resetSlotBuffer();
  });

  it('SLOT_BUFFER_MAX_DELTA 应为 2', () => {
    expect(SLOT_BUFFER_MAX_DELTA).toBe(2);
  });

  it('首次调用应直接返回值（无 buffer）', () => {
    expect(applySlotBuffer(8)).toBe(8);
  });

  it('小幅变化 (≤2) 应直接通过', () => {
    applySlotBuffer(8);
    expect(applySlotBuffer(7)).toBe(7);
    expect(applySlotBuffer(9)).toBe(9);
  });

  it('大幅下降应限制为 -2', () => {
    applySlotBuffer(8);
    expect(applySlotBuffer(0)).toBe(6);
    expect(applySlotBuffer(0)).toBe(4);
    expect(applySlotBuffer(0)).toBe(2);
    expect(applySlotBuffer(0)).toBe(0);
    expect(applySlotBuffer(0)).toBe(0);
  });

  it('大幅上升应限制为 +2', () => {
    applySlotBuffer(2);
    expect(applySlotBuffer(10)).toBe(4);
    expect(applySlotBuffer(10)).toBe(6);
    expect(applySlotBuffer(10)).toBe(8);
  });

  it('buffer 不会产生负数', () => {
    applySlotBuffer(1);
    expect(applySlotBuffer(0)).toBe(0);
    expect(applySlotBuffer(0)).toBe(0);
  });
});

// ============================================================
// calculateSlotBudget token 集成
// ============================================================

describe('calculateSlotBudget token 集成', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetSlotBuffer();
    execSync.mockReturnValue('');
    checkServerResources.mockReturnValue({
      effectiveSlots: 12,
      metrics: { max_pressure: 0.1 },
    });
    getEffectiveMaxSeats.mockReturnValue(12);
    getBudgetCap.mockReturnValue({ budget: null, physical: 12, effective: 12 });
    pool.query.mockResolvedValue({ rows: [{ count: '0' }] });
    getTokenPressure.mockResolvedValue({
      token_pressure: 0, available_accounts: 3, details: 'mock',
    });
  });

  it('token_pressure=0 → Pool C 不受 token 限制', async () => {
    const budget = await calculateSlotBudget();
    expect(budget.taskPool.budget).toBe(8);
    expect(budget.tokenPressure.token_pressure).toBe(0);
  });

  it('token_pressure=1.0 → Pool C = 0', async () => {
    getTokenPressure.mockResolvedValue({
      token_pressure: 1.0, available_accounts: 0, details: 'all exhausted',
    });

    const budget = await calculateSlotBudget();
    expect(budget.taskPool.budget).toBe(0);
    expect(budget.dispatchAllowed).toBe(false);
  });

  it('token_pressure=0.9 → Pool C 最多 1', async () => {
    getTokenPressure.mockResolvedValue({
      token_pressure: 0.9, available_accounts: 1, details: 'barely available',
    });

    const budget = await calculateSlotBudget();
    expect(budget.taskPool.budget).toBeLessThanOrEqual(1);
  });

  it('token_pressure=0.7 → Pool C 减半', async () => {
    getTokenPressure.mockResolvedValue({
      token_pressure: 0.7, available_accounts: 1, details: '1 account ok',
    });

    const budget = await calculateSlotBudget();
    expect(budget.taskPool.budget).toBeLessThanOrEqual(4);
    expect(budget.taskPool.budget).toBeGreaterThan(0);
  });

  it('返回值应包含 tokenPressure 字段', async () => {
    getTokenPressure.mockResolvedValue({
      token_pressure: 0.3, available_accounts: 2, details: '2 accounts ok',
    });

    const budget = await calculateSlotBudget();
    expect(budget.tokenPressure).toBeDefined();
    expect(budget.tokenPressure.token_pressure).toBe(0.3);
    expect(budget.tokenPressure.available_accounts).toBe(2);
  });

  it('combinedPressure 取 hardware 和 token 的最大值', async () => {
    checkServerResources.mockReturnValue({
      effectiveSlots: 12,
      metrics: { max_pressure: 0.3 },
    });
    getTokenPressure.mockResolvedValue({
      token_pressure: 0.6, available_accounts: 2, details: 'token higher',
    });

    const budget = await calculateSlotBudget();
    expect(budget.pressure).toBe(0.6);
  });

  it('getTokenPressure 异常 → 不影响正常计算', async () => {
    getTokenPressure.mockRejectedValue(new Error('DB down'));

    const budget = await calculateSlotBudget();
    expect(budget.taskPool.budget).toBeGreaterThan(0);
  });

  it('buffer 平滑：连续两次 token 满载，Pool C 逐步降', async () => {
    // Tick 1: 正常 (Pool C = 8)
    getTokenPressure.mockResolvedValue({ token_pressure: 0, available_accounts: 3, details: '' });
    let budget = await calculateSlotBudget();
    expect(budget.taskPool.budget).toBe(8);

    // Tick 2: token 满载 → 目标 0，但 buffer 限制为 8-2=6
    getTokenPressure.mockResolvedValue({ token_pressure: 1.0, available_accounts: 0, details: '' });
    budget = await calculateSlotBudget();
    expect(budget.taskPool.budget).toBe(6);

    // Tick 3: 继续满载 → 6-2=4
    budget = await calculateSlotBudget();
    expect(budget.taskPool.budget).toBe(4);
  });
});

// ============================================================
// getSlotStatus token 字段
// ============================================================

describe('getSlotStatus token 字段', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetSlotBuffer();
    execSync.mockReturnValue('');
    checkServerResources.mockReturnValue({
      effectiveSlots: 12,
      metrics: { max_pressure: 0.1 },
    });
    getEffectiveMaxSeats.mockReturnValue(12);
    getBudgetCap.mockReturnValue({ budget: null, physical: 12, effective: 12 });
    pool.query.mockResolvedValue({ rows: [{ count: '0' }] });
    getTokenPressure.mockResolvedValue({
      token_pressure: 0.4, available_accounts: 2, details: '2/3 available',
    });
  });

  it('pressure 字段应包含 token 子对象', async () => {
    const status = await getSlotStatus();
    expect(status.pressure.token).toBeDefined();
    expect(status.pressure.token.token_pressure).toBe(0.4);
    expect(status.pressure.token.available_accounts).toBe(2);
  });
});
