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

// Mock fleet-resource-cache（防止 slot-allocator import 时触发 SSH 采集）
vi.mock('../fleet-resource-cache.js', () => ({
  getFleetStatus: vi.fn(() => []),
  getRemoteCapacity: vi.fn(() => null),
  isServerOnline: vi.fn(() => false),
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

  it('降至硬零立即停止新增派单', () => {
    applySlotBuffer(8);
    expect(applySlotBuffer(0)).toBe(0);
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

  it.each([
    { token_pressure: 0, available_accounts: 3 },
    { token_pressure: 1, available_accounts: 0 },
    { token_pressure: 1, available_accounts: 1 },
  ])('不读取旧账号状态 $token_pressure/$available_accounts，按机器容量准入', async (legacy) => {
    getTokenPressure.mockResolvedValue(legacy);
    const budget = await calculateSlotBudget();
    expect(getTokenPressure).not.toHaveBeenCalled();
    expect(budget.taskPool.budget).toBe(12);
    expect(budget.dispatchAllowed).toBe(true);
    expect(budget.tokenPressure).toBeNull();
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

  it('旧用量函数会抛异常时也不再调用它', async () => {
    getTokenPressure.mockRejectedValue(new Error('DB down'));

    const budget = await calculateSlotBudget();
    expect(budget.taskPool.budget).toBeGreaterThan(0);
    expect(getTokenPressure).not.toHaveBeenCalled();
  });

  it('hardware 压力骤升至硬零，当次停派，持续压力保持关闭', async () => {
    checkServerResources.mockReturnValue({ effectiveSlots: 12, metrics: { max_pressure: 0.1 } });
    expect((await calculateSlotBudget()).taskPool.budget).toBe(12);
    checkServerResources.mockReturnValue({ effectiveSlots: 0, metrics: { max_pressure: 1.0 } });
    for (let tick = 0; tick < 3; tick += 1) {
      const budget = await calculateSlotBudget();
      expect(budget.taskPool.budget).toBe(0);
      expect(budget.dispatchAllowed).toBe(false);
      expect(budget.resourceAdmissionBlocked).toBe(true);
    }
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

  it('pressure.token 保留字段但明确为空', async () => {
    const status = await getSlotStatus();
    expect(status.pressure.token).toBeNull();
    expect(getTokenPressure).not.toHaveBeenCalled();
  });
});
