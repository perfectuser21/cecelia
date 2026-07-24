import { describe, it, expect, vi, beforeEach } from 'vitest';

// 回归：产能账本 codex 池必须覆盖 t1~t5 全部本机账号（决策 a1c86e2e）。
// 07-21 初稿只抄了旧 dispatch-worker 双号池，漏掉三个满血号。
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => { throw new Error('ENOENT'); }),
}));
vi.mock('../account-usage.js', () => ({
  getAccountUsage: vi.fn().mockResolvedValue({}),
}));
const poolQuery = vi.fn().mockResolvedValue({
  rows: ['team1', 'team2', 'team3', 'team4', 'team5'].map((account_id, index) => ({
    account_id,
    five_hour_pct: index * 10,
    seven_day_pct: index * 12,
  })),
});
vi.mock('../db.js', () => ({
  default: { query: (...args) => poolQuery(...args) },
}));

describe('llm-capacity codex 池', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    poolQuery.mockResolvedValue({
      rows: ['team1', 'team2', 'team3', 'team4', 'team5'].map((account_id, index) => ({
        account_id,
        five_hour_pct: index * 10,
        seven_day_pct: index * 12,
      })),
    });
  });

  it('codex 账本只消费 broker cache exact team1~team5', async () => {
    const { getLlmCapacitySnapshot } = await import('../llm-capacity.js');
    const snapshot = await getLlmCapacitySnapshot({ forceRefresh: true });
    const codex = (snapshot.snapshot ?? snapshot).vendors.codex;
    expect(codex.total_count).toBe(5);
    const names = codex.accounts.map((a) => a.name).sort();
    expect(names).toEqual(['team1', 'team2', 'team3', 'team4', 'team5']);
    expect(poolQuery).toHaveBeenCalledWith(
      expect.stringContaining('account_id = ANY($1::text[])'),
      [['team1', 'team2', 'team3', 'team4', 'team5']],
    );
    expect(codex.accounts.every(account => account.source === 'account_usage_cache')).toBe(true);
  });
});
