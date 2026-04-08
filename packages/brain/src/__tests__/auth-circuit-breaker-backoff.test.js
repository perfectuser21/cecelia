/**
 * auth circuit breaker 指数退避测试
 *
 * 验证 markAuthFailure 在连续失败时实现指数退避：
 * 第 1 次: 2h, 第 2 次: 4h, 第 3 次: 8h, 第 4+ 次: 24h（封顶）
 *
 * 同时验证 resetAuthFailureCount 在凭据恢复时重置计数。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockPool, mockReadFileSync } = vi.hoisted(() => {
  const mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
  const mockReadFileSync = vi.fn();
  return { mockPool, mockReadFileSync };
});

vi.mock('../db.js', () => ({ default: mockPool }));
vi.mock('fs', () => ({ readFileSync: mockReadFileSync, existsSync: vi.fn(() => true) }));
vi.mock('os', () => ({ homedir: vi.fn(() => '/mock/home') }));

import {
  markAuthFailure,
  isAuthFailed,
  resetAuthFailureCount,
} from '../account-usage.js';

function clearAccount(accountId) {
  // 清除熔断：设置一个已过期的时间
  markAuthFailure(accountId, new Date(Date.now() - 1000).toISOString());
  isAuthFailed(accountId); // 触发自动清除
  resetAuthFailureCount(accountId);
}

beforeEach(() => {
  for (const id of ['account1', 'account2', 'account3']) {
    clearAccount(id);
  }
  mockPool.query.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('markAuthFailure — 指数退避', () => {
  it('第 1 次失败 → 2h 熔断', () => {
    const before = Date.now();
    vi.setSystemTime(before);

    markAuthFailure('account1');

    expect(isAuthFailed('account1')).toBe(true);

    // 1h59m 后仍在熔断
    vi.setSystemTime(before + 1 * 60 * 60 * 1000 + 59 * 60 * 1000);
    expect(isAuthFailed('account1')).toBe(true);

    // 2h01m 后已解除
    vi.setSystemTime(before + 2 * 60 * 60 * 1000 + 1 * 60 * 1000);
    expect(isAuthFailed('account1')).toBe(false);
  });

  it('第 2 次连续失败 → 4h 熔断', () => {
    const t0 = Date.now();
    vi.setSystemTime(t0);

    markAuthFailure('account1'); // 第 1 次：2h 熔断

    // 2h 后解除，再次失败
    vi.setSystemTime(t0 + 2 * 60 * 60 * 1000 + 1000);
    isAuthFailed('account1'); // 触发自动清除

    const t1 = Date.now();
    markAuthFailure('account1'); // 第 2 次：4h 熔断

    // 3h59m 后仍在熔断
    vi.setSystemTime(t1 + 3 * 60 * 60 * 1000 + 59 * 60 * 1000);
    expect(isAuthFailed('account1')).toBe(true);

    // 4h01m 后解除
    vi.setSystemTime(t1 + 4 * 60 * 60 * 1000 + 1000);
    expect(isAuthFailed('account1')).toBe(false);
  });

  it('第 3 次连续失败 → 8h 熔断', () => {
    const t0 = Date.now();
    vi.setSystemTime(t0);

    // 第 1 次
    markAuthFailure('account1');
    vi.setSystemTime(t0 + 2 * 60 * 60 * 1000 + 1000);
    isAuthFailed('account1');

    // 第 2 次
    const t1 = Date.now();
    markAuthFailure('account1');
    vi.setSystemTime(t1 + 4 * 60 * 60 * 1000 + 1000);
    isAuthFailed('account1');

    // 第 3 次
    const t2 = Date.now();
    markAuthFailure('account1');

    // 7h59m 后仍在熔断
    vi.setSystemTime(t2 + 7 * 60 * 60 * 1000 + 59 * 60 * 1000);
    expect(isAuthFailed('account1')).toBe(true);

    // 8h01m 后解除
    vi.setSystemTime(t2 + 8 * 60 * 60 * 1000 + 1000);
    expect(isAuthFailed('account1')).toBe(false);
  });

  it('第 4+ 次失败 → 24h 封顶', () => {
    const t0 = Date.now();
    vi.setSystemTime(t0);

    // 连续触发 4 次
    for (let i = 0; i < 4; i++) {
      markAuthFailure('account1');
      const backoff = Math.min(Math.pow(2, i + 1), 24) * 60 * 60 * 1000;
      vi.setSystemTime(Date.now() + backoff + 1000);
      isAuthFailed('account1'); // 清除，让下次可以再调用
    }

    const t4 = Date.now();
    markAuthFailure('account1'); // 第 5 次，应封顶 24h

    // 23h59m 后仍在熔断
    vi.setSystemTime(t4 + 23 * 60 * 60 * 1000 + 59 * 60 * 1000);
    expect(isAuthFailed('account1')).toBe(true);

    // 24h01m 后解除
    vi.setSystemTime(t4 + 24 * 60 * 60 * 1000 + 1000);
    expect(isAuthFailed('account1')).toBe(false);
  });

  it('不同账号的退避计数独立不干扰', () => {
    const t0 = Date.now();
    vi.setSystemTime(t0);

    // account1 第 1 次
    markAuthFailure('account1');
    // account2 第 1 次（独立计数）
    markAuthFailure('account2');

    // 两个账号都应该是 2h 熔断（各自第 1 次）
    vi.setSystemTime(t0 + 1 * 60 * 60 * 1000 + 59 * 60 * 1000);
    expect(isAuthFailed('account1')).toBe(true);
    expect(isAuthFailed('account2')).toBe(true);

    vi.setSystemTime(t0 + 2 * 60 * 60 * 1000 + 1000);
    expect(isAuthFailed('account1')).toBe(false);
    expect(isAuthFailed('account2')).toBe(false);
  });
});

describe('resetAuthFailureCount — 凭据恢复重置', () => {
  it('resetAuthFailureCount 后，下次失败从第 1 次开始（2h 退避）', () => {
    const t0 = Date.now();
    vi.setSystemTime(t0);

    // 先触发 3 次失败（累积到第 3 次 = 8h 退避）
    markAuthFailure('account1');
    vi.setSystemTime(t0 + 2 * 60 * 60 * 1000 + 1000);
    isAuthFailed('account1');

    markAuthFailure('account1');
    vi.setSystemTime(Date.now() + 4 * 60 * 60 * 1000 + 1000);
    isAuthFailed('account1');

    markAuthFailure('account1');
    vi.setSystemTime(Date.now() + 8 * 60 * 60 * 1000 + 1000);
    isAuthFailed('account1'); // 清除第 3 次熔断

    // 凭据恢复，重置计数
    resetAuthFailureCount('account1');

    // 再次失败 → 应该从第 1 次开始（2h）
    const t1 = Date.now();
    markAuthFailure('account1');

    // 1h59m 后仍在熔断
    vi.setSystemTime(t1 + 1 * 60 * 60 * 1000 + 59 * 60 * 1000);
    expect(isAuthFailed('account1')).toBe(true);

    // 2h01m 后解除（验证退避已重置为第 1 次）
    vi.setSystemTime(t1 + 2 * 60 * 60 * 1000 + 1000);
    expect(isAuthFailed('account1')).toBe(false);
  });
});
