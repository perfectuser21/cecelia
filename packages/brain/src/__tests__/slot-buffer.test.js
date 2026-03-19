/**
 * Slot Buffer + Token Pressure Integration Tests
 *
 * 覆盖：
 * - applySlotBuffer ±2/tick 平滑逻辑
 * - calculateSlotBudget token pressure 集成
 * - getSlotStatus API 中的 token 字段
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted 创建的引用不是 ESM live binding，对 vi.unmock() 免疫
// platform-utils.test.js 的 beforeAll 会调用 vi.unmock('child_process')，
// 如果用 import { execSync } from 'child_process' 那 execSync 会变成真实函数
const mockExecSync = vi.hoisted(() => vi.fn(() => ''));

vi.mock('child_process', () => ({
  execSync: mockExecSync,
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

import { checkServerResources, getEffectiveMaxSeats, getBudgetCap, getTokenPressure } from '../executor.js';
import pool from '../db.js';
import {
  applySlotBuffer,
  _resetSlotBuffer,
  SLOT_BUFFER_MAX_DELTA,
  SLOT_BUFFER_DOWN,
  SLOT_BUFFER_UP,
  calculateSlotBudget,
  getSlotStatus,
} from '../slot-allocator.js';

// ============================================================
// applySlotBuffer (asymmetric: down -3, up +1)
// ============================================================

describe('applySlotBuffer', () => {
  beforeEach(() => {
    _resetSlotBuffer();
  });

  it('SLOT_BUFFER_DOWN 应为 3, SLOT_BUFFER_UP 应为 1', () => {
    expect(SLOT_BUFFER_DOWN).toBe(3);
    expect(SLOT_BUFFER_UP).toBe(1);
    expect(SLOT_BUFFER_MAX_DELTA).toBe(3); // backward compat = DOWN
  });

  it('首次调用应直接返回值（无 buffer）', () => {
    expect(applySlotBuffer(8)).toBe(8);
  });

  it('小幅下降 (≤3) 应直接通过', () => {
    applySlotBuffer(8);
    expect(applySlotBuffer(5)).toBe(5); // delta=-3, within DOWN limit
  });

  it('小幅上升 (≤1) 应直接通过', () => {
    applySlotBuffer(8);
    expect(applySlotBuffer(9)).toBe(9); // delta=+1, within UP limit
  });

  it('大幅下降应限制为 -3（快刹车）', () => {
    applySlotBuffer(8);
    expect(applySlotBuffer(0)).toBe(5);  // 8-3=5
    expect(applySlotBuffer(0)).toBe(2);  // 5-3=2
    expect(applySlotBuffer(0)).toBe(0);  // max(0, 2-3)=0
    expect(applySlotBuffer(0)).toBe(0);
  });

  it('大幅上升应限制为 +1（慢恢复）', () => {
    applySlotBuffer(2);
    expect(applySlotBuffer(10)).toBe(3);  // 2+1=3
    expect(applySlotBuffer(10)).toBe(4);  // 3+1=4
    expect(applySlotBuffer(10)).toBe(5);  // 4+1=5
  });

  it('上升 delta=+2 应限制为 +1', () => {
    applySlotBuffer(5);
    expect(applySlotBuffer(7)).toBe(6); // 5+1=6, not 7
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
    mockExecSync.mockReturnValue('');
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
    // Dynamic model: absent, effectiveSlots=12, totalRunning=0, userReserve=0 → 12
    expect(budget.taskPool.budget).toBe(12);
    expect(budget.tokenPressure.token_pressure).toBe(0);
  });

  it('token_pressure=1.0 + available_accounts=0 → dispatchAllowed=false（全部耗尽）', async () => {
    getTokenPressure.mockResolvedValue({
      token_pressure: 1.0, available_accounts: 0, details: 'all exhausted',
    });

    const budget = await calculateSlotBudget();
    // Token exhausted safety valve: all accounts at quota → block dispatch
    expect(budget.taskPool.budget).toBe(12);
    expect(budget.dispatchAllowed).toBe(false);
    expect(budget.tokenPressure.token_pressure).toBe(1.0);
    expect(budget.tokenPressure.available_accounts).toBe(0);
  });

  it('token_pressure=1.0 + available_accounts=1 → dispatchAllowed=true（仍有账户可用）', async () => {
    getTokenPressure.mockResolvedValue({
      token_pressure: 1.0, available_accounts: 1, details: '1 account recovering',
    });

    const budget = await calculateSlotBudget();
    // Still has available accounts — dispatch allowed
    expect(budget.taskPool.budget).toBe(12);
    expect(budget.dispatchAllowed).toBe(true);
    expect(budget.tokenPressure.token_pressure).toBe(1.0);
    expect(budget.tokenPressure.available_accounts).toBe(1);
  });

  it('token_pressure=0.9 → Pool C 不受影响（token 仅监控）', async () => {
    getTokenPressure.mockResolvedValue({
      token_pressure: 0.9, available_accounts: 1, details: 'barely available',
    });

    const budget = await calculateSlotBudget();
    expect(budget.taskPool.budget).toBe(12); // unaffected
  });

  it('token_pressure=0.7 → Pool C 不受影响（token 仅监控）', async () => {
    getTokenPressure.mockResolvedValue({
      token_pressure: 0.7, available_accounts: 1, details: '1 account ok',
    });

    const budget = await calculateSlotBudget();
    expect(budget.taskPool.budget).toBe(12); // unaffected
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

  it('pressure 只取 hardware 压力（token 不再参与 combined）', async () => {
    checkServerResources.mockReturnValue({
      effectiveSlots: 12,
      metrics: { max_pressure: 0.3 },
    });
    getTokenPressure.mockResolvedValue({
      token_pressure: 0.6, available_accounts: 2, details: 'token higher',
    });

    const budget = await calculateSlotBudget();
    // pressure now only reflects hardware pressure
    expect(budget.pressure).toBe(0.3);
  });

  it('getTokenPressure 异常 → 不影响正常计算', async () => {
    getTokenPressure.mockRejectedValue(new Error('DB down'));

    const budget = await calculateSlotBudget();
    expect(budget.taskPool.budget).toBeGreaterThan(0);
  });

  it('buffer 平滑：hardware 压力骤升，Pool C 快刹车(-3)逐步降', async () => {
    // Tick 1: 正常 (Pool C = 12)
    checkServerResources.mockReturnValue({ effectiveSlots: 12, metrics: { max_pressure: 0.1 } });
    let budget = await calculateSlotBudget();
    expect(budget.taskPool.budget).toBe(12);

    // Tick 2: 极端压力 → effectiveSlots=0 → 目标 0, buffer 限制为 12-3=9
    checkServerResources.mockReturnValue({ effectiveSlots: 0, metrics: { max_pressure: 1.0 } });
    budget = await calculateSlotBudget();
    expect(budget.taskPool.budget).toBe(9);

    // Tick 3: 继续压力 → 9-3=6
    budget = await calculateSlotBudget();
    expect(budget.taskPool.budget).toBe(6);

    // Tick 4: 继续压力 → 6-3=3
    budget = await calculateSlotBudget();
    expect(budget.taskPool.budget).toBe(3);
  });
});

// ============================================================
// getSlotStatus token 字段
// ============================================================

describe('getSlotStatus token 字段', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetSlotBuffer();
    mockExecSync.mockReturnValue('');
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
