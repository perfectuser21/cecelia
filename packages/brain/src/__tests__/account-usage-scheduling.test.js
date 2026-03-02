/**
 * account-usage-scheduling.test.js
 *
 * 测试 selectBestAccount() 的三阶段降级链 + Spending Cap 标记逻辑
 *
 * DoD 映射：
 * - S1 → '30min 内重置账号 effectivePct=0，优先选择'
 * - S2 → '实际用量 >= 80% 的账号被过滤，即使即将重置'
 * - S3 → '无即将重置账号时，按实际用量升序选择'
 * - S4 → '所有账号满载时返回 null'
 * - S5 → '5h ePct 相同时，按 seven_day_pct 升序'
 * - SC1 → 'spending cap 账号被跳过，其他账号可用'
 * - SC2 → '所有账号 spending-capped 时返回 null'
 * - M1 → 'Sonnet 7d 全满时升级 Opus'
 * - M2 → 'Sonnet+Opus 全满时降级 Haiku'
 * - M3 → 'Sonnet 可用时返回 model=sonnet'
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

function minutesFromNow(n) {
  return new Date(Date.now() + n * 60 * 1000).toISOString();
}

vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
  }
}));

function makeRow(accountId, fivePct, resetsInMin, sevenDayPct = 0, sevenDaySonnetPct = 0, extraUsed = false) {
  return {
    account_id: accountId,
    five_hour_pct: fivePct,
    seven_day_pct: sevenDayPct,
    seven_day_sonnet_pct: sevenDaySonnetPct,
    resets_at: minutesFromNow(resetsInMin),
    seven_day_resets_at: minutesFromNow(resetsInMin * 7),
    extra_used: extraUsed,
    fetched_at: new Date(),
  };
}

async function setupMockUsage(rows) {
  const { default: pool } = await import('../db.js');
  pool.query.mockReset();
  pool.query.mockImplementation((sql, params) => {
    if (typeof sql === 'string' && sql.includes('account_usage_cache')) {
      if (params && params[0]) {
        const matching = rows.filter(r => r.account_id === params[0]);
        return Promise.resolve({ rows: matching });
      }
      return Promise.resolve({ rows });
    }
    return Promise.resolve({ rows: [] });
  });
}

// 清除 spending cap 状态（测试隔离）
async function clearAllSpendingCaps() {
  const { isSpendingCapped } = await import('../account-usage.js');
  // 通过标记一个已过期时间来清除
  const mod = await import('../account-usage.js');
  // 直接设置过期时间清除
  const pastTime = new Date(Date.now() - 1000).toISOString();
  ['account1', 'account2', 'account3'].forEach(id => {
    // 如果有 spending cap，通过标记过期来清除
    if (mod.isSpendingCapped(id)) {
      mod.markSpendingCap(id, pastTime);
      // 再次调用 isSpendingCapped 触发自动清除
      mod.isSpendingCapped(id);
    }
  });
}

describe('S: selectBestAccount reset-aware 调度', () => {
  beforeEach(async () => {
    await clearAllSpendingCaps();
    // 重置 vitest 模块缓存以清除 spending cap 状态
    vi.resetModules();
  });

  // ============================================================
  // S1: 30min 内重置账号应被优先选择（effectivePct=0）
  // ============================================================
  it('S1: 即将重置账号（30min内）effectivePct=0，优先于低用量账号', async () => {
    vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
    const { default: pool } = await import('../db.js');
    pool.query.mockReset();
    pool.query.mockImplementation((sql, params) => {
      const rows = [
        makeRow('account1', 70, 20),   // effectivePct=0（即将重置）
        makeRow('account2', 5, 180),   // effectivePct=5
        makeRow('account3', 40, 120),  // effectivePct=40
      ];
      if (typeof sql === 'string' && sql.includes('account_usage_cache') && params?.[0]) {
        return Promise.resolve({ rows: rows.filter(r => r.account_id === params[0]) });
      }
      return Promise.resolve({ rows: [] });
    });

    const { selectBestAccount } = await import('../account-usage.js');
    const result = await selectBestAccount();
    // Sonnet 阶段，seven_day_sonnet_pct=0 < 100%，selecte account1（即将重置 ePct=0）
    expect(result).not.toBeNull();
    expect(result?.accountId).toBe('account1');
    expect(result?.model).toBe('sonnet');
  });

  // ============================================================
  // S2: 即将重置但实际用量 >= 80% 的账号仍应被过滤
  // ============================================================
  it('S2: 实际用量 >= 80% 账号被过滤，即使即将重置', async () => {
    vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
    const { default: pool } = await import('../db.js');
    pool.query.mockReset();
    pool.query.mockImplementation((sql, params) => {
      const rows = [
        makeRow('account1', 90, 5),    // 超过阈值，被过滤
        makeRow('account2', 20, 120),  // 可用
        makeRow('account3', 85, 180),  // 超过阈值，被过滤
      ];
      if (typeof sql === 'string' && sql.includes('account_usage_cache') && params?.[0]) {
        return Promise.resolve({ rows: rows.filter(r => r.account_id === params[0]) });
      }
      return Promise.resolve({ rows: [] });
    });

    const { selectBestAccount } = await import('../account-usage.js');
    const result = await selectBestAccount();
    expect(result?.accountId).toBe('account2');
    expect(result?.model).toBe('sonnet');
  });

  // ============================================================
  // S3: 无即将重置账号，按 sonnet 7d 升序选择
  // ============================================================
  it('S3: 无即将重置账号，按 seven_day_sonnet_pct 升序选择', async () => {
    vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
    const { default: pool } = await import('../db.js');
    pool.query.mockReset();
    pool.query.mockImplementation((sql, params) => {
      const rows = [
        makeRow('account1', 30, 180, 50, 40),  // sonnet=40%
        makeRow('account2', 20, 120, 30, 10),  // sonnet=10% ← 应选中
        makeRow('account3', 40, 240, 60, 60),  // sonnet=60%
      ];
      if (typeof sql === 'string' && sql.includes('account_usage_cache') && params?.[0]) {
        return Promise.resolve({ rows: rows.filter(r => r.account_id === params[0]) });
      }
      return Promise.resolve({ rows: [] });
    });

    const { selectBestAccount } = await import('../account-usage.js');
    const result = await selectBestAccount();
    expect(result?.accountId).toBe('account2');
    expect(result?.model).toBe('sonnet');
  });

  // ============================================================
  // S4: 所有账号 5h 满载 → Sonnet/Opus/Haiku 全无 → null
  // ============================================================
  it('S4: 所有账号 5h 满载时返回 null', async () => {
    vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
    const { default: pool } = await import('../db.js');
    pool.query.mockReset();
    pool.query.mockImplementation((sql, params) => {
      const rows = [
        makeRow('account1', 82, 60),
        makeRow('account2', 95, 90),
        makeRow('account3', 88, 45),
      ];
      if (typeof sql === 'string' && sql.includes('account_usage_cache') && params?.[0]) {
        return Promise.resolve({ rows: rows.filter(r => r.account_id === params[0]) });
      }
      return Promise.resolve({ rows: [] });
    });

    const { selectBestAccount } = await import('../account-usage.js');
    const result = await selectBestAccount();
    expect(result).toBeNull();
  });

  // ============================================================
  // S5: 5h ePct 相同时，按 seven_day_sonnet_pct 升序
  // ============================================================
  it('S5: 5h ePct 相同时，按 seven_day_sonnet_pct 升序选择', async () => {
    vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
    const { default: pool } = await import('../db.js');
    pool.query.mockReset();
    pool.query.mockImplementation((sql, params) => {
      const rows = [
        makeRow('account1', 0, 120, 53, 50),  // sonnet=50%
        makeRow('account2', 0, 120, 37, 30),  // sonnet=30%
        makeRow('account3', 0, 120, 0,  0),   // sonnet=0% ← 应被选中
      ];
      if (typeof sql === 'string' && sql.includes('account_usage_cache') && params?.[0]) {
        return Promise.resolve({ rows: rows.filter(r => r.account_id === params[0]) });
      }
      return Promise.resolve({ rows: [] });
    });

    const { selectBestAccount } = await import('../account-usage.js');
    const result = await selectBestAccount();
    expect(result?.accountId).toBe('account3');
    expect(result?.model).toBe('sonnet');
  });
});

describe('SC: Spending Cap 账号级标记', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  // ============================================================
  // SC1: spending cap 账号被跳过，选其他可用账号
  // ============================================================
  it('SC1: spending-capped 账号被跳过，选其他可用账号', async () => {
    vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
    const { default: pool } = await import('../db.js');
    pool.query.mockReset();
    pool.query.mockImplementation((sql, params) => {
      const rows = [
        makeRow('account1', 20, 120, 0, 0),
        makeRow('account2', 30, 120, 0, 0),
        makeRow('account3', 10, 120, 0, 0),
      ];
      if (typeof sql === 'string' && sql.includes('account_usage_cache') && params?.[0]) {
        return Promise.resolve({ rows: rows.filter(r => r.account_id === params[0]) });
      }
      return Promise.resolve({ rows: [] });
    });

    const { markSpendingCap, selectBestAccount } = await import('../account-usage.js');
    // account3（本来最优）撞了 spending cap
    markSpendingCap('account3', new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString());

    const result = await selectBestAccount();
    // account3 被过滤，选 account1（sonnet 7d=0 ePct=20，排 account2 前面，ePct 一样取七天 sonnet）
    expect(result?.accountId).not.toBe('account3');
    expect(result?.model).toBe('sonnet');
  });

  // ============================================================
  // SC2: 所有账号 spending-capped → null
  // ============================================================
  it('SC2: 所有账号 spending-capped 时返回 null', async () => {
    vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
    const { default: pool } = await import('../db.js');
    pool.query.mockReset();
    pool.query.mockImplementation((sql, params) => {
      const rows = [
        makeRow('account1', 20, 120),
        makeRow('account2', 30, 120),
        makeRow('account3', 10, 120),
      ];
      if (typeof sql === 'string' && sql.includes('account_usage_cache') && params?.[0]) {
        return Promise.resolve({ rows: rows.filter(r => r.account_id === params[0]) });
      }
      return Promise.resolve({ rows: [] });
    });

    const { markSpendingCap, selectBestAccount } = await import('../account-usage.js');
    const future = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    markSpendingCap('account1', future);
    markSpendingCap('account2', future);
    markSpendingCap('account3', future);

    const result = await selectBestAccount();
    expect(result).toBeNull();
  });
});

describe('M: 三阶段模型降级链', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  // ============================================================
  // M1: 所有账号 Sonnet 7d 满 → 升级 Opus
  // ============================================================
  it('M1: 所有账号 seven_day_sonnet >= 100% → 升级 Opus (model=opus)', async () => {
    vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
    const { default: pool } = await import('../db.js');
    pool.query.mockReset();
    pool.query.mockImplementation((sql, params) => {
      const rows = [
        makeRow('account1', 20, 120, 70, 100),  // sonnet=100% → 全满
        makeRow('account2', 30, 120, 60, 100),  // sonnet=100% → 全满
        makeRow('account3', 10, 120, 50, 100),  // sonnet=100% → 全满，7d=50% < 95% ← Opus 候选
      ];
      if (typeof sql === 'string' && sql.includes('account_usage_cache') && params?.[0]) {
        return Promise.resolve({ rows: rows.filter(r => r.account_id === params[0]) });
      }
      return Promise.resolve({ rows: [] });
    });

    const { selectBestAccount } = await import('../account-usage.js');
    const result = await selectBestAccount();
    expect(result).not.toBeNull();
    expect(result?.model).toBe('opus');
    // account3 seven_day_pct=50%，最低 → 应被选中
    expect(result?.accountId).toBe('account3');
  });

  // ============================================================
  // M2: Sonnet 全满 + Opus 全满 → 降级 Haiku
  // ============================================================
  it('M2: Sonnet 全满 + 所有账号 seven_day >= 95% → 降级 Haiku (model=haiku)', async () => {
    vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
    const { default: pool } = await import('../db.js');
    pool.query.mockReset();
    pool.query.mockImplementation((sql, params) => {
      const rows = [
        makeRow('account1', 20, 120, 96, 100),  // sonnet满 + opus满
        makeRow('account2', 30, 120, 97, 100),  // sonnet满 + opus满
        makeRow('account3', 10, 120, 95, 100),  // sonnet满 + opus满（7d=95 ≥ 95），5h=10% 最低 ← 选
      ];
      if (typeof sql === 'string' && sql.includes('account_usage_cache') && params?.[0]) {
        return Promise.resolve({ rows: rows.filter(r => r.account_id === params[0]) });
      }
      return Promise.resolve({ rows: [] });
    });

    const { selectBestAccount } = await import('../account-usage.js');
    const result = await selectBestAccount();
    expect(result).not.toBeNull();
    expect(result?.model).toBe('haiku');
    expect(result?.accountId).toBe('account3');
  });

  // ============================================================
  // M3: 正常情况返回 model=sonnet
  // ============================================================
  it('M3: 正常情况（Sonnet 未满）返回 model=sonnet', async () => {
    vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
    const { default: pool } = await import('../db.js');
    pool.query.mockReset();
    pool.query.mockImplementation((sql, params) => {
      const rows = [
        makeRow('account1', 20, 120, 30, 40),
        makeRow('account2', 10, 120, 20, 15),  // sonnet 7d 最低 → 选中
        makeRow('account3', 30, 120, 40, 60),
      ];
      if (typeof sql === 'string' && sql.includes('account_usage_cache') && params?.[0]) {
        return Promise.resolve({ rows: rows.filter(r => r.account_id === params[0]) });
      }
      return Promise.resolve({ rows: [] });
    });

    const { selectBestAccount } = await import('../account-usage.js');
    const result = await selectBestAccount();
    expect(result?.model).toBe('sonnet');
    expect(result?.accountId).toBe('account2');
  });
});
