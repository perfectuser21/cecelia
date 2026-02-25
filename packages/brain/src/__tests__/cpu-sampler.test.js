/**
 * cpu-sampler.test.js
 *
 * 测试真实 CPU% 采样器 (sampleCpuUsage) 和 checkServerResources 中的 CPU 压力计算。
 *
 * DoD 映射：
 * - D1-1: sampleCpuUsage() 读取 /proc/stat 计算真实 CPU%
 * - D1-2: sampleCpuUsage() 第一次调用返回 null
 * - D1-3: sampleCpuUsage() 第二次调用返回 0-100 整数
 * - D1-4: checkServerResources() cpuPressure 使用真实 CPU%
 * - D1-5: metrics 保留 load_avg_1m 新增 cpu_usage_pct
 * - D1-6: /proc/stat 不可读时 graceful fallback
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'os';

// Hoist mock variables so vi.mock factory can reference them
const mockReadFileSync = vi.hoisted(() => vi.fn());

// Mock fs (readFileSync) for /proc/stat and /proc/meminfo
vi.mock('fs', () => ({
  readFileSync: mockReadFileSync,
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
  checkServerResources,
  CPU_THRESHOLD_PCT,
  PHYSICAL_CAPACITY,
} from '../executor.js';

// Helper: build a /proc/stat cpu line
// Format: cpu  user nice system idle iowait irq softirq steal
function buildProcStatLine(user, nice, system, idle, iowait = 0, irq = 0, softirq = 0, steal = 0) {
  return `cpu  ${user} ${nice} ${system} ${idle} ${iowait} ${irq} ${softirq} ${steal}`;
}

function buildProcStat(cpuLine) {
  return `${cpuLine}\ncpu0  1000 0 500 3000 100 0 0 0\n`;
}

// Build /proc/meminfo content
function buildMeminfo({ swapTotal = 2097152, swapFree = 1800000 } = {}) {
  return `MemTotal:       16384000 kB
MemFree:         8000000 kB
MemAvailable:   12000000 kB
SwapTotal:      ${swapTotal} kB
SwapFree:       ${swapFree} kB
`;
}

describe('sampleCpuUsage — D1', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetCpuSampler();
  });

  // D1-2: 第一次调用返回 null
  it('D1-2: 第一次调用返回 null（需要两次采样计算 delta）', () => {
    const cpuLine = buildProcStatLine(10000, 0, 5000, 80000, 5000);
    mockReadFileSync.mockReturnValue(buildProcStat(cpuLine));

    const result = sampleCpuUsage();
    expect(result).toBeNull();
  });

  // D1-1 + D1-3: 两次调用计算真实 CPU%
  it('D1-1/D1-3: 两次调用返回 0-100 整数 CPU%', () => {
    // Sample 1: total=100000, idle=85000
    const cpuLine1 = buildProcStatLine(10000, 0, 5000, 80000, 5000);
    mockReadFileSync.mockReturnValue(buildProcStat(cpuLine1));
    sampleCpuUsage(); // first call → null, stores baseline

    // Sample 2: total=110000, idle=88000 → delta: total=10000, idle=3000 → CPU = 70%
    const cpuLine2 = buildProcStatLine(14000, 0, 8000, 83000, 5000);
    mockReadFileSync.mockReturnValue(buildProcStat(cpuLine2));
    const result = sampleCpuUsage();

    expect(result).toBeTypeOf('number');
    expect(Number.isInteger(result)).toBe(true);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(100);
  });

  it('D1-3: 计算 CPU% 正确（known delta）', () => {
    // Sample 1: user=1000 nice=0 system=500 idle=8000 iowait=500 → total=10000, idle=8000+500=8500
    const cpuLine1 = buildProcStatLine(1000, 0, 500, 8000, 500);
    mockReadFileSync.mockReturnValue(buildProcStat(cpuLine1));
    sampleCpuUsage();

    // Sample 2: user=2000 nice=0 system=1000 idle=16000 iowait=1000 → total=20000, idle=16000+1000=17000
    // delta: total=10000, idle=8500 → CPU% = (1-8500/10000)*100 = 15%
    const cpuLine2 = buildProcStatLine(2000, 0, 1000, 16000, 1000);
    mockReadFileSync.mockReturnValue(buildProcStat(cpuLine2));
    const result = sampleCpuUsage();

    expect(result).toBe(15);
  });

  it('D1-3: idle 不变时 CPU=100%（所有时间都在工作）', () => {
    const cpuLine1 = buildProcStatLine(1000, 0, 500, 5000, 500);
    mockReadFileSync.mockReturnValue(buildProcStat(cpuLine1));
    sampleCpuUsage();

    // All delta goes to non-idle fields
    const cpuLine2 = buildProcStatLine(6000, 0, 1500, 5000, 500);
    mockReadFileSync.mockReturnValue(buildProcStat(cpuLine2));
    const result = sampleCpuUsage();

    expect(result).toBe(100);
  });

  it('D1-3: 完全 idle 时 CPU=0%', () => {
    const cpuLine1 = buildProcStatLine(1000, 0, 500, 5000, 500);
    mockReadFileSync.mockReturnValue(buildProcStat(cpuLine1));
    sampleCpuUsage();

    // All delta goes to idle
    const cpuLine2 = buildProcStatLine(1000, 0, 500, 15000, 500);
    mockReadFileSync.mockReturnValue(buildProcStat(cpuLine2));
    const result = sampleCpuUsage();

    expect(result).toBe(0);
  });

  // D1-6: /proc/stat 不可读时 graceful fallback
  it('D1-6: /proc/stat 不可读时返回 null（non-Linux fallback）', () => {
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    const result = sampleCpuUsage();
    expect(result).toBeNull();
  });

  it('D1-6: 第一次成功，第二次 /proc/stat 读取失败 → 返回 null', () => {
    const cpuLine = buildProcStatLine(1000, 0, 500, 8000, 500);
    mockReadFileSync.mockReturnValue(buildProcStat(cpuLine));
    sampleCpuUsage(); // stores baseline

    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    const result = sampleCpuUsage();
    expect(result).toBeNull();
  });

  it('D1-1: _resetCpuSampler 清除状态后首次调用返回 null', () => {
    const cpuLine = buildProcStatLine(1000, 0, 500, 8000, 500);
    mockReadFileSync.mockReturnValue(buildProcStat(cpuLine));
    sampleCpuUsage(); // baseline

    _resetCpuSampler();

    mockReadFileSync.mockReturnValue(buildProcStat(cpuLine));
    const result = sampleCpuUsage();
    expect(result).toBeNull(); // reset, so first call again
  });
});

describe('checkServerResources CPU 压力 — D1-4/D1-5', () => {
  // Helper: set up path-aware readFileSync mock
  // checkServerResources reads /proc/meminfo FIRST (swap), then calls sampleCpuUsage → /proc/stat
  function setupFsMock(procStatContent, meminfoContent) {
    mockReadFileSync.mockImplementation((path) => {
      if (typeof path === 'string' && path.includes('/proc/stat')) return procStatContent;
      if (typeof path === 'string' && path.includes('/proc/meminfo')) return meminfoContent;
      throw new Error(`ENOENT: ${path}`);
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    _resetCpuSampler();
  });

  it('D1-4: cpuPressure 使用真实 CPU%（非 load average）', () => {
    const line1 = buildProcStatLine(1000, 0, 500, 8000, 500);
    const meminfo = buildMeminfo();

    // First call: baseline (sampleCpuUsage returns null)
    setupFsMock(buildProcStat(line1), meminfo);
    const r1 = checkServerResources();
    expect(r1.metrics.cpu_usage_pct).toBeNull();
    expect(r1.metrics.cpu_pressure).toBe(0);

    // Second call: delta → 33% CPU
    // Sample1: idle=8500, total=10000. Sample2: idle=15200, total=20000
    // diffTotal=10000, diffIdle=6700 → CPU=(1-6700/10000)*100=33%
    const line2 = buildProcStatLine(3300, 0, 1500, 13900, 1300);
    setupFsMock(buildProcStat(line2), meminfo);
    const r2 = checkServerResources();
    expect(r2.metrics.cpu_usage_pct).toBe(33);
    expect(r2.metrics.cpu_pressure).toBe(0.41);
    expect(r2.ok).toBe(true);
  });

  it('D1-5: metrics 保留 load_avg_1m 新增 cpu_usage_pct', () => {
    const line1 = buildProcStatLine(1000, 0, 500, 8000, 500);
    setupFsMock(buildProcStat(line1), buildMeminfo());

    const result = checkServerResources();
    expect(result.metrics).toHaveProperty('load_avg_1m');
    expect(typeof result.metrics.load_avg_1m).toBe('number');
    expect(result.metrics).toHaveProperty('cpu_usage_pct');
    expect(result.metrics).toHaveProperty('cpu_threshold_pct', CPU_THRESHOLD_PCT);
    expect(result.metrics).toHaveProperty('physical_capacity', PHYSICAL_CAPACITY);
    expect(result.metrics).toHaveProperty('budget_cap');
  });

  it('D1-4: CPU > threshold 时 ok=false 且 effectiveSlots=0', () => {
    const line1 = buildProcStatLine(1000, 0, 500, 8000, 500);
    setupFsMock(buildProcStat(line1), buildMeminfo());
    checkServerResources(); // baseline

    // Sample1: idle=8500, total=10000. Sample2: idle=9500, total=20000
    // diffTotal=10000, diffIdle=1000 → CPU=(1-1000/10000)*100=90%
    const line2 = buildProcStatLine(8500, 0, 2000, 9000, 500);
    setupFsMock(buildProcStat(line2), buildMeminfo());

    const result = checkServerResources();
    expect(result.metrics.cpu_usage_pct).toBe(90);
    expect(result.metrics.cpu_pressure).toBeGreaterThanOrEqual(1.0);
    expect(result.ok).toBe(false);
    expect(result.effectiveSlots).toBe(0);
    expect(result.reason).toContain('CPU');
  });
});
