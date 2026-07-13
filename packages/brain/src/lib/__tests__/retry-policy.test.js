import { describe, it, expect } from 'vitest';
import { RETRY_POLICY, getBackoffMs, getMaxRetries, isTransientClass } from '../retry-policy.js';

describe('retry-policy 查表', () => {
  it('四类各自 backoff 数组', () => {
    expect(RETRY_POLICY.rate_limit.backoffMs).toEqual([2 * 60_000, 4 * 60_000, 8 * 60_000]);
    expect(RETRY_POLICY.network.backoffMs).toEqual([5 * 60_000, 10 * 60_000, 15 * 60_000]);
    expect(RETRY_POLICY.timeout.backoffMs).toEqual([3 * 60_000, 6 * 60_000, 12 * 60_000]);
    expect(RETRY_POLICY.server_error.backoffMs).toEqual([1 * 60_000, 5 * 60_000, 15 * 60_000]);
  });

  it('getBackoffMs 按 retryCount 取数组元素', () => {
    expect(getBackoffMs('rate_limit', 0)).toBe(2 * 60_000);
    expect(getBackoffMs('rate_limit', 2)).toBe(8 * 60_000);
    expect(getBackoffMs('server_error', 1)).toBe(5 * 60_000);
  });

  it('retryCount 越界（≥maxRetries）返回 null', () => {
    expect(getBackoffMs('rate_limit', 3)).toBe(null);
    expect(getBackoffMs('network', 99)).toBe(null);
  });

  it('未知类别返回 null / maxRetries=0', () => {
    expect(getBackoffMs('no_such_class', 0)).toBe(null);
    expect(getMaxRetries('no_such_class')).toBe(0);
  });

  it('getMaxRetries 四类均为 3', () => {
    for (const cls of ['rate_limit', 'network', 'timeout', 'server_error']) {
      expect(getMaxRetries(cls)).toBe(3);
    }
  });

  it('isTransientClass：新旧瞬态类别判定（回归：server_error/timeout 与 network 同为瞬态）', () => {
    for (const cls of ['rate_limit', 'network', 'timeout', 'server_error', 'auth']) {
      expect(isTransientClass(cls)).toBe(true);
    }
    for (const cls of ['task_error', 'billing_cap', 'resource', 'unknown', undefined, null]) {
      expect(isTransientClass(cls)).toBe(false);
    }
  });
});
