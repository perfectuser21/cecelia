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
 * - D2-1: 系统级 CPU 压力高但 Brain 自身 CPU 低 → 降级为 warn，effectiveSlots 不清零
 *   （PIVOT 2026-09-12：同款 memory pivot 2026-04-18，Docker 不隔离 /proc/stat，容器内
 *   读到的是宿主机全局 CPU，us-vps 生产实证 Brain 自己 0.11% CPU 却被同机 openclaw-gateway
 *   等容器拖累判定 pool_c_full，全局拒绝派发）
 * - D2-2: Brain 自身 CPU 真的高 → 依然 halt（不是无脑放行）
 * - D2-3: metrics 暴露 brain_cpu_pct 供可观测性
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist mock return value holders
const mockSampleCpuUsage = vi.hoisted(() => vi.fn());
const mockResetCpuSampler = vi.hoisted(() => vi.fn());
const mockGetSwapUsedPct = vi.hoisted(() => vi.fn(() => 10));
const mockGetDmesgInfo = vi.hoisted(() => vi.fn(() => null));
const mockCountClaudeProcesses = vi.hoisted(() => vi.fn(() => 0));
const mockCalculatePhysicalCapacity = vi.hoisted(() => vi.fn(() => 4));
const mockGetAvailableMemoryMB = vi.hoisted(() => vi.fn(() => 8192));
const mockSampleBrainCpuUsage = vi.hoisted(() => vi.fn(() => 5));
const mockEvaluateCpuHealth = vi.hoisted(() => vi.fn(() => ({
  brain_cpu_ok: true,
  action: 'proceed',
  reason: 'mock',
  brain_cpu_pct: 5,
  brain_cpu_busy_pct: 50,
})));

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
  getAvailableMemoryMB: mockGetAvailableMemoryMB,
  getMacOSMemoryPressure: vi.fn(() => 0),
  // PIVOT 2026-04-18: Brain RSS vs system memory separation
  getBrainRssMB: vi.fn(() => 500),
  evaluateMemoryHealth: vi.fn(() => ({
    brain_memory_ok: true,
    system_memory_ok: true,
    action: 'proceed',
    reason: 'mock',
    brain_rss_mb: 500,
    system_available_mb: 8000,
    system_threshold_mb: 600,
    brain_rss_danger_mb: 1500,
    brain_rss_warn_mb: 1000,
  })),
  // PIVOT 2026-09-12: Brain self CPU% vs system-wide /proc/stat separation
  sampleBrainCpuUsage: mockSampleBrainCpuUsage,
  evaluateCpuHealth: mockEvaluateCpuHealth,
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

describe('checkServerResources Brain 自身 CPU pivot — D2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSampleBrainCpuUsage.mockReturnValue(5);
    mockEvaluateCpuHealth.mockReturnValue({
      brain_cpu_ok: true,
      action: 'proceed',
      reason: 'mock',
      brain_cpu_pct: 5,
      brain_cpu_busy_pct: 50,
    });
    _resetResourceHistory();
  });

  it('D2-1: 宿主机 CPU 高但 Brain 自身 CPU 低 → 降级为 warn，effectiveSlots 不清零', () => {
    // sampleCpuUsage()（system-wide，/proc/stat，容器内实为宿主机全局值）报 90%——
    // us-vps 生产实证：这就是 Brain 自己 0.11% CPU 却被同机 openclaw-gateway
    // 等容器拖累触发 pool_c_full 的真实场景。evaluateCpuHealth 判定 Brain 自身
    // 闲（action=warn）时，不应该把 cpuPressure 保持在 >=1.0 halt 区间。
    mockSampleCpuUsage.mockReturnValue(90);
    mockEvaluateCpuHealth.mockReturnValue({
      brain_cpu_ok: true,
      action: 'warn',
      reason: 'system busy but brain idle (mock)',
      brain_cpu_pct: 3,
      brain_cpu_busy_pct: 50,
    });
    const result = checkServerResources();
    expect(result.metrics.cpu_pressure).toBeLessThan(0.9);
    expect(result.effectiveSlots).toBeGreaterThan(0);
  });

  it('D2-2: Brain 自身 CPU 真的高 → 依然 halt（不是无脑放行）', () => {
    mockSampleCpuUsage.mockReturnValue(90);
    mockEvaluateCpuHealth.mockReturnValue({
      brain_cpu_ok: false,
      action: 'halt',
      reason: 'brain itself busy (mock)',
      brain_cpu_pct: 85,
      brain_cpu_busy_pct: 50,
    });
    const result = checkServerResources();
    expect(result.metrics.cpu_pressure).toBeGreaterThanOrEqual(1.0);
    expect(result.ok).toBe(false);
    expect(result.effectiveSlots).toBe(0);
  });

  it('D2-3: metrics 暴露 brain_cpu_pct 供可观测性', () => {
    mockSampleCpuUsage.mockReturnValue(20);
    mockSampleBrainCpuUsage.mockReturnValue(7);
    const result = checkServerResources();
    expect(result.metrics).toHaveProperty('brain_cpu_pct', 7);
  });
});
