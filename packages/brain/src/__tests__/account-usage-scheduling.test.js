/**
 * account-usage-scheduling.test.js
 *
 * 测试 selectBestAccount() 的 reset-aware 调度逻辑
 *
 * DoD 映射：
 * - S1 → '30min 内重置账号 effectivePct=0，优先选择'
 * - S2 → '实际用量 >= 80% 的账号被过滤，即使即将重置'
 * - S3 → '无即将重置账号时，按实际用量升序选择'
 * - S4 → '所有账号满载时返回 null'
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';

// 生成 N 分钟后的 ISO 时间字符串
function minutesFromNow(n) {
  return new Date(Date.now() + n * 60 * 1000).toISOString();
}

// Mock db.js 在模块级别（vitest 会 hoist 这个 mock）
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
  }
}));

// 构建 DB 查询结果行
function makeRow(accountId, fivePct, resetsInMin, sevenDayPct = 0) {
  return {
    account_id: accountId,
    five_hour_pct: fivePct,
    seven_day_pct: sevenDayPct,
    resets_at: minutesFromNow(resetsInMin),
    extra_used: false,
    fetched_at: new Date(),
  };
}

// 设置 pool.query mock 返回特定账号数据（按 account_id 过滤）
async function setupMockUsage(rows) {
  const { default: pool } = await import('../db.js');
  pool.query.mockReset();
  pool.query.mockImplementation((sql, params) => {
    if (typeof sql === 'string' && sql.includes('account_usage_cache')) {
      // getCached/getStaleCached 传 [accountId] 作为第二个参数
      if (params && params[0]) {
        const matching = rows.filter(r => r.account_id === params[0]);
        return Promise.resolve({ rows: matching });
      }
      return Promise.resolve({ rows });
    }
    return Promise.resolve({ rows: [] });
  });
}

describe('S: selectBestAccount reset-aware 调度', () => {
  // ============================================================
  // S1: 30min 内重置账号应被优先选择（effectivePct=0）
  // ============================================================
  it('S1: 即将重置账号（30min内）effectivePct=0，优先于低用量账号', async () => {
    // account1: 70%, 重置在 20min 后 → effectivePct=0 → 应被选中
    // account2: 5%,  重置在 3h 后   → effectivePct=5  → 次选
    // account3: 40%, 重置在 2h 后   → effectivePct=40 → 末选
    await setupMockUsage([
      makeRow('account1', 70, 20),
      makeRow('account2', 5, 180),
      makeRow('account3', 40, 120),
    ]);

    const { selectBestAccount } = await import('../account-usage.js');
    const result = await selectBestAccount();
    expect(result).toBe('account1');
  });

  // ============================================================
  // S2: 即将重置但实际用量 >= 80% 的账号仍应被过滤
  // ============================================================
  it('S2: 实际用量 >= 80% 账号被过滤，即使即将重置', async () => {
    // account1: 90%, 重置在 5min 后  → 实际超阈值 → 被过滤
    // account2: 20%, 重置在 2h 后   → effectivePct=20 → 应被选中
    // account3: 85%, 重置在 3h 后   → 实际超阈值 → 被过滤
    await setupMockUsage([
      makeRow('account1', 90, 5),
      makeRow('account2', 20, 120),
      makeRow('account3', 85, 180),
    ]);

    const { selectBestAccount } = await import('../account-usage.js');
    const result = await selectBestAccount();
    expect(result).toBe('account2');
  });

  // ============================================================
  // S3: 无即将重置账号，按实际用量升序
  // ============================================================
  it('S3: 无即将重置账号，按实际用量升序选择', async () => {
    // account1: 30%, account2: 5%, account3: 60%，全部 resets > 30min
    // 应选 account2（最低 5%）
    await setupMockUsage([
      makeRow('account1', 30, 180),
      makeRow('account2', 5, 120),
      makeRow('account3', 60, 240),
    ]);

    const { selectBestAccount } = await import('../account-usage.js');
    const result = await selectBestAccount();
    expect(result).toBe('account2');
  });

  // ============================================================
  // S4: 所有账号满载（>= 80%）返回 null
  // ============================================================
  it('S4: 所有账号满载时返回 null', async () => {
    await setupMockUsage([
      makeRow('account1', 82, 60),
      makeRow('account2', 95, 90),
      makeRow('account3', 88, 45),
    ]);

    const { selectBestAccount } = await import('../account-usage.js');
    const result = await selectBestAccount();
    expect(result).toBeNull();
  });

  // ============================================================
  // S5: 5h ePct 相同时，按 seven_day_pct 升序（周用量低的优先）
  // ============================================================
  it('S5: 5h 用量相同时，按 seven_day_pct 升序选择（account3 优先于 account2）', async () => {
    // account1: 55%, 重置在 2h 后  → effectivePct=55 → 末选
    // account2: 0%,  重置在 2h 后  → effectivePct=0, seven_day_pct=37 → 次选
    // account3: 0%,  重置在 2h 后  → effectivePct=0, seven_day_pct=0  → 应被选中（7d 最低）
    await setupMockUsage([
      makeRow('account1', 55, 120, 53),
      makeRow('account2', 0, 120, 37),
      makeRow('account3', 0, 120, 0),
    ]);

    const { selectBestAccount } = await import('../account-usage.js');
    const result = await selectBestAccount();
    expect(result).toBe('account3');
  });
});
