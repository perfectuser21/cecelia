import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// 即使canonical db.js被意外加载，也不能创建真实PG连接；fail-open不可吞掉越界。
const boundary = vi.hoisted(() => ({ pg: vi.fn(), fetch: vi.fn(), cache: vi.fn(async () => ({ rows: [] })) }));
vi.mock('../db.js', () => ({ default: { query: boundary.cache } }));
vi.mock('pg', () => ({ default: {
  Pool: class {
    query(...args) {
      boundary.pg(...args);
      return Promise.reject(Error('account_count_test_forbids_real_pg'));
    }
  },
  types: { setTypeParser: vi.fn() },
} }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', (...args) => {
    boundary.fetch(...args);
    throw Error('account_count_test_forbids_network');
  });
});
afterEach(() => {
  try {
    expect(boundary.pg).not.toHaveBeenCalled();
    expect(boundary.fetch).not.toHaveBeenCalled();
    for (const [sql, params] of boundary.cache.mock.calls) {
      expect(sql).toContain('INSERT INTO account_usage_cache');
      expect(['t2', 't3']).toContain(params[0]);
    }
  } finally {
    vi.unstubAllGlobals();
  }
});
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
    expect(boundary.cache).toHaveBeenCalledWith(expect.stringContaining('is_spending_capped'),
      ['t2', expect.any(String)]);
    expect(getAvailableAccountCount(['t1', 't2', 't3'])).toBe(2);
  });

  it('1 个 auth-failed → 扣除', () => {
    markAuthFailure('t3', new Date(Date.now() + 3600_000).toISOString());
    expect(getAvailableAccountCount(['t1', 't3'])).toBe(1);
    expect(boundary.cache).toHaveBeenCalledWith(expect.stringContaining('is_auth_failed'),
      ['t3', expect.any(String), 1]);
  });

  it('默认参数走生产 ACCOUNTS（2 账号）→ 返回 0-2 之间', () => {
    const n = getAvailableAccountCount();
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThanOrEqual(2);
  });
});
