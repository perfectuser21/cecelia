/**
 * Task C 专属测试：proactiveTokenCheck 保护 api_error 熔断
 *
 * 当 account 因 Bridge exit-code-1 熔断（source='api_error'）时，
 * proactiveTokenCheck 不应因 token 文件有效就清除该熔断（api_error 需等 resetTime 自然过期）。
 *
 * 此测试单独成文，避免与 Task A/B 的 account-usage.js mock 互相污染。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPool, mockReadFileSync } = vi.hoisted(() => {
  const mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
  const mockReadFileSync = vi.fn();
  return { mockPool, mockReadFileSync };
});

vi.mock('../db.js', () => ({ default: mockPool }));
vi.mock('fs', () => ({ readFileSync: mockReadFileSync }));
vi.mock('os', () => ({ homedir: () => '/mock/home' }));

const mockRaise = vi.fn().mockResolvedValue(undefined);
vi.mock('../alerting.js', () => ({ raise: mockRaise }));

import {
  markAuthFailure,
  isAuthFailed,
  proactiveTokenCheck,
  _resetAuthFailures,
} from '../account-usage.js';

function validCredentials(hoursFromNow = 2) {
  return JSON.stringify({
    claudeAiOauth: { accessToken: 'tok', expiresAt: Date.now() + hoursFromNow * 60 * 60 * 1000 },
  });
}

beforeEach(() => {
  _resetAuthFailures();
  mockRaise.mockClear();
  mockPool.query.mockClear();
  mockPool.query.mockResolvedValue({ rows: [] });
  // 默认：所有账号 token 有效（2h 后过期）
  mockReadFileSync.mockImplementation(() => validCredentials(2));
});

describe('proactiveTokenCheck 保护 api_error 熔断（Task C）', () => {
  // H14: account3 退订；测试改用 account2 验证 proactiveTokenCheck 行为
  it('api_error 熔断 + token 有效 → 熔断保留（不清除）', async () => {
    const resetTime = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    markAuthFailure('account2', resetTime, 'api_error');
    expect(isAuthFailed('account2')).toBe(true);

    // 所有账号 token 文件都有效
    mockPool.query.mockClear();
    await proactiveTokenCheck();

    // api_error 熔断应保留
    expect(isAuthFailed('account2')).toBe(true);

    // 不应触发 "is_auth_failed = false" 的 DB 清除 SQL
    const clearCalls = mockPool.query.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && sql.includes('is_auth_failed = false')
    );
    expect(clearCalls.length).toBe(0);
  });

  it('token_expired 熔断 + token 有效 → 熔断清除（token 刷新场景）', async () => {
    const resetTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    markAuthFailure('account2', resetTime, 'token_expired');
    expect(isAuthFailed('account2')).toBe(true);

    await proactiveTokenCheck();

    // token_expired 熔断应被清除（token 已刷新）
    expect(isAuthFailed('account2')).toBe(false);
  });

  it('混合场景：account1=api_error / account2=token_expired', async () => {
    // H14: account3 退订；2 账号语义保留：一个 api_error 保留 + 一个 token_expired 清除
    const apiErrReset = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const tokenExpReset = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    markAuthFailure('account1', apiErrReset, 'api_error');
    markAuthFailure('account2', tokenExpReset, 'token_expired');

    expect(isAuthFailed('account1')).toBe(true);
    expect(isAuthFailed('account2')).toBe(true);

    await proactiveTokenCheck();

    expect(isAuthFailed('account1')).toBe(true);  // api_error 保留
    expect(isAuthFailed('account2')).toBe(false); // token_expired 清除
  });
});
