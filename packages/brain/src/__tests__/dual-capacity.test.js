/**
 * dual-capacity.test.js
 *
 * 测试双层容量模型：物理容量（Layer 1）+ 预算帽（Layer 2）。
 *
 * DoD 映射：
 * - D2-1: PHYSICAL_CAPACITY = _AUTO_MAX_SEATS
 * - D2-2: CECELIA_BUDGET_SLOTS 设置 budget cap
 * - D2-3: 向后兼容 CECELIA_MAX_SEATS
 * - D2-4: MAX_SEATS = min(physical, budget)
 * - D2-5: getBudgetCap() 返回三层数据
 * - D2-6: setBudgetCap(n) 运行时修改
 * - D3-1: GET /api/brain/slots 返回双层数据
 * - D3-2: PUT /api/brain/budget-cap 端点
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

afterEach(() => {
  vi.doUnmock('../executor.js');
  vi.doUnmock('../fleet-resource-cache.js');
  vi.doUnmock('child_process');
});
// 容量公式与环境解析由 platform-utils / cpu-sampler 的真实实现测试负责。
// 此文件保留实际 executor 预算变更与 slot-allocator 消费行为。

// Hoist mock variables for vi.mock factory
const mockReadFileSync = vi.hoisted(() => vi.fn(() => {
  throw new Error('ENOENT'); // default: /proc/stat not available
}));

vi.mock('fs', async original => {
  const actual = await original();
  const repositoryRoot = new URL('../../../../', import.meta.url).pathname;
  return {
    ...actual,
    readFileSync: vi.fn((file, ...args) => String(file).includes(repositoryRoot)
      ? actual.readFileSync(file, ...args) : mockReadFileSync(file, ...args)),
    existsSync: vi.fn(() => false),
  };
});

vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(() => Promise.resolve({ rows: [] })),
    on: vi.fn(),
  },
}));

describe('getBudgetCap / setBudgetCap — D2-5/D2-6', () => {
  let getBudgetCap, setBudgetCap, getEffectiveMaxSeats, PHYSICAL_CAPACITY;

  beforeEach(async () => {
    const mod = await import('../executor.js');
    getBudgetCap = mod.getBudgetCap;
    setBudgetCap = mod.setBudgetCap;
    getEffectiveMaxSeats = mod.getEffectiveMaxSeats;
    PHYSICAL_CAPACITY = mod.PHYSICAL_CAPACITY;

    // Reset to no budget cap
    setBudgetCap(null);
  });

  // D2-5: getBudgetCap() 返回三层数据
  it('D2-5: getBudgetCap() 返回 { budget, physical, effective } 三层数据', () => {
    const result = getBudgetCap();
    expect(result).toHaveProperty('budget');
    expect(result).toHaveProperty('physical');
    expect(result).toHaveProperty('effective');
    expect(result.physical).toBe(PHYSICAL_CAPACITY);
  });

  it('D2-5: 无 budget cap 时 effective = physical', () => {
    const result = getBudgetCap();
    expect(result.budget).toBeNull();
    expect(result.effective).toBe(result.physical);
  });

  // D2-6: setBudgetCap(n) 运行时修改
  // 5/3 修复后：显式 budget 不再被 PHYSICAL_CAPACITY 截断（低内存容器场景），
  // 由 checkServerResources 的实时压力缩放兜底安全。详见 docs/diagnosis/slot-allocator-shrink-rca.md
  it('D2-6: setBudgetCap(6) 设置 budget=6（显式覆盖不再被 physical 截断）', () => {
    const result = setBudgetCap(6);
    expect(result.budget).toBe(6);
    expect(result.effective).toBe(6);
  });

  it('D2-6: setBudgetCap(null) 清除 budget cap', () => {
    setBudgetCap(6);
    const result = setBudgetCap(null);
    expect(result.budget).toBeNull();
    expect(result.effective).toBe(PHYSICAL_CAPACITY);
  });

  it('D2-6: setBudgetCap(0) 抛出错误（必须为正整数）', () => {
    expect(() => setBudgetCap(0)).toThrow('Budget cap must be a positive integer');
  });

  it('D2-6: setBudgetCap(-1) 抛出错误', () => {
    expect(() => setBudgetCap(-1)).toThrow('Budget cap must be a positive integer');
  });

  it('D2-6: setBudgetCap("abc") 抛出错误', () => {
    expect(() => setBudgetCap('abc')).toThrow('Budget cap must be a positive integer');
  });

  it('D2-6: setBudgetCap 后 getEffectiveMaxSeats 反映新值（不再被 physical 截断）', () => {
    setBudgetCap(4);
    expect(getEffectiveMaxSeats()).toBe(4);

    setBudgetCap(null);
    expect(getEffectiveMaxSeats()).toBe(PHYSICAL_CAPACITY);
  });

  // 5/3 修复后：budget > physical 时 effective = budget（不再截断到 physical）
  // 旧行为把用户 ENV 显式 budget 静默截到低内存容器的 PHYSICAL_CAPACITY=2，导致 effectiveSlots=1
  // 真实安全阀是 checkServerResources() 的 cpu/mem/swap pressure 缩放
  it('D2-6: budget > physical 时 effective = budget（显式覆盖原样尊重）', () => {
    setBudgetCap(9999);
    const result = getBudgetCap();
    expect(result.effective).toBe(9999);
  });
});

// ============================================================
// API endpoint tests — D3
// ============================================================

describe('API 端点 — D3', () => {
  // D3-1: GET /api/brain/slots 返回双层数据
  it('D3-1: getSlotStatus 结果应包含 capacity 字段', async () => {
    // Mock child_process for slot-allocator
    vi.doMock('child_process', () => ({
      execSync: vi.fn(() => ''),
    }));

    // Mock executor for slot-allocator
    vi.doMock('../executor.js', () => ({
      MAX_SEATS: 12,
      PHYSICAL_CAPACITY: 12,
      getEffectiveMaxSeats: vi.fn(() => 12),
      getBudgetCap: vi.fn(() => ({ budget: null, physical: 12, effective: 12 })),
      checkServerResources: vi.fn(() => ({
        effectiveSlots: 12,
        metrics: { max_pressure: 0.1 },
      })),
      getActiveProcessCount: vi.fn(() => 0),
    }));

    vi.doMock('../db.js', () => ({
      default: {
        query: vi.fn(() => Promise.resolve({ rows: [{ count: '0' }] })),
      },
    }));

    vi.doMock('../fleet-resource-cache.js', () => ({
      getFleetStatus: vi.fn(() => []),
      getRemoteCapacity: vi.fn(() => null),
      isServerOnline: vi.fn(() => false),
    }));

    const { getSlotStatus } = await import('../slot-allocator.js');
    const status = await getSlotStatus();

    expect(status).toHaveProperty('capacity');
    expect(status.capacity).toHaveProperty('physical', 12);
    expect(status.capacity).toHaveProperty('effective', 12);
    expect(status.capacity).toHaveProperty('budget', null);
    expect(status).toHaveProperty('total_capacity', 12);
  });

  it('D3-2: 真实budget-cap路由设置、清除预算并拒绝无效值', async () => {
    vi.doUnmock('../executor.js');
    vi.doUnmock('child_process');
    const [{ default: express }, { default: request }, { default: router }, executor] = await Promise.all([
      import('express'), import('supertest'), import('../routes/execution.js'), import('../executor.js'),
    ]);
    const app = express();
    app.use(express.json());
    app.use('/api/brain', router);
    try {
      const set = await request(app).put('/api/brain/budget-cap').send({ slots: 6 });
      expect(set.status).toBe(200);
      expect(set.body).toMatchObject({ budget: 6, effective: 6 });
      expect(executor.getBudgetCap().budget).toBe(6);
      const invalid = await request(app).put('/api/brain/budget-cap').send({ slots: -1 });
      expect(invalid.status).toBe(400);
      expect(executor.getBudgetCap().budget).toBe(6);
      const clear = await request(app).put('/api/brain/budget-cap').send({});
      expect(clear.status).toBe(200);
      expect(clear.body.budget).toBeNull();
      expect(clear.body.effective).toBe(executor.PHYSICAL_CAPACITY);
    } finally {
      executor.setBudgetCap(null);
    }
  });
});
