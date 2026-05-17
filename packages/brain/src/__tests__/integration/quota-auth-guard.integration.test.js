/**
 * Quota Guard + Auth Circuit Breaker 集成测试
 *
 * 覆盖路径：
 *   Path 1: checkQuotaGuard() — 无用量数据时 fail-open（允许调度）
 *   Path 2: checkQuotaGuard() — 正常用量时允许所有任务
 *   Path 3: checkQuotaGuard() — 低余量时仅允许 P0/P1
 *   Path 4: checkQuotaGuard() — 严重超量时暂停全部调度
 *   Path 5: Auth Circuit Breaker — markAuthFailure/isAuthFailed 状态机
 *   Path 6: Auth Circuit Breaker — 指数退避逻辑（失败次数 → 退避时长）
 *
 * 测试策略：
 *   - Quota Guard 测试：使用 vi.doMock + vi.resetModules() 控制 getAccountUsage 返回值
 *   - Auth 状态机测试：直接测试内存状态机（markAuthFailure/isAuthFailed），mock DB pool
 *   - mock db.js pool（auth 状态机 DB 写入为 fire-and-forget）
 *
 * 关联模块：quota-guard.js, account-usage.js
 */

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

describe('Quota Guard 调度守卫集成测试', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockPool.query.mockResolvedValue({ rows: [] });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── 辅助：构建 account-usage mock（所有测试复用相同结构）────────────────
  function mockAccountUsage(getAccountUsageResult) {
    vi.doMock('../../account-usage.js', () => ({
      getAccountUsage: vi.fn().mockResolvedValue(getAccountUsageResult),
      isAuthFailed: vi.fn().mockReturnValue(false),
      isSpendingCapped: vi.fn().mockReturnValue(false),
      markAuthFailure: vi.fn(),
      markSpendingCap: vi.fn(),
      resetAuthFailureCount: vi.fn(),
      _resetAuthFailures: vi.fn(),
      loadAuthFailuresFromDB: vi.fn().mockResolvedValue(undefined),
      loadSpendingCapsFromDB: vi.fn().mockResolvedValue(undefined),
      getSpendingCapStatus: vi.fn().mockReturnValue([]),
      isAllAccountsSpendingCapped: vi.fn().mockReturnValue(false),
      selectBestAccount: vi.fn().mockResolvedValue({ accountId: 'account1', model: 'sonnet' }),
      selectBestAccountForHaiku: vi.fn().mockResolvedValue('account1'),
    }));
  }

  // ─── Path 1: 无用量数据 → fail-open ───────────────────────────────────────

  describe('Path 1: 无用量数据时 fail-open', () => {
    it('getAccountUsage 返回空对象 → allow=true, reason=no_usage_data', async () => {
      mockAccountUsage({});
      const { checkQuotaGuard } = await import('../../quota-guard.js');
      const result = await checkQuotaGuard();
      expect(result.allow).toBe(true);
      expect(result.reason).toBe('no_usage_data');
      expect(result.bestPct).toBe(0);
    });

    it('getAccountUsage 抛错 → fail-open, reason=check_error', async () => {
      vi.doMock('../../account-usage.js', () => ({
        getAccountUsage: vi.fn().mockRejectedValue(new Error('DB connection failed')),
        isAuthFailed: vi.fn().mockReturnValue(false),
        isSpendingCapped: vi.fn().mockReturnValue(false),
        markAuthFailure: vi.fn(),
        markSpendingCap: vi.fn(),
        resetAuthFailureCount: vi.fn(),
        _resetAuthFailures: vi.fn(),
        loadAuthFailuresFromDB: vi.fn().mockResolvedValue(undefined),
        loadSpendingCapsFromDB: vi.fn().mockResolvedValue(undefined),
        getSpendingCapStatus: vi.fn().mockReturnValue([]),
        isAllAccountsSpendingCapped: vi.fn().mockReturnValue(false),
        selectBestAccount: vi.fn().mockResolvedValue({ accountId: 'account1', model: 'sonnet' }),
        selectBestAccountForHaiku: vi.fn().mockResolvedValue('account1'),
      }));
      const { checkQuotaGuard } = await import('../../quota-guard.js');
      const result = await checkQuotaGuard();
      expect(result.allow).toBe(true);
      expect(result.reason).toBe('check_error');
    });
  });

  // ─── Path 2: 正常用量 → 允许所有 ─────────────────────────────────────────

  describe('Path 2: 正常用量时允许所有任务', () => {
    it('所有账号 five_hour_pct <= 90% → allow=true, priorityFilter=null', async () => {
      mockAccountUsage({ account1: { five_hour_pct: 45 }, account2: { five_hour_pct: 60 } });
      const { checkQuotaGuard } = await import('../../quota-guard.js');
      const result = await checkQuotaGuard();
      expect(result.allow).toBe(true);
      expect(result.priorityFilter).toBeNull();
      expect(result.reason).toBe('quota_ok');
      expect(result.bestPct).toBe(45);
    });
  });

  // ─── Path 3: 低余量 → 仅 P0/P1 ───────────────────────────────────────────

  describe('Path 3: 低余量时仅允许 P0/P1', () => {
    it('最优账号 five_hour_pct=91% → allow=true, priorityFilter=[P0,P1]', async () => {
      mockAccountUsage({ account1: { five_hour_pct: 91 }, account2: { five_hour_pct: 95 } });
      const { checkQuotaGuard } = await import('../../quota-guard.js');
      const result = await checkQuotaGuard();
      expect(result.allow).toBe(true);
      expect(result.priorityFilter).toEqual(['P0', 'P1']);
      expect(result.reason).toBe('quota_low');
      expect(result.bestPct).toBe(91);
    });
  });

  // ─── Path 4: 严重超量 → 暂停全部 ─────────────────────────────────────────

  describe('Path 4: 严重超量时暂停全部调度', () => {
    it('最优账号 five_hour_pct=99% → allow=false, reason=quota_critical', async () => {
      mockAccountUsage({ account1: { five_hour_pct: 99 }, account2: { five_hour_pct: 100 } });
      const { checkQuotaGuard } = await import('../../quota-guard.js');
      const result = await checkQuotaGuard();
      expect(result.allow).toBe(false);
      expect(result.reason).toBe('quota_critical');
      expect(result.bestPct).toBe(99);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Auth Circuit Breaker 测试：直接用 account-usage.js 内存状态机
// 不使用 vi.resetModules()，避免模块实例分裂
// ─────────────────────────────────────────────────────────────────────────────

describe('Auth Circuit Breaker 状态机集成测试', () => {
  let markAuthFailure, isAuthFailed, resetAuthFailureCount, _resetAuthFailures;

  beforeEach(async () => {
    vi.clearAllMocks();
    // 清除 Quota Guard 测试中 vi.doMock 注册的 account-usage mock
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
