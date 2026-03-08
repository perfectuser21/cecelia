/**
 * cpu-sampler.test.js
 *
 * 测试 executor.js 中 sampleCpuUsage / checkServerResources 对 platform-utils 的集成。
 * 通过 mock platform-utils.js 的导出函数，确保测试在 Linux/macOS 上都能通过。
 *
 * DoD 映射：
 * - D1-1: sampleCpuUsage() 委托给 platform-utils（可控 mock）
 * - D1-2: sampleCpuUsage() 返回 null 时 cpuPressure=0
 * - D1-3: sampleCpuUsage() 返回具体值时正确计算
 * - D1-4: checkServerResources() cpuPressure 使用真实 CPU%
 * - D1-5: metrics 保留 load_avg_1m 新增 cpu_usage_pct
 * - D1-6: platform-utils 返回 null 时 graceful fallback
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist mock return value holders
const mockSampleCpuUsage = vi.hoisted(() => vi.fn());
const mockResetCpuSampler = vi.hoisted(() => vi.fn());
const mockGetSwapUsedPct = vi.hoisted(() => vi.fn(() => 10));
const mockGetDmesgInfo = vi.hoisted(() => vi.fn(() => null));
const mockCountClaudeProcesses = vi.hoisted(() => vi.fn(() => 0));
const mockCalculatePhysicalCapacity = vi.hoisted(() => vi.fn(() => 4));

// Mock platform-utils — the cross-platform abstraction layer
vi.mock('../platform-utils.js', () => ({
  IS_DARWIN: process.platform === 'darwin',
  IS_LINUX: process.platform === 'linux',
  sampleCpuUsage: mockSampleCpuUsage,
  _resetCpuSampler: mockResetCpuSampler,
  getSwapUsedPct: mockGetSwapUsedPct,
  getDmesgInfo: mockGetDmesgInfo,
  countClaudeProcesses: mockCountClaudeProcesses,
  calculatePhysicalCapacity: mockCalculatePhysicalCapacity,
}));

// Mock fs (executor.js may import readFileSync for other uses)
vi.mock('fs', () => ({
  readFileSync: vi.fn(() => ''),
  existsSync: vi.fn(() => false),
}));

// Mock db.js
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(() => Promise.resolve({ rows: [] })),
    on: vi.fn(),
  },
}));

import {
  sampleCpuUsage,
  _resetCpuSampler,
  _resetResourceHistory,
  checkServerResources,
  CPU_THRESHOLD_PCT,
  PHYSICAL_CAPACITY,
} from '../executor.js';

describe('sampleCpuUsage — D1', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // D1-2: platform-utils 返回 null（首次调用或不可读）
  it('D1-2: platform-utils 返回 null 时 sampleCpuUsage 返回 null', () => {
    mockSampleCpuUsage.mockReturnValue(null);
    const result = sampleCpuUsage();
    expect(result).toBeNull();
    expect(mockSampleCpuUsage).toHaveBeenCalledOnce();
  });

  // D1-1 + D1-3: 返回有效 CPU%
  it('D1-1/D1-3: platform-utils 返回整数 CPU% 时透传', () => {
    mockSampleCpuUsage.mockReturnValue(70);
    const result = sampleCpuUsage();
    expect(result).toBe(70);
    expect(result).toBeTypeOf('number');
    expect(Number.isInteger(result)).toBe(true);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(100);
  });

  it('D1-3: 返回精确值 15%', () => {
    mockSampleCpuUsage.mockReturnValue(15);
    const result = sampleCpuUsage();
    expect(result).toBe(15);
  });

  it('D1-3: idle 不变时 CPU=100%', () => {
    mockSampleCpuUsage.mockReturnValue(100);
    const result = sampleCpuUsage();
    expect(result).toBe(100);
  });

  it('D1-3: 完全 idle 时 CPU=0%', () => {
    mockSampleCpuUsage.mockReturnValue(0);
    const result = sampleCpuUsage();
    expect(result).toBe(0);
  });

  // D1-6: graceful fallback（platform-utils 内部异常返回 null）
  it('D1-6: platform-utils 返回 null（不可读/不支持）', () => {
    mockSampleCpuUsage.mockReturnValue(null);
    const result = sampleCpuUsage();
    expect(result).toBeNull();
  });

  it('D1-6: 连续调用，第一次 null 第二次有值', () => {
    mockSampleCpuUsage.mockReturnValueOnce(null).mockReturnValueOnce(33);
    expect(sampleCpuUsage()).toBeNull();
    expect(sampleCpuUsage()).toBe(33);
  });

  it('D1-1: _resetCpuSampler 委托给 platform-utils', () => {
    _resetCpuSampler();
    expect(mockResetCpuSampler).toHaveBeenCalledOnce();
  });
});

describe('checkServerResources CPU 压力 — D1-4/D1-5', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetResourceHistory();
  });

  it('D1-4: cpuPressure 使用真实 CPU%（非 load average）', () => {
    // First call: sampleCpuUsage returns null → cpuPressure=0
    mockSampleCpuUsage.mockReturnValueOnce(null);
    const r1 = checkServerResources();
    expect(r1.metrics.cpu_usage_pct).toBeNull();
    expect(r1.metrics.cpu_pressure).toBe(0);

    // Reset sliding window to isolate second call from first call's mem readings
    _resetResourceHistory();

    // Second call: sampleCpuUsage returns 33% → cpuPressure = 33/80 ≈ 0.41
    mockSampleCpuUsage.mockReturnValueOnce(33);
    const r2 = checkServerResources();
    expect(r2.metrics.cpu_usage_pct).toBe(33);
    expect(r2.metrics.cpu_pressure).toBe(0.41);
    // ok depends on real mem/swap — only assert cpu_pressure is below threshold
    expect(r2.metrics.cpu_pressure).toBeLessThan(1.0);
  });

  it('D1-5: metrics 保留 load_avg_1m 新增 cpu_usage_pct', () => {
    mockSampleCpuUsage.mockReturnValue(null);
    const result = checkServerResources();
    expect(result.metrics).toHaveProperty('load_avg_1m');
    expect(typeof result.metrics.load_avg_1m).toBe('number');
    expect(result.metrics).toHaveProperty('cpu_usage_pct');
    expect(result.metrics).toHaveProperty('cpu_threshold_pct', CPU_THRESHOLD_PCT);
    expect(result.metrics).toHaveProperty('physical_capacity', PHYSICAL_CAPACITY);
    expect(result.metrics).toHaveProperty('budget_cap');
  });

  it('D1-4: CPU > threshold 时 ok=false 且 effectiveSlots=0', () => {
    mockSampleCpuUsage.mockReturnValue(90);
    const result = checkServerResources();
    expect(result.metrics.cpu_usage_pct).toBe(90);
    expect(result.metrics.cpu_pressure).toBeGreaterThanOrEqual(1.0);
    expect(result.ok).toBe(false);
    expect(result.effectiveSlots).toBe(0);
    expect(result.reason).toContain('CPU');
  });
});
