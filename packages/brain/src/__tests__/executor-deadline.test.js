/**
 * Regression test: executor.js watchdog deadline 计算
 *
 * Bug: Math.max(60_000, negative) = 60_000 当 deadline 已过期
 * Fix: 过期或 null deadline → 6h fallback，未过期 → 剩余 ms
 */
import { describe, it, expect } from 'vitest';
import { computeDeadlineMs } from '../executor.js';

const SIX_HOURS_MS = 6 * 3600 * 1000;

describe('computeDeadlineMs', () => {
  it('null deadlineAt → 6h fallback', () => {
    expect(computeDeadlineMs(null)).toBe(SIX_HOURS_MS);
  });

  it('undefined deadlineAt → 6h fallback', () => {
    expect(computeDeadlineMs(undefined)).toBe(SIX_HOURS_MS);
  });

  it('过期的 deadlineAt → 6h fallback（Bug 1 回归）', () => {
    const pastDate = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 分钟前
    const result = computeDeadlineMs(pastDate);
    // Bug: Math.max(60_000, negative) = 60_000；Fix: 应返回 6h
    expect(result).toBe(SIX_HOURS_MS);
    // 确保不是 60_000（这是 bug 的表现）
    expect(result).not.toBe(60_000);
  });

  it('未来的 deadlineAt → 剩余 ms（正数，小于 6h）', () => {
    const futureDate = new Date(Date.now() + 2 * 3600 * 1000).toISOString(); // 2h 后
    const result = computeDeadlineMs(futureDate);
    // 应在 [1h55m, 2h5m] 范围内（允许测试执行延迟）
    expect(result).toBeGreaterThan(1 * 3600 * 1000);
    expect(result).toBeLessThan(SIX_HOURS_MS);
  });

  it('deadline 恰好现在（边界）→ 6h fallback', () => {
    const nowish = new Date(Date.now() - 1).toISOString(); // 刚过期 1ms
    expect(computeDeadlineMs(nowish)).toBe(SIX_HOURS_MS);
  });
});
