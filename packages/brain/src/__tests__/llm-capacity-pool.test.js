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

describe('llm-capacity codex 池', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('codex 账本 total_count=5（team1~team5 全在本机）', async () => {
    const { getLlmCapacitySnapshot } = await import('../llm-capacity.js');
    const snapshot = await getLlmCapacitySnapshot({ force: true });
    const codex = (snapshot.snapshot ?? snapshot).vendors.codex;
    expect(codex.total_count).toBe(5);
    const names = codex.accounts.map((a) => a.name).sort();
    expect(names).toEqual(['team1', 'team2', 'team3', 'team4', 'team5']);
  });
});
