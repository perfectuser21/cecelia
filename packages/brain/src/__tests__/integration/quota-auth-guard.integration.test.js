/** 现役执行回调的认证熔断与指数退避；隔离DB及凭据文件。 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── vi.hoisted — 必须在 vi.mock 工厂中使用的变量在此定义 ─────────────────
const { mockPool } = vi.hoisted(() => {
  const mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
  return { mockPool };
});

// ─── Mock DB pool（fire-and-forget DB 写入，避免真实 DB 依赖）─────────────
vi.mock('../../db.js', () => ({ default: mockPool }));

// ─── Mock fs（account-usage 读取 credentials 文件）──────────────────────────
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    readFileSync: vi.fn().mockReturnValue(''),
    existsSync: vi.fn().mockReturnValue(false),
  };
});

vi.mock('os', () => ({
  homedir: vi.fn().mockReturnValue('/mock/home'),
}));

// ─────────────────────────────────────────────────────────────────────────────

describe('Auth Circuit Breaker 状态机集成测试', () => {
  let markAuthFailure, isAuthFailed, resetAuthFailureCount, _resetAuthFailures;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.doUnmock('../../account-usage.js');
    vi.resetModules();
    mockPool.query.mockResolvedValue({ rows: [] });
    // 导入真实 account-usage.js（内存状态机）
    const mod = await import('../../account-usage.js');
    markAuthFailure = mod.markAuthFailure;
    isAuthFailed = mod.isAuthFailed;
    resetAuthFailureCount = mod.resetAuthFailureCount;
    _resetAuthFailures = mod._resetAuthFailures;
    _resetAuthFailures();
  });

  // ─── Path 5: markAuthFailure / isAuthFailed 状态机 ────────────────────────

  describe('Path 5: markAuthFailure / isAuthFailed 状态机', () => {
    it('初始状态 isAuthFailed=false（无熔断）', () => {
      expect(isAuthFailed('account_test_x1')).toBe(false);
    });

    it('markAuthFailure 后 isAuthFailed 立即返回 true', () => {
      const futureReset = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      markAuthFailure('account_test_x2', futureReset);
      expect(isAuthFailed('account_test_x2')).toBe(true);
    });

    it('markAuthFailure 传入已过期时间 → isAuthFailed 自动清除返回 false', () => {
      const pastReset = new Date(Date.now() - 1000).toISOString();
      markAuthFailure('account_test_x3', pastReset);
      // 过期 resetTime → 自动清除
      expect(isAuthFailed('account_test_x3')).toBe(false);
    });

    it('resetAuthFailureCount 不影响现有熔断状态（仅清除退避计数）', () => {
      const futureReset = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      markAuthFailure('account_test_x4', futureReset);
      expect(isAuthFailed('account_test_x4')).toBe(true);
      resetAuthFailureCount('account_test_x4');
      // 计数清零，但熔断仍有效
      expect(isAuthFailed('account_test_x4')).toBe(true);
    });
  });

  // ─── Path 6: 指数退避逻辑 ─────────────────────────────────────────────────

  describe('Path 6: markAuthFailure 不传 resetTime 使用指数退避', () => {
    it('第 1 次失败 → 立即进入熔断，DB 写入被触发', () => {
      markAuthFailure('account_backoff_1'); // 不传 resetTime → 使用默认 2h 退避

      expect(isAuthFailed('account_backoff_1')).toBe(true);

      // DB 写入应被调用（fire-and-forget INSERT OR UPDATE）
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('account_usage_cache'),
        expect.arrayContaining(['account_backoff_1'])
      );
    });

    it('多次 markAuthFailure 后仍在熔断，DB 写入多次', () => {
      markAuthFailure('account_backoff_2');
      markAuthFailure('account_backoff_2');

      expect(isAuthFailed('account_backoff_2')).toBe(true);
      // DB 写入至少被调用 2 次
      const dbCalls = mockPool.query.mock.calls.filter(c =>
        typeof c[0] === 'string' && c[0].includes('account_usage_cache')
      );
      expect(dbCalls.length).toBeGreaterThanOrEqual(2);
    });
  });
});
