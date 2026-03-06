/**
 * account-usage.js 单元测试
 * 测试 Claude Max 账号用量查询与智能调度选择（mock pool + fetch）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock 外部依赖（vi.hoisted 确保在模块加载前初始化）───────────────────────

const { mockPool, mockReadFileSync, mockFetch } = vi.hoisted(() => {
  const mockPool = { query: vi.fn() };
  const mockReadFileSync = vi.fn();
  const mockFetch = vi.fn();
  return { mockPool, mockReadFileSync, mockFetch };
});

vi.mock('../db.js', () => ({ default: mockPool }));

vi.mock('fs', () => ({
  readFileSync: mockReadFileSync,
}));

vi.mock('os', () => ({
  homedir: vi.fn(() => '/mock/home'),
}));

vi.stubGlobal('fetch', mockFetch);

// 导入被测模块（必须在 vi.mock 之后）
import {
  markSpendingCap,
  isSpendingCapped,
  loadSpendingCapsFromDB,
  isAllAccountsSpendingCapped,
  getSpendingCapStatus,
  getAccountUsage,
  selectBestAccount,
  selectBestAccountForHaiku,
} from '../account-usage.js';

// ─── 工具函数 ────────────────────────────────────────────────────────────────

/**
 * 构造合法的 credentials JSON
 */
function makeCredentials(accessToken = 'mock-token', expiresAt = Date.now() + 3600000) {
  return JSON.stringify({
    claudeAiOauth: { accessToken, expiresAt },
  });
}

/**
 * 构造 Anthropic Usage API 响应
 */
function makeUsageResponse(overrides = {}) {
  return {
    five_hour: { utilization: 30, resets_at: null, ...overrides.five_hour },
    seven_day: { utilization: 20, resets_at: null, ...overrides.seven_day },
    seven_day_sonnet: { utilization: 15, resets_at: null, ...overrides.seven_day_sonnet },
    extra_usage: { utilization: 0, ...overrides.extra_usage },
  };
}

/**
 * 重置 spending cap 内部 Map（通过 isSpendingCapped 过期清理机制）
 * 将所有账号标记为过去时间，再调用 isSpendingCapped 触发清理
 */
function clearSpendingCaps() {
  const pastTime = new Date(Date.now() - 1000).toISOString();
  for (const id of ['account1', 'account2', 'account3']) {
    markSpendingCap(id, pastTime);
    isSpendingCapped(id); // 触发自动清理
  }
}

/**
 * 设置 readFileSync 为三个账号都返回有效凭据
 */
function setupValidCredentials() {
  mockReadFileSync.mockImplementation((path) => {
    if (path.includes('.credentials.json')) {
      return makeCredentials();
    }
    throw new Error('file not found');
  });
}

/**
 * 设置 fetch 返回正常 usage 数据
 */
function setupFetchUsage(overridesPerAccount = {}) {
  mockFetch.mockImplementation(async () => ({
    ok: true,
    json: async () => makeUsageResponse(overridesPerAccount),
  }));
}

// ─── 测试 ────────────────────────────────────────────────────────────────────

