// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { readMacOSMemoryUsagePercent } from '../infra-status.js';

describe('readMacOSMemoryUsagePercent — macOS 真实压力解析', () => {
  it('正常解析 memory_pressure 输出（free 56% → used 44%）', () => {
    const fakeExec = vi.fn(() => `
File I/O:
Pageins: 1208934165
Pageouts: 29286222

System-wide memory free percentage: 56%
`);
    expect(readMacOSMemoryUsagePercent(fakeExec)).toBe(44);
  });

  it('解析极端值（free 0% → used 100%）', () => {
    const fakeExec = vi.fn(() => 'System-wide memory free percentage: 0%');
    expect(readMacOSMemoryUsagePercent(fakeExec)).toBe(100);
  });

  it('解析极端值（free 100% → used 0%）', () => {
    const fakeExec = vi.fn(() => 'System-wide memory free percentage: 100%');
    expect(readMacOSMemoryUsagePercent(fakeExec)).toBe(0);
  });

  it('命令输出无 free percentage 字段时返回 null（caller fallback）', () => {
    const fakeExec = vi.fn(() => 'unrelated output without the expected key');
    expect(readMacOSMemoryUsagePercent(fakeExec)).toBeNull();
  });

  it('命令抛错时返回 null（caller fallback）', () => {
    const fakeExec = vi.fn(() => { throw new Error('command not found: memory_pressure'); });
    expect(readMacOSMemoryUsagePercent(fakeExec)).toBeNull();
  });

  it('解析数字越界（>100）返回 null（防止脏数据污染 capacity 计算）', () => {
    const fakeExec = vi.fn(() => 'System-wide memory free percentage: 150%');
    expect(readMacOSMemoryUsagePercent(fakeExec)).toBeNull();
  });

  it('保留 1 位小数精度（free 56% → used 44 不是 44.0）', () => {
    // 实现内部 Math.round((100-56)*10)/10 = 44，验证整数也按 1 位小数语义返回
    const fakeExec = vi.fn(() => 'System-wide memory free percentage: 56%');
    const result = readMacOSMemoryUsagePercent(fakeExec);
    expect(typeof result).toBe('number');
    expect(result).toBe(44);
  });
});
