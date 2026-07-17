import { describe, it, expect, beforeEach } from 'vitest';
import {
  getAvailableAccountCount, markSpendingCap, markAuthFailure,
  _resetAuthFailures, isSpendingCapped,
} from '../account-usage.js';

describe('getAvailableAccountCount', () => {
  beforeEach(() => {
    _resetAuthFailures();
    // 清 spending cap：markSpendingCap 无对称 reset，用注入账号列表隔离生产态
  });

  it('注入 3 账号全健康 → 3', () => {
    expect(getAvailableAccountCount(['t1', 't2', 't3'])).toBe(3);
  });

  it('1 个 spending-capped → 扣除', () => {
    markSpendingCap('t2', new Date(Date.now() + 3600_000).toISOString());
    expect(isSpendingCapped('t2')).toBe(true);
    expect(getAvailableAccountCount(['t1', 't2', 't3'])).toBe(2);
  });

  it('1 个 auth-failed → 扣除', () => {
    markAuthFailure('t3', new Date(Date.now() + 3600_000).toISOString());
    expect(getAvailableAccountCount(['t1', 't3'])).toBe(1);
  });

  it('默认参数走生产 ACCOUNTS（2 账号）→ 返回 0-2 之间', () => {
    const n = getAvailableAccountCount();
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThanOrEqual(2);
  });
});
