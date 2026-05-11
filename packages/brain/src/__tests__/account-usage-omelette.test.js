/**
 * account-usage-omelette.test.js — C1 RED
 *
 * 测试 selectBestAccount Opus 模型跳过 seven_day_omelette_pct >= 95% 账号。
 *
 * C1 阶段：__setAccountUsageForTest seam 尚未在 account-usage.js 实现
 *   → 测试会 RED（SyntaxError / not a function）
 * C3 impl 时需在 account-usage.js export __setAccountUsageForTest seam，
 *   让 getAccountUsage() 内部在测试环境下返回注入的 rows，
 *   并在 selectBestAccount Opus 路径加 omelette >= 95 的过滤逻辑。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock 外部依赖（DB / API / auth）
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../event-bus.js', () => ({ emit: vi.fn(async () => {}) }));
vi.mock('../alerting.js', () => ({ raise: vi.fn(async () => {}) }));
vi.mock('../auth-cache.js', () => ({
  isSpendingCapped: vi.fn(() => false),
  isAuthFailed: vi.fn(() => false),
}));

import { selectBestAccount, __setAccountUsageForTest } from '../account-usage.js';

describe('selectBestAccount — Opus omelette quota skip', () => {
  beforeEach(() => {
    // __setAccountUsageForTest seam: C3 impl 时注入 mock cache rows
    // 格式对应 account_usage_cache 表行（含 seven_day_omelette_pct 新列）
    __setAccountUsageForTest([
      {
        account_id: 'account1',
        five_hour_pct: 10,
        seven_day_pct: 20,
        seven_day_sonnet_pct: 15,
        seven_day_omelette_pct: 96,
        resets_at: null,
        seven_day_resets_at: null,
      },
      {
        account_id: 'account2',
        five_hour_pct: 30,
        seven_day_pct: 25,
        seven_day_sonnet_pct: 18,
        seven_day_omelette_pct: 50,
        resets_at: null,
        seven_day_resets_at: null,
      },
    ]);
  });

  it('skips account with seven_day_omelette_pct >= 95 when model=opus', async () => {
    const pick = await selectBestAccount({ model: 'opus' });
    expect(pick).not.toBeNull();
    expect(pick.accountId).toBe('account2');
  });

  it('does NOT skip on omelette when model=sonnet', async () => {
    const pick = await selectBestAccount({ model: 'sonnet' });
    // account1 has lower five_hour_pct → lower load, would be preferred for sonnet
    expect(pick).not.toBeNull();
    expect(pick.accountId).toBe('account1');
  });

  it('returns null when all accounts capped for opus (omelette >= 95)', async () => {
    __setAccountUsageForTest([
      {
        account_id: 'account1',
        five_hour_pct: 10,
        seven_day_pct: 20,
        seven_day_sonnet_pct: 15,
        seven_day_omelette_pct: 96,
        resets_at: null,
        seven_day_resets_at: null,
      },
      {
        account_id: 'account2',
        five_hour_pct: 10,
        seven_day_pct: 15,
        seven_day_sonnet_pct: 12,
        seven_day_omelette_pct: 99,
        resets_at: null,
        seven_day_resets_at: null,
      },
    ]);
    const pick = await selectBestAccount({ model: 'opus' });
    expect(pick).toBeNull();
  });
});
