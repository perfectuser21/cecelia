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

  // 本文件 mock 了 fs，db 模块导入必然失败 —— 也就是「配额账本装载器起不来」的真现场。
  // 2026-09-22 加：此时绝不能把 codex 判成 0 可用。旧实现正是在这种"读不到"的情况下
  // 一律 available:false，导致生产 7 天 61 次派单 61 次全落 claude、5 个 codex 号一次没用。
  // 「读不到配额」必须落到 unknown 弃权，不是否定事实。
  it('账本装载器起不来时 codex 不许被判成 0 可用（弃权，不是判死）', async () => {
    const { getLlmCapacitySnapshot, clearLlmCapacityCache } = await import('../llm-capacity.js');
    clearLlmCapacityCache();
    const snapshot = await getLlmCapacitySnapshot({ forceRefresh: true });
    const codex = (snapshot.snapshot ?? snapshot).vendors.codex;
    expect(codex.available_count, '读不到账本就把 5 个号全判死 —— 正是本次要修的塌陷').toBe(5);
    expect(codex.poller, '降级没留痕').toBe('error');
  });
});
