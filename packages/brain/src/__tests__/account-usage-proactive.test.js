/**
 * account-usage.js — proactiveTokenCheck() 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPool, mockReadFileSync } = vi.hoisted(() => {
  const mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
  const mockReadFileSync = vi.fn();
  return { mockPool, mockReadFileSync };
});

vi.mock('../db.js', () => ({ default: mockPool }));
vi.mock('fs', () => ({ readFileSync: mockReadFileSync }));
vi.mock('os', () => ({ homedir: vi.fn(() => '/mock/home') }));

const mockRaise = vi.fn().mockResolvedValue(undefined);
vi.mock('../alerting.js', () => ({ raise: mockRaise }));

import {
  proactiveTokenCheck,
  markAuthFailure,
  isAuthFailed,
} from '../account-usage.js';

function makeCredentials(expiresAt) {
  return JSON.stringify({ claudeAiOauth: { accessToken: 'tok', expiresAt } });
}

function clearAuthFailures() {
  const pastTime = new Date(Date.now() - 1000).toISOString();
  for (const id of ['account1', 'account2', 'account3']) {
    markAuthFailure(id, pastTime);
    isAuthFailed(id); // 触发自动清理
  }
}

beforeEach(() => {
  clearAuthFailures();
  mockRaise.mockClear();
  mockPool.query.mockResolvedValue({ rows: [] });
});

describe('proactiveTokenCheck', () => {
  it('token 已过期 → markAuthFailure + 触发 P1 告警', async () => {
    const expiredAt = Date.now() - 10 * 60 * 1000; // 10min ago
    mockReadFileSync.mockImplementation((path) => {
      if (path.includes('account1')) return makeCredentials(expiredAt);
      if (path.includes('account2')) return makeCredentials(Date.now() + 3 * 60 * 60 * 1000);
      if (path.includes('account3')) return makeCredentials(Date.now() + 3 * 60 * 60 * 1000);
    });

    await proactiveTokenCheck();

    expect(isAuthFailed('account1')).toBe(true);
    expect(isAuthFailed('account2')).toBe(false);
    expect(isAuthFailed('account3')).toBe(false);
    expect(mockRaise).toHaveBeenCalledWith(
      'P1',
      'token_expired_account1',
      expect.stringContaining('account1')
    );
  });

  it('token < 30min 过期 → 触发 P1 告警，但不 markAuthFailure', async () => {
    const soonExpiry = Date.now() + 15 * 60 * 1000; // 15min later
    mockReadFileSync.mockImplementation(() => makeCredentials(soonExpiry));

    await proactiveTokenCheck();

    expect(isAuthFailed('account1')).toBe(false);
    expect(mockRaise).toHaveBeenCalledWith(
      'P1',
      'token_expiring_soon_account1',
      expect.stringContaining('分钟')
    );
  });

  it('token 有效 + 之前 token_expired auth-failed → 清除熔断（token 刷新场景）', async () => {
    markAuthFailure('account1', null, 'token_expired');
    expect(isAuthFailed('account1')).toBe(true);

    const futureExpiry = Date.now() + 2 * 60 * 60 * 1000; // 2h valid
    mockReadFileSync.mockImplementation(() => makeCredentials(futureExpiry));

    await proactiveTokenCheck();

    expect(isAuthFailed('account1')).toBe(false);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('is_auth_failed = false'),
      ['account1']
    );
  });

  it('token 无 expiresAt → 视为有效，不熔断', async () => {
    mockReadFileSync.mockImplementation(() =>
      JSON.stringify({ claudeAiOauth: { accessToken: 'tok' } })
    );

    await proactiveTokenCheck();

    expect(isAuthFailed('account1')).toBe(false);
    expect(mockRaise).not.toHaveBeenCalled();
  });

  it('已过期但已是 auth-failed → 不重复 markAuthFailure', async () => {
    markAuthFailure('account2', new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
    const callsBefore = mockPool.query.mock.calls.length;

    const expiredAt = Date.now() - 5 * 60 * 1000;
    const validExpiry = Date.now() + 2 * 60 * 60 * 1000;
    mockReadFileSync.mockImplementation((path) => {
      // account1/account3 有效；account2 已过期且已 auth-failed
      if (path.includes('account2')) return makeCredentials(expiredAt);
      return makeCredentials(validExpiry);
    });

    await proactiveTokenCheck();

    // account2 已在 auth-failed，不应再次调用 markAuthFailure（不产生额外 DB 写入）
    const insertCalls = mockPool.query.mock.calls.slice(callsBefore).filter(
      ([sql]) => typeof sql === 'string' && sql.includes('is_auth_failed') && sql.includes('INSERT')
    );
    expect(insertCalls.length).toBe(0);
  });
});