describe('account-usage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认 pool.query 返回空
    mockPool.query.mockResolvedValue({ rows: [] });
    clearSpendingCaps();
    // clearSpendingCaps 会产生额外的 mock 调用，重置计数
    vi.clearAllMocks();
    mockPool.query.mockResolvedValue({ rows: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ════════════════════════════════════════════════════════════════════════════
  // markSpendingCap
  // ════════════════════════════════════════════════════════════════════════════

  describe('markSpendingCap', () => {
    it('应标记账号并持久化到 DB', () => {
      const resetTime = new Date(Date.now() + 7200000).toISOString();
      markSpendingCap('account1', resetTime);

      expect(isSpendingCapped('account1')).toBe(true);
      // 应调用 pool.query 写入 DB
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO account_usage_cache'),
        ['account1', resetTime]
      );
    });

    it('不传 resetTime 时应默认约 2 小时后', () => {
      const before = Date.now();
      markSpendingCap('account2');

      expect(isSpendingCapped('account2')).toBe(true);

      // 检查 DB 写入的 resetTime 约等于 now + 2h
      const dbCall = mockPool.query.mock.calls.find(
        c => c[0].includes('INSERT INTO account_usage_cache') && c[1][0] === 'account2'
      );
      expect(dbCall).toBeTruthy();
      const resetTime = new Date(dbCall[1][1]).getTime();
      const twoHoursMs = 2 * 60 * 60 * 1000;
      // 允许 5 秒偏差
      expect(Math.abs(resetTime - before - twoHoursMs)).toBeLessThan(5000);
    });

    it('DB 写入失败时不抛异常（fire-and-forget）', () => {
      mockPool.query.mockRejectedValue(new Error('DB down'));
      expect(() => markSpendingCap('account1')).not.toThrow();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // isSpendingCapped
  // ════════════════════════════════════════════════════════════════════════════

  describe('isSpendingCapped', () => {
    it('未标记的账号应返回 false', () => {
      expect(isSpendingCapped('account1')).toBe(false);
    });

    it('标记后且未过期应返回 true', () => {
      const futureTime = new Date(Date.now() + 7200000).toISOString();
      markSpendingCap('account1', futureTime);
      expect(isSpendingCapped('account1')).toBe(true);
    });

    it('标记后已过期应返回 false 并清除', () => {
      const pastTime = new Date(Date.now() - 1000).toISOString();
      markSpendingCap('account1', pastTime);
      expect(isSpendingCapped('account1')).toBe(false);

      // 应清除 DB 标记
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE account_usage_cache SET is_spending_capped = false'),
        ['account1']
      );
    });

    it('DB 清除失败时不抛异常', () => {
      mockPool.query.mockRejectedValue(new Error('DB down'));
      const pastTime = new Date(Date.now() - 1000).toISOString();
      markSpendingCap('account1', pastTime);
      expect(() => isSpendingCapped('account1')).not.toThrow();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // loadSpendingCapsFromDB
  // ════════════════════════════════════════════════════════════════════════════

  describe('loadSpendingCapsFromDB', () => {
    it('应从 DB 恢复未过期的 spending cap', async () => {
      const futureTime = new Date(Date.now() + 7200000).toISOString();
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { account_id: 'account1', spending_cap_resets_at: futureTime },
          { account_id: 'account3', spending_cap_resets_at: futureTime },
        ],
      });

      await loadSpendingCapsFromDB();

      expect(isSpendingCapped('account1')).toBe(true);
      expect(isSpendingCapped('account2')).toBe(false);
      expect(isSpendingCapped('account3')).toBe(true);
    });

    it('DB 无记录时应正常运行', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      await loadSpendingCapsFromDB();

      expect(isSpendingCapped('account1')).toBe(false);
      expect(isSpendingCapped('account2')).toBe(false);
      expect(isSpendingCapped('account3')).toBe(false);
    });

    it('DB 查询失败时应 warn 但不抛异常', async () => {
      mockPool.query.mockRejectedValue(new Error('DB down'));
      await expect(loadSpendingCapsFromDB()).resolves.toBeUndefined();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // isAllAccountsSpendingCapped
  // ════════════════════════════════════════════════════════════════════════════

  describe('isAllAccountsSpendingCapped', () => {
    it('无账号被标记时应返回 false', () => {
      expect(isAllAccountsSpendingCapped()).toBe(false);
    });

    it('部分账号被标记时应返回 false', () => {
      const futureTime = new Date(Date.now() + 7200000).toISOString();
      markSpendingCap('account1', futureTime);
      markSpendingCap('account2', futureTime);
      expect(isAllAccountsSpendingCapped()).toBe(false);
    });

    it('所有账号都被标记时应返回 true', () => {
      const futureTime = new Date(Date.now() + 7200000).toISOString();
      markSpendingCap('account1', futureTime);
      markSpendingCap('account2', futureTime);
      markSpendingCap('account3', futureTime);
      expect(isAllAccountsSpendingCapped()).toBe(true);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // getSpendingCapStatus
  // ════════════════════════════════════════════════════════════════════════════

  describe('getSpendingCapStatus', () => {
    it('应返回所有 3 个账号的状态', () => {
      const status = getSpendingCapStatus();
      expect(status).toHaveLength(3);
      expect(status.map(s => s.accountId)).toEqual(['account1', 'account2', 'account3']);
    });

    it('未被标记的账号应返回 capped=false, resetTime=null', () => {
      const status = getSpendingCapStatus();
      for (const s of status) {
        expect(s.capped).toBe(false);
        expect(s.resetTime).toBeNull();
      }
    });

    it('被标记的账号应返回 capped=true 和 resetTime', () => {
      const futureTime = new Date(Date.now() + 7200000).toISOString();
      markSpendingCap('account2', futureTime);

      const status = getSpendingCapStatus();
      const a2 = status.find(s => s.accountId === 'account2');
      expect(a2.capped).toBe(true);
      expect(a2.resetTime).toBe(futureTime);

      const a1 = status.find(s => s.accountId === 'account1');
      expect(a1.capped).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // getAccountUsage
  // ════════════════════════════════════════════════════════════════════════════

  describe('getAccountUsage', () => {
    it('有缓存时应返回缓存数据（不调用 API）', async () => {
      const cachedRow = {
        account_id: 'account1',
        five_hour_pct: 50,
        seven_day_pct: 30,
        seven_day_sonnet_pct: 20,
        resets_at: null,
        seven_day_resets_at: null,
        extra_used: false,
      };

      // getCached 返回缓存（INTERVAL 查询）
      mockPool.query.mockImplementation(async (sql) => {
        if (sql.includes('INTERVAL')) {
          return { rows: [cachedRow] };
        }
        return { rows: [] };
      });

      const usage = await getAccountUsage();
      expect(usage.account1).toEqual(cachedRow);
      // fetch 不应被调用（因为缓存命中）
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('forceRefresh=true 时应跳过缓存', async () => {
      setupValidCredentials();
      setupFetchUsage();

      // upsertCache 的 INSERT/UPDATE
      mockPool.query.mockResolvedValue({ rows: [] });

      const usage = await getAccountUsage(true);
      // 应该调用了 fetch（3 个账号）
      expect(mockFetch).toHaveBeenCalledTimes(3);
      // 所有账号都应有数据
      expect(usage.account1).toBeDefined();
      expect(usage.account2).toBeDefined();
      expect(usage.account3).toBeDefined();
    });

    it('API 失败时应回退到过期缓存', async () => {
      const staleRow = {
        account_id: 'account1',
        five_hour_pct: 10,
        seven_day_pct: 5,
        seven_day_sonnet_pct: 3,
        resets_at: null,
        seven_day_resets_at: null,
        extra_used: false,
      };

      // readFileSync 返回有效凭据但 fetch 失败
      setupValidCredentials();
      mockFetch.mockRejectedValue(new Error('network error'));

      // getCached 返回空（缓存过期），getStaleCached 返回过期数据
      mockPool.query.mockImplementation(async (sql) => {
        if (sql.includes('INTERVAL')) {
          return { rows: [] }; // 缓存过期
        }
        if (sql.includes('account_usage_cache') && sql.includes('SELECT') && !sql.includes('INTERVAL')) {
          return { rows: [staleRow] }; // 过期缓存
        }
        return { rows: [] };
      });

      const usage = await getAccountUsage();
      expect(usage.account1).toEqual(staleRow);
    });

    it('API 失败且无过期缓存时应返回默认零值', async () => {
      setupValidCredentials();
      mockFetch.mockRejectedValue(new Error('network error'));
      mockPool.query.mockResolvedValue({ rows: [] }); // 无缓存

      const usage = await getAccountUsage();
      expect(usage.account1).toEqual({
        account_id: 'account1',
        five_hour_pct: 0,
        seven_day_pct: 0,
        seven_day_sonnet_pct: 0,
        resets_at: null,
        seven_day_resets_at: null,
        extra_used: false,
      });
    });

    it('凭据缺失时 fetchUsageFromAPI 返回 null', async () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error('file not found');
      });
      mockPool.query.mockResolvedValue({ rows: [] });

      const usage = await getAccountUsage(true);
      // 应回退到默认值（no token → null → stale/default）
      expect(usage.account1.five_hour_pct).toBe(0);
    });

    it('API 返回非 ok 状态时应回退', async () => {
      setupValidCredentials();
      mockFetch.mockResolvedValue({ ok: false, status: 429 });
      mockPool.query.mockResolvedValue({ rows: [] });

      const usage = await getAccountUsage(true);
      expect(usage.account1.five_hour_pct).toBe(0);
    });

    it('API 数据成功时应 upsert 缓存', async () => {
      setupValidCredentials();
      setupFetchUsage();
      mockPool.query.mockResolvedValue({ rows: [] });

      await getAccountUsage(true);

      // 应有 INSERT 调用（每个账号一次 upsertCache）
      const insertCalls = mockPool.query.mock.calls.filter(
        c => c[0].includes('INSERT INTO account_usage_cache')
      );
      expect(insertCalls.length).toBe(3);
    });

    it('credentails 缺少 accessToken 时返回 null', async () => {
      mockReadFileSync.mockReturnValue(JSON.stringify({ claudeAiOauth: {} }));
      mockPool.query.mockResolvedValue({ rows: [] });

      const usage = await getAccountUsage(true);
      expect(usage.account1.five_hour_pct).toBe(0);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // selectBestAccount（三阶段降级链）
  // ════════════════════════════════════════════════════════════════════════════

  describe('selectBestAccount', () => {
    // 辅助：让 getAccountUsage 返回指定数据
    function setupUsageData(usageMap) {
      // 走缓存路径（INTERVAL 查询）
      mockPool.query.mockImplementation(async (sql, params) => {
        if (sql.includes('INTERVAL') && params) {
          const accountId = params[0];
          if (usageMap[accountId]) {
            return { rows: [usageMap[accountId]] };
          }
        }
        return { rows: [] };
      });
    }

    describe('Sonnet 阶段（默认模式）', () => {
      it('应选用量最低的账号（Sonnet 模式）', async () => {
        setupUsageData({
          account1: { five_hour_pct: 50, seven_day_pct: 30, seven_day_sonnet_pct: 40, resets_at: null, extra_used: false },
          account2: { five_hour_pct: 20, seven_day_pct: 10, seven_day_sonnet_pct: 10, resets_at: null, extra_used: false },
          account3: { five_hour_pct: 70, seven_day_pct: 50, seven_day_sonnet_pct: 60, resets_at: null, extra_used: false },
        });

        const result = await selectBestAccount();
        expect(result).toEqual({ accountId: 'account2', model: 'sonnet' });
      });

      it('5h 用量超过 80% 的账号应被排除', async () => {
        setupUsageData({
          account1: { five_hour_pct: 90, seven_day_pct: 30, seven_day_sonnet_pct: 40, resets_at: null, extra_used: false },
          account2: { five_hour_pct: 85, seven_day_pct: 10, seven_day_sonnet_pct: 10, resets_at: null, extra_used: false },
          account3: { five_hour_pct: 50, seven_day_pct: 50, seven_day_sonnet_pct: 60, resets_at: null, extra_used: false },
        });

        const result = await selectBestAccount();
        expect(result).toEqual({ accountId: 'account3', model: 'sonnet' });
      });

      it('sonnet 7d 超过 95% 应降级到 Opus', async () => {
        setupUsageData({
          account1: { five_hour_pct: 30, seven_day_pct: 50, seven_day_sonnet_pct: 96, resets_at: null, extra_used: false },
          account2: { five_hour_pct: 20, seven_day_pct: 40, seven_day_sonnet_pct: 97, resets_at: null, extra_used: false },
          account3: { five_hour_pct: 40, seven_day_pct: 60, seven_day_sonnet_pct: 98, resets_at: null, extra_used: false },
        });

        const result = await selectBestAccount();
        expect(result).not.toBeNull();
        expect(result.model).toBe('opus');
      });
    });

    describe('Opus 阶段', () => {
      it('Sonnet 全满时应选 Opus（7d 最低的账号）', async () => {
        setupUsageData({
          account1: { five_hour_pct: 30, seven_day_pct: 80, seven_day_sonnet_pct: 96, resets_at: null, extra_used: false },
          account2: { five_hour_pct: 20, seven_day_pct: 30, seven_day_sonnet_pct: 97, resets_at: null, extra_used: false },
          account3: { five_hour_pct: 40, seven_day_pct: 50, seven_day_sonnet_pct: 98, resets_at: null, extra_used: false },
        });

        const result = await selectBestAccount();
        expect(result).toEqual({ accountId: 'account2', model: 'opus' });
      });

      it('7d 超过 95% 应降级到 Haiku', async () => {
        setupUsageData({
          account1: { five_hour_pct: 30, seven_day_pct: 96, seven_day_sonnet_pct: 96, resets_at: null, extra_used: false },
          account2: { five_hour_pct: 20, seven_day_pct: 97, seven_day_sonnet_pct: 97, resets_at: null, extra_used: false },
          account3: { five_hour_pct: 40, seven_day_pct: 98, seven_day_sonnet_pct: 98, resets_at: null, extra_used: false },
        });

        const result = await selectBestAccount();
        expect(result).not.toBeNull();
        expect(result.model).toBe('haiku');
      });
    });

    describe('Haiku 降级阶段', () => {
      it('Sonnet+Opus 全满时应选 Haiku（5h 最低的账号）', async () => {
        setupUsageData({
          account1: { five_hour_pct: 50, seven_day_pct: 96, seven_day_sonnet_pct: 96, resets_at: null, extra_used: false },
          account2: { five_hour_pct: 30, seven_day_pct: 97, seven_day_sonnet_pct: 97, resets_at: null, extra_used: false },
          account3: { five_hour_pct: 70, seven_day_pct: 98, seven_day_sonnet_pct: 98, resets_at: null, extra_used: false },
        });

        const result = await selectBestAccount();
        expect(result).toEqual({ accountId: 'account2', model: 'haiku' });
      });
    });

    describe('MiniMax 兜底', () => {
      it('所有账号 5h 都超过阈值应返回 null', async () => {
        setupUsageData({
          account1: { five_hour_pct: 90, seven_day_pct: 96, seven_day_sonnet_pct: 96, resets_at: null, extra_used: false },
          account2: { five_hour_pct: 85, seven_day_pct: 97, seven_day_sonnet_pct: 97, resets_at: null, extra_used: false },
          account3: { five_hour_pct: 95, seven_day_pct: 98, seven_day_sonnet_pct: 98, resets_at: null, extra_used: false },
        });

        const result = await selectBestAccount();
        expect(result).toBeNull();
      });

      it('所有账号都 spending capped 应返回 null', async () => {
        const futureTime = new Date(Date.now() + 7200000).toISOString();
        markSpendingCap('account1', futureTime);
        markSpendingCap('account2', futureTime);
        markSpendingCap('account3', futureTime);

        setupUsageData({
          account1: { five_hour_pct: 10, seven_day_pct: 10, seven_day_sonnet_pct: 10, resets_at: null, extra_used: false },
          account2: { five_hour_pct: 10, seven_day_pct: 10, seven_day_sonnet_pct: 10, resets_at: null, extra_used: false },
          account3: { five_hour_pct: 10, seven_day_pct: 10, seven_day_sonnet_pct: 10, resets_at: null, extra_used: false },
        });

        const result = await selectBestAccount();
        expect(result).toBeNull();
      });
    });

    describe('Spending Cap 过滤', () => {
      it('被 capped 的账号应跳过，选下一个', async () => {
        const futureTime = new Date(Date.now() + 7200000).toISOString();
        markSpendingCap('account2', futureTime);

        setupUsageData({
          account1: { five_hour_pct: 50, seven_day_pct: 30, seven_day_sonnet_pct: 40, resets_at: null, extra_used: false },
          account2: { five_hour_pct: 10, seven_day_pct: 5, seven_day_sonnet_pct: 5, resets_at: null, extra_used: false },
          account3: { five_hour_pct: 60, seven_day_pct: 40, seven_day_sonnet_pct: 50, resets_at: null, extra_used: false },
        });

        const result = await selectBestAccount();
        expect(result.accountId).not.toBe('account2');
      });
    });

    describe('extra_used 过滤', () => {
      it('Sonnet 阶段 extra_used=true 的账号应被排除', async () => {
        setupUsageData({
          account1: { five_hour_pct: 10, seven_day_pct: 10, seven_day_sonnet_pct: 10, resets_at: null, extra_used: true },
          account2: { five_hour_pct: 50, seven_day_pct: 30, seven_day_sonnet_pct: 30, resets_at: null, extra_used: false },
          account3: { five_hour_pct: 60, seven_day_pct: 40, seven_day_sonnet_pct: 40, resets_at: null, extra_used: true },
        });

        const result = await selectBestAccount();
        expect(result.accountId).toBe('account2');
      });

      it('Opus 阶段不过滤 extra_used', async () => {
        // Sonnet 全满 → 进入 Opus 阶段
        // Opus 阶段 filter 不含 extraUsed
        setupUsageData({
          account1: { five_hour_pct: 30, seven_day_pct: 40, seven_day_sonnet_pct: 96, resets_at: null, extra_used: true },
          account2: { five_hour_pct: 20, seven_day_pct: 30, seven_day_sonnet_pct: 97, resets_at: null, extra_used: true },
          account3: { five_hour_pct: 40, seven_day_pct: 50, seven_day_sonnet_pct: 98, resets_at: null, extra_used: true },
        });

        const result = await selectBestAccount();
        // 虽然 extra_used=true，但 Opus 阶段不过滤 extra_used
        expect(result).not.toBeNull();
        expect(result.model).toBe('opus');
        expect(result.accountId).toBe('account2');
      });
    });

    describe('即将重置优先（effectivePct）', () => {
      it('即将在 30 分钟内重置的账号应被优先选择', async () => {
        const soonReset = new Date(Date.now() + 10 * 60000).toISOString(); // 10 分钟后重置

        setupUsageData({
          account1: { five_hour_pct: 70, seven_day_pct: 30, seven_day_sonnet_pct: 40, resets_at: soonReset, extra_used: false },
          account2: { five_hour_pct: 40, seven_day_pct: 10, seven_day_sonnet_pct: 10, resets_at: null, extra_used: false },
          account3: { five_hour_pct: 60, seven_day_pct: 50, seven_day_sonnet_pct: 60, resets_at: null, extra_used: false },
        });

        const result = await selectBestAccount();
        // account1 虽然 5h=70%，但 effectivePct=0（即将重置），sonnet7d=40 是次排序
        // account2 的 sonnet7d=10 最低，Sonnet 首先按 sonnet7d 排序
        // 所以 account2 应被选中（sonnet7d=10 < account1 sonnet7d=40）
        expect(result.accountId).toBe('account2');
      });

      it('即将重置的账号在同 sonnet7d 时应排前面', async () => {
        const soonReset = new Date(Date.now() + 10 * 60000).toISOString();

        setupUsageData({
          account1: { five_hour_pct: 70, seven_day_pct: 30, seven_day_sonnet_pct: 40, resets_at: soonReset, extra_used: false },
          account2: { five_hour_pct: 50, seven_day_pct: 30, seven_day_sonnet_pct: 40, resets_at: null, extra_used: false },
          account3: { five_hour_pct: 79, seven_day_pct: 90, seven_day_sonnet_pct: 90, resets_at: null, extra_used: false },
        });

        const result = await selectBestAccount();
        // account1: sonnet7d=40, ePct=0（即将重置）
        // account2: sonnet7d=40, ePct=50
        // 同 sonnet7d 时按 ePct 排序，account1 ePct=0 排前面
        expect(result.accountId).toBe('account1');
      });
    });

    describe('Haiku 独立模式', () => {
      it('model=haiku 应走独立模式（只看 5h）', async () => {
        setupUsageData({
          account1: { five_hour_pct: 30, seven_day_pct: 96, seven_day_sonnet_pct: 96, resets_at: null, extra_used: false },
          account2: { five_hour_pct: 50, seven_day_pct: 97, seven_day_sonnet_pct: 97, resets_at: null, extra_used: false },
          account3: { five_hour_pct: 70, seven_day_pct: 98, seven_day_sonnet_pct: 98, resets_at: null, extra_used: false },
        });

        const result = await selectBestAccount({ model: 'haiku' });
        expect(result).toEqual({ accountId: 'account1', model: 'haiku' });
      });

      it('Haiku 独立模式应排除 extra_used 的账号', async () => {
        setupUsageData({
          account1: { five_hour_pct: 10, seven_day_pct: 10, seven_day_sonnet_pct: 10, resets_at: null, extra_used: true },
          account2: { five_hour_pct: 50, seven_day_pct: 10, seven_day_sonnet_pct: 10, resets_at: null, extra_used: false },
          account3: { five_hour_pct: 60, seven_day_pct: 10, seven_day_sonnet_pct: 10, resets_at: null, extra_used: true },
        });

        const result = await selectBestAccount({ model: 'haiku' });
        expect(result.accountId).toBe('account2');
      });

      it('Haiku 独立模式下所有账号不可用应返回 null', async () => {
        setupUsageData({
          account1: { five_hour_pct: 90, seven_day_pct: 10, seven_day_sonnet_pct: 10, resets_at: null, extra_used: false },
          account2: { five_hour_pct: 85, seven_day_pct: 10, seven_day_sonnet_pct: 10, resets_at: null, extra_used: false },
          account3: { five_hour_pct: 95, seven_day_pct: 10, seven_day_sonnet_pct: 10, resets_at: null, extra_used: false },
        });

        const result = await selectBestAccount({ model: 'haiku' });
        expect(result).toBeNull();
      });

      it('Haiku 独立模式应排除 spending capped 的账号', async () => {
        const futureTime = new Date(Date.now() + 7200000).toISOString();
        markSpendingCap('account1', futureTime);

        setupUsageData({
          account1: { five_hour_pct: 10, seven_day_pct: 10, seven_day_sonnet_pct: 10, resets_at: null, extra_used: false },
          account2: { five_hour_pct: 50, seven_day_pct: 10, seven_day_sonnet_pct: 10, resets_at: null, extra_used: false },
          account3: { five_hour_pct: 60, seven_day_pct: 10, seven_day_sonnet_pct: 10, resets_at: null, extra_used: false },
        });

        const result = await selectBestAccount({ model: 'haiku' });
        expect(result.accountId).not.toBe('account1');
      });
    });

    describe('异常处理', () => {
      it('getAccountUsage 抛异常时应返回 null', async () => {
        mockPool.query.mockRejectedValue(new Error('DB catastrophe'));
        // readFileSync 也会失败
        mockReadFileSync.mockImplementation(() => { throw new Error('fs fail'); });

        const result = await selectBestAccount();
        expect(result).toBeNull();
      });
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // selectBestAccountForHaiku（兼容别名）
  // ════════════════════════════════════════════════════════════════════════════

  describe('selectBestAccountForHaiku', () => {
    it('应返回 accountId 字符串（而非对象）', async () => {
      setupUsageData({
        account1: { five_hour_pct: 30, seven_day_pct: 10, seven_day_sonnet_pct: 10, resets_at: null, extra_used: false },
        account2: { five_hour_pct: 50, seven_day_pct: 20, seven_day_sonnet_pct: 20, resets_at: null, extra_used: false },
        account3: { five_hour_pct: 70, seven_day_pct: 30, seven_day_sonnet_pct: 30, resets_at: null, extra_used: false },
      });

      const result = await selectBestAccountForHaiku();
      expect(typeof result).toBe('string');
      expect(result).toBe('account1');
    });

    it('所有账号不可用时应返回 null', async () => {
      setupUsageData({
        account1: { five_hour_pct: 90, seven_day_pct: 10, seven_day_sonnet_pct: 10, resets_at: null, extra_used: false },
        account2: { five_hour_pct: 85, seven_day_pct: 10, seven_day_sonnet_pct: 10, resets_at: null, extra_used: false },
        account3: { five_hour_pct: 95, seven_day_pct: 10, seven_day_sonnet_pct: 10, resets_at: null, extra_used: false },
      });

      const result = await selectBestAccountForHaiku();
      expect(result).toBeNull();
    });

    // 辅助函数（在这个 describe 块中也可用）
    function setupUsageData(usageMap) {
      mockPool.query.mockImplementation(async (sql, params) => {
        if (sql.includes('INTERVAL') && params) {
          const accountId = params[0];
          if (usageMap[accountId]) {
            return { rows: [usageMap[accountId]] };
          }
        }
        return { rows: [] };
      });
    }
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 边界条件
  // ════════════════════════════════════════════════════════════════════════════

  describe('边界条件', () => {
    function setupUsageData(usageMap) {
      mockPool.query.mockImplementation(async (sql, params) => {
        if (sql.includes('INTERVAL') && params) {
          const accountId = params[0];
          if (usageMap[accountId]) {
            return { rows: [usageMap[accountId]] };
          }
        }
        return { rows: [] };
      });
    }

    it('所有用量数据为 undefined/null 时应安全处理', async () => {
      setupUsageData({
        account1: {},
        account2: {},
        account3: {},
      });

      const result = await selectBestAccount();
      // 所有 pct 默认 0 → 应该选到 Sonnet
      expect(result).not.toBeNull();
      expect(result.model).toBe('sonnet');
    });

    it('5h 用量刚好等于 80% 时应被排除（严格小于 80 才通过）', async () => {
      setupUsageData({
        account1: { five_hour_pct: 80, seven_day_pct: 30, seven_day_sonnet_pct: 30, resets_at: null, extra_used: false },
        account2: { five_hour_pct: 90, seven_day_pct: 20, seven_day_sonnet_pct: 20, resets_at: null, extra_used: false },
        account3: { five_hour_pct: 90, seven_day_pct: 20, seven_day_sonnet_pct: 20, resets_at: null, extra_used: false },
      });

      const result = await selectBestAccount();
      // pct < 80 是条件，80 不满足 → 所有账号全被排除 → null
      expect(result).toBeNull();
    });

    it('5h 用量 79% 时应通过阈值检查', async () => {
      setupUsageData({
        account1: { five_hour_pct: 79, seven_day_pct: 30, seven_day_sonnet_pct: 30, resets_at: null, extra_used: false },
        account2: { five_hour_pct: 90, seven_day_pct: 20, seven_day_sonnet_pct: 20, resets_at: null, extra_used: false },
        account3: { five_hour_pct: 90, seven_day_pct: 20, seven_day_sonnet_pct: 20, resets_at: null, extra_used: false },
      });

      const result = await selectBestAccount();
      expect(result).not.toBeNull();
      expect(result.accountId).toBe('account1');
    });

    it('sonnet 7d 刚好等于 95% 时不应通过 Sonnet 阶段', async () => {
      setupUsageData({
        account1: { five_hour_pct: 30, seven_day_pct: 30, seven_day_sonnet_pct: 95, resets_at: null, extra_used: false },
        account2: { five_hour_pct: 20, seven_day_pct: 20, seven_day_sonnet_pct: 95, resets_at: null, extra_used: false },
        account3: { five_hour_pct: 40, seven_day_pct: 40, seven_day_sonnet_pct: 95, resets_at: null, extra_used: false },
      });

      const result = await selectBestAccount();
      // sonnet 7d=95 不满足 < 95，所以进入 Opus 阶段
      expect(result.model).toBe('opus');
    });

    it('只有一个账号可用时应选该账号', async () => {
      const futureTime = new Date(Date.now() + 7200000).toISOString();
      markSpendingCap('account1', futureTime);
      markSpendingCap('account3', futureTime);

      setupUsageData({
        account1: { five_hour_pct: 10, seven_day_pct: 10, seven_day_sonnet_pct: 10, resets_at: null, extra_used: false },
        account2: { five_hour_pct: 50, seven_day_pct: 30, seven_day_sonnet_pct: 30, resets_at: null, extra_used: false },
        account3: { five_hour_pct: 10, seven_day_pct: 10, seven_day_sonnet_pct: 10, resets_at: null, extra_used: false },
      });

      const result = await selectBestAccount();
      expect(result.accountId).toBe('account2');
    });

    it('accessToken 过期时应仍返回 token（仅 warn）', async () => {
      // token 过期但仍可读取
      mockReadFileSync.mockReturnValue(JSON.stringify({
        claudeAiOauth: {
          accessToken: 'expired-token',
          expiresAt: Date.now() - 1000, // 过期
        },
      }));
      setupFetchUsage();
      mockPool.query.mockResolvedValue({ rows: [] });

      const usage = await getAccountUsage(true);
      // 虽然 token 过期（warn），但仍会用它调用 API
      expect(mockFetch).toHaveBeenCalled();
    });
  });
});
