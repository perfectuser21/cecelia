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
 * - SC1 → 'spending-capped 账号被跳过，选未 cap 的最优'
 * - SC2 → '所有账号 spending-capped 时返回 null（降级 MiniMax）'
 * - H1 → 'Haiku 独立模式只看 5h，过滤 spending cap'
 * - H2 → 'Haiku 独立模式返回 { accountId, model: haiku }'
 * - H3 → 'selectBestAccountForHaiku 兼容别名返回 string'
 * - M1 → 'Sonnet 7d 全满时升级 Opus'
 * - M2 → 'Sonnet+Opus 全满时降级 Haiku'
 * - M3 → 'Sonnet 可用时返回 model=sonnet'
 * - P1 → 'markSpendingCap 触发 DB 写入（fire-and-forget）'
 * - P2 → 'isSpendingCapped 过期时触发 DB 清除（fire-and-forget）'
 * - P3 → 'loadSpendingCapsFromDB 恢复未过期记录到内存 Map'
 * - P4 → 'loadSpendingCapsFromDB 忽略已过期记录'
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

describe('SC: Spending Cap 账号级过滤（v1.197.0）', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  // ============================================================
  // SC1: spending-capped 账号被跳过，选未 cap 的最优账号
  // v1.197.0: 恢复 spending cap 过滤，避免同一 capped 账号反复失败触发熔断
  // ============================================================
  it('SC1: spending-capped 账号被跳过，选未 cap 的最优', async () => {
    vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
    const { default: pool } = await import('../db.js');
    pool.query.mockReset();
    pool.query.mockImplementation((sql, params) => {
      const rows = [
        makeRow('account1', 20, 120, 0, 0),
        makeRow('account2', 30, 120, 0, 0),
        makeRow('account3', 10, 120, 0, 0),  // 用量最低但被 cap
      ];
      if (typeof sql === 'string' && sql.includes('account_usage_cache') && params?.[0]) {
        return Promise.resolve({ rows: rows.filter(r => r.account_id === params[0]) });
      }
      return Promise.resolve({ rows: [] });
    });

    const { markSpendingCap, selectBestAccount } = await import('../account-usage.js');
    markSpendingCap('account3', new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString());

    const result = await selectBestAccount();
    // account3 被 cap，跳过 → 选 account1（ePct=20 次低）
    expect(result?.accountId).toBe('account1');
    expect(result?.model).toBe('sonnet');
  });

  // ============================================================
  // SC2: 所有账号 spending-capped → 返回 null（降级 MiniMax）
  // v1.197.0: 三阶段全部过滤 capped 账号，全 cap 时返回 null
  // ============================================================
  it('SC2: 所有账号 spending-capped 时返回 null（降级 MiniMax）', async () => {
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
    // 全部 capped → null → MiniMax 兜底
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
  it('M1: 所有账号 seven_day_sonnet >= 95% → 升级 Opus (model=opus)', async () => {
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
    // 新逻辑：DEFAULT_CASCADE=['sonnet','haiku']，无 Opus
    // Sonnet 全满(100%) → 降级 Haiku；account3 seven_day_pct=50% 最低 → 选中
    expect(result?.model).toBe('haiku');
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

  // ============================================================
  // M4: 所有账号 Sonnet 7d 接近满（95-99%）→ 降级 Opus
  // 复现日志中的实际场景：sonnet 7d = 100%, 100%, 98%
  // ============================================================
  it('M4: 所有账号 seven_day_sonnet 在 95-99% 范围（未达100%）→ 降级 Opus', async () => {
    vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
    const { default: pool } = await import('../db.js');
    pool.query.mockReset();
    pool.query.mockImplementation((sql, params) => {
      const rows = [
        makeRow('account1', 0, 120, 75, 100),  // sonnet=100% >= 95%
        makeRow('account2', 10, 120, 89, 100),  // sonnet=100% >= 95%
        makeRow('account3', 18, 120, 93, 98),   // sonnet=98% >= 95% → 也应排除
      ];
      if (typeof sql === 'string' && sql.includes('account_usage_cache') && params?.[0]) {
        return Promise.resolve({ rows: rows.filter(r => r.account_id === params[0]) });
      }
      return Promise.resolve({ rows: [] });
    });

    const { selectBestAccount } = await import('../account-usage.js');
    const result = await selectBestAccount();
    expect(result).not.toBeNull();
    // 新逻辑：Sonnet 阈值 100%
    // account1 sevenDaySonnetPct=100 → 不可用 Sonnet
    // account2 sevenDaySonnetPct=100 → 不可用 Sonnet
    // account3 sevenDaySonnetPct=98 < 100 → 可用 Sonnet → 唯一候选
    expect(result?.model).toBe('sonnet');
    expect(result?.accountId).toBe('account3');
  });

  // ============================================================
  // M5: Sonnet 7d 刚好在阈值边界（94% < 95%）→ 仍选 Sonnet
  // ============================================================
  it('M5: 有账号 seven_day_sonnet=94%（< 95%阈值）→ 仍走 Sonnet 阶段', async () => {
    vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
    const { default: pool } = await import('../db.js');
    pool.query.mockReset();
    pool.query.mockImplementation((sql, params) => {
      const rows = [
        makeRow('account1', 0, 120, 75, 100),  // sonnet=100% >= 95%
        makeRow('account2', 10, 120, 89, 100),  // sonnet=100% >= 95%
        makeRow('account3', 18, 120, 50, 94),   // sonnet=94% < 95% → Sonnet 候选！
      ];
      if (typeof sql === 'string' && sql.includes('account_usage_cache') && params?.[0]) {
        return Promise.resolve({ rows: rows.filter(r => r.account_id === params[0]) });
      }
      return Promise.resolve({ rows: [] });
    });

    const { selectBestAccount } = await import('../account-usage.js');
    const result = await selectBestAccount();
    expect(result).not.toBeNull();
    expect(result?.model).toBe('sonnet');
    expect(result?.accountId).toBe('account3');
  });
});

// ============================================================
// P: Spending Cap 持久化（DB 读写）
// ============================================================
describe('P: Spending Cap 持久化', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
  });

  it('P1: markSpendingCap 同时写内存 Map 和 DB', async () => {
    const { default: pool } = await import('../db.js');
    pool.query.mockResolvedValue({ rows: [] });

    const { markSpendingCap, isSpendingCapped } = await import('../account-usage.js');
    const resetTime = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    markSpendingCap('account1', resetTime);

    // 内存状态立即更新
    expect(isSpendingCapped('account1')).toBe(true);

    // 等待 fire-and-forget 完成
    await new Promise(r => setTimeout(r, 10));

    // 验证 DB 写入被调用（INSERT/ON CONFLICT）
    const dbCalls = pool.query.mock.calls;
    const capWrite = dbCalls.find(([sql]) =>
      typeof sql === 'string' && sql.includes('is_spending_capped') && sql.includes('INSERT')
    );
    expect(capWrite).toBeDefined();
    expect(capWrite[1]).toContain('account1');
    expect(capWrite[1]).toContain(resetTime);
  });

  it('P2: isSpendingCapped 过期时清除内存并触发 DB 清除', async () => {
    const { default: pool } = await import('../db.js');
    pool.query.mockResolvedValue({ rows: [] });

    const { markSpendingCap, isSpendingCapped } = await import('../account-usage.js');
    // 标记一个已过期时间
    const pastTime = new Date(Date.now() - 1000).toISOString();
    markSpendingCap('account2', pastTime);

    pool.query.mockClear();

    // 调用 isSpendingCapped，应自动清除并触发 DB 清除
    const result = isSpendingCapped('account2');
    expect(result).toBe(false);

    await new Promise(r => setTimeout(r, 10));

    // 验证 DB 清除被调用（UPDATE SET is_spending_capped = false）
    const dbCalls = pool.query.mock.calls;
    const capClear = dbCalls.find(([sql]) =>
      typeof sql === 'string' && sql.includes('is_spending_capped') && sql.includes('UPDATE')
    );
    expect(capClear).toBeDefined();
    expect(capClear[1]).toContain('account2');
  });

  it('P3: loadSpendingCapsFromDB 恢复未过期记录到内存 Map', async () => {
    const { default: pool } = await import('../db.js');
    const futureTime = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    pool.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('is_spending_capped = true')) {
        return Promise.resolve({
          rows: [{ account_id: 'account1', spending_cap_resets_at: futureTime }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const { loadSpendingCapsFromDB, isSpendingCapped } = await import('../account-usage.js');
    await loadSpendingCapsFromDB();

    // 恢复后内存 Map 中 account1 应处于 capped 状态
    expect(isSpendingCapped('account1')).toBe(true);
  });

  it('P4: loadSpendingCapsFromDB 忽略已过期记录（DB 侧 WHERE 过滤）', async () => {
    const { default: pool } = await import('../db.js');
    // DB 只返回 spending_cap_resets_at > NOW() 的记录
    pool.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('is_spending_capped = true')) {
        // 模拟 DB 已过滤：返回空（过期记录被 WHERE 排除）
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const { loadSpendingCapsFromDB, isSpendingCapped } = await import('../account-usage.js');
    await loadSpendingCapsFromDB();

    // 无有效记录，账号不应被 cap
    expect(isSpendingCapped('account1')).toBe(false);
    expect(isSpendingCapped('account2')).toBe(false);
    expect(isSpendingCapped('account3')).toBe(false);
  });
});

// ============================================================
// H: Haiku 独立模式（selectBestAccount({ model: 'haiku' })）
// ============================================================
describe('H: Haiku 独立模式', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('H1: Haiku 模式只看 5h + spending cap，不看 sonnet 7d', async () => {
    vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
    const { default: pool } = await import('../db.js');
    pool.query.mockReset();
    pool.query.mockImplementation((sql, params) => {
      const rows = [
        makeRow('account1', 20, 120, 90, 100),  // sonnet 7d=100%，但 haiku 不管
        makeRow('account2', 10, 120, 95, 100),  // sonnet 7d=100%，5h=10% 最低
        makeRow('account3', 30, 120, 50, 50),
      ];
      if (typeof sql === 'string' && sql.includes('account_usage_cache') && params?.[0]) {
        return Promise.resolve({ rows: rows.filter(r => r.account_id === params[0]) });
      }
      return Promise.resolve({ rows: [] });
    });

    const { markSpendingCap, selectBestAccount } = await import('../account-usage.js');
    // account2 用量最低但被 cap
    markSpendingCap('account2', new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString());

    const result = await selectBestAccount({ model: 'haiku' });
    // 新算法：按 sevenDayDeficit DESC 排序
    // account2 被 cap 跳过 → account3（7d=50%，deficit≈41%）> account1（7d=90%，deficit≈2%）
    expect(result?.accountId).toBe('account3');
    expect(result?.model).toBe('haiku');
  });

  it('H2: Haiku 模式返回 { accountId, model: haiku }', async () => {
    vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
    const { default: pool } = await import('../db.js');
    pool.query.mockReset();
    pool.query.mockImplementation((sql, params) => {
      // account2 使用 resetsInMin=60（比 120 短），elapsedMs 更大 → sevenDayDeficit 更高
      // 确保 account2 在 sevenDayDeficit DESC 排序中排第一，避免相同 deficit 时的 flaky 排序
      const rows = [
        makeRow('account1', 50, 120),
        makeRow('account2', 10, 60),
        makeRow('account3', 30, 120),
      ];
      if (typeof sql === 'string' && sql.includes('account_usage_cache') && params?.[0]) {
        return Promise.resolve({ rows: rows.filter(r => r.account_id === params[0]) });
      }
      return Promise.resolve({ rows: [] });
    });

    const { selectBestAccount } = await import('../account-usage.js');
    const result = await selectBestAccount({ model: 'haiku' });
    expect(result).toEqual({ accountId: 'account2', model: 'haiku', modelId: 'claude-haiku-4-5-20251001' });
  });

  it('H3: selectBestAccountForHaiku 兼容别名返回 string', async () => {
    vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
    const { default: pool } = await import('../db.js');
    pool.query.mockReset();
    pool.query.mockImplementation((sql, params) => {
      const rows = [
        makeRow('account1', 50, 120),
        makeRow('account2', 10, 120),
        makeRow('account3', 30, 120),
      ];
      if (typeof sql === 'string' && sql.includes('account_usage_cache') && params?.[0]) {
        return Promise.resolve({ rows: rows.filter(r => r.account_id === params[0]) });
      }
      return Promise.resolve({ rows: [] });
    });

    const { selectBestAccountForHaiku } = await import('../account-usage.js');
    const result = await selectBestAccountForHaiku();
    // 兼容别名：返回 string（不是对象）
    expect(typeof result).toBe('string');
    expect(result).toBe('account2');
  });
});
