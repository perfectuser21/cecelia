/**
 * resource-monitor.test.js
 *
 * 单元测试：getResourcePressure() 阈值逻辑
 * - cpu_load_1m > 2.0 → cpu_throttle=true
 * - memory_pct > 0.85 → memory_throttle=true
 * - any_throttle = cpu_throttle || memory_throttle
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 在 import 模块前 mock os
vi.mock('os', () => ({
  default: {
    loadavg: vi.fn(() => [0.5, 0.5, 0.5]),
  },
}));

import os from 'os';
import { getResourcePressure, resetThresholds } from '../resource-monitor.js';

beforeEach(() => {
  resetThresholds(2.0, 0.85);
  vi.restoreAllMocks();
  os.loadavg.mockReturnValue([0.5, 0.5, 0.5]);
});

describe('getResourcePressure - 返回结构', () => {
  it('返回包含所有必需字段', () => {
    const result = getResourcePressure();
    expect(result).toHaveProperty('cpu_load_1m');
    expect(result).toHaveProperty('memory_pct');
    expect(result).toHaveProperty('cpu_throttle');
    expect(result).toHaveProperty('memory_throttle');
    expect(result).toHaveProperty('any_throttle');
  });

  it('cpu_load_1m 为数字类型', () => {
    const result = getResourcePressure();
    expect(typeof result.cpu_load_1m).toBe('number');
  });

  it('memory_pct 在 0~1 之间', () => {
    const result = getResourcePressure();
    expect(result.memory_pct).toBeGreaterThan(0);
    expect(result.memory_pct).toBeLessThanOrEqual(1);
  });
});

describe('getResourcePressure - CPU 阈值', () => {
  it('cpu_load_1m=3.0 时 cpu_throttle=true', () => {
    os.loadavg.mockReturnValue([3.0, 2.0, 1.5]);
    const result = getResourcePressure();
    expect(result.cpu_load_1m).toBe(3.0);
    expect(result.cpu_throttle).toBe(true);
  });

  it('cpu_load_1m=2.0（等于阈值）时 cpu_throttle=false', () => {
    os.loadavg.mockReturnValue([2.0, 1.5, 1.0]);
    const result = getResourcePressure();
    expect(result.cpu_throttle).toBe(false);
  });

  it('cpu_load_1m=1.0 时 cpu_throttle=false', () => {
    os.loadavg.mockReturnValue([1.0, 1.0, 1.0]);
    const result = getResourcePressure();
    expect(result.cpu_throttle).toBe(false);
  });

  it('cpu_load_1m=2.1 时 cpu_throttle=true', () => {
    os.loadavg.mockReturnValue([2.1, 2.0, 1.8]);
    const result = getResourcePressure();
    expect(result.cpu_throttle).toBe(true);
  });
});

describe('getResourcePressure - 内存阈值', () => {
  it('heapUsed/heapTotal=0.9 时 memory_throttle=true', () => {
    const heapTotal = 1000;
    const heapUsed = 900; // 0.9
    vi.spyOn(process, 'memoryUsage').mockReturnValue({
      heapUsed,
      heapTotal,
      rss: 500,
      external: 10,
      arrayBuffers: 5,
    });
    const result = getResourcePressure();
    expect(result.memory_pct).toBeCloseTo(0.9);
    expect(result.memory_throttle).toBe(true);
  });

  it('heapUsed/heapTotal=0.85（等于阈值）时 memory_throttle=false', () => {
    const heapTotal = 1000;
    const heapUsed = 850; // 0.85
    vi.spyOn(process, 'memoryUsage').mockReturnValue({
      heapUsed,
      heapTotal,
      rss: 500,
      external: 10,
      arrayBuffers: 5,
    });
    const result = getResourcePressure();
    expect(result.memory_throttle).toBe(false);
  });

  it('heapUsed/heapTotal=0.5 时 memory_throttle=false', () => {
    const heapTotal = 1000;
    const heapUsed = 500; // 0.5
    vi.spyOn(process, 'memoryUsage').mockReturnValue({
      heapUsed,
      heapTotal,
      rss: 500,
      external: 10,
      arrayBuffers: 5,
    });
    const result = getResourcePressure();
    expect(result.memory_throttle).toBe(false);
  });
});

describe('getResourcePressure - any_throttle', () => {
  it('cpu 和 memory 都正常时 any_throttle=false', () => {
    os.loadavg.mockReturnValue([0.5, 0.5, 0.5]);
    vi.spyOn(process, 'memoryUsage').mockReturnValue({
      heapUsed: 500,
      heapTotal: 1000,
      rss: 500,
      external: 10,
      arrayBuffers: 5,
    });
    const result = getResourcePressure();
    expect(result.cpu_throttle).toBe(false);
    expect(result.memory_throttle).toBe(false);
    expect(result.any_throttle).toBe(false);
  });

  it('只有 cpu_throttle=true 时 any_throttle=true', () => {
    os.loadavg.mockReturnValue([3.0, 2.0, 1.5]);
    vi.spyOn(process, 'memoryUsage').mockReturnValue({
      heapUsed: 500,
      heapTotal: 1000,
      rss: 500,
      external: 10,
      arrayBuffers: 5,
    });
    const result = getResourcePressure();
    expect(result.cpu_throttle).toBe(true);
    expect(result.memory_throttle).toBe(false);
    expect(result.any_throttle).toBe(true);
  });

  it('只有 memory_throttle=true 时 any_throttle=true', () => {
    os.loadavg.mockReturnValue([0.5, 0.5, 0.5]);
    vi.spyOn(process, 'memoryUsage').mockReturnValue({
      heapUsed: 900,
      heapTotal: 1000,
      rss: 500,
      external: 10,
      arrayBuffers: 5,
    });
    const result = getResourcePressure();
    expect(result.cpu_throttle).toBe(false);
    expect(result.memory_throttle).toBe(true);
    expect(result.any_throttle).toBe(true);
  });

  it('cpu 和 memory 都超阈值时 any_throttle=true', () => {
    os.loadavg.mockReturnValue([3.0, 2.0, 1.5]);
    vi.spyOn(process, 'memoryUsage').mockReturnValue({
      heapUsed: 900,
      heapTotal: 1000,
      rss: 500,
      external: 10,
      arrayBuffers: 5,
    });
    const result = getResourcePressure();
    expect(result.cpu_throttle).toBe(true);
    expect(result.memory_throttle).toBe(true);
    expect(result.any_throttle).toBe(true);
  });
});

describe('resetThresholds', () => {
  it('自定义阈值后，cpu_throttle 按新阈值判断', () => {
    resetThresholds(5.0, 0.85);
    os.loadavg.mockReturnValue([3.0, 2.0, 1.5]);
    const result = getResourcePressure();
    expect(result.cpu_throttle).toBe(false); // 3.0 < 5.0
  });

  it('自定义内存阈值后，memory_throttle 按新阈值判断', () => {
    resetThresholds(2.0, 0.95);
    vi.spyOn(process, 'memoryUsage').mockReturnValue({
      heapUsed: 900,
      heapTotal: 1000,
      rss: 500,
      external: 10,
      arrayBuffers: 5,
    });
    const result = getResourcePressure();
    expect(result.memory_throttle).toBe(false); // 0.9 < 0.95
  });

  it('resetThresholds() 不带参数时恢复默认阈值', () => {
    resetThresholds(5.0, 0.95);
    resetThresholds();
    os.loadavg.mockReturnValue([3.0, 2.0, 1.5]);
    const result = getResourcePressure();
    expect(result.cpu_throttle).toBe(true); // 3.0 > 2.0（默认）
  });
});
