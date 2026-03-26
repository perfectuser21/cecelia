/**
 * selectBestAccountFromLocal 单元测试
 * 验证账号排序、降级、maxAccounts 限制
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 内联实现（与 executor.js 保持一致，方便单元测试）
async function selectBestAccountFromLocal(maxAccounts = 3, { readAuth, fetchUsage } = {}) {
  const teams = ['team1', 'team2', 'team3', 'team4', 'team5'];
  const results = await Promise.all(teams.map(async (id) => {
    try {
      const auth = readAuth(id);
      if (!auth?.tokens?.access_token) return null;

      const data = await fetchUsage(id, auth.tokens.access_token, auth.tokens.account_id);
      if (!data) return null;
      const usedPct = data.rate_limit?.primary_window?.used_percent ?? 100;
      return { id, auth, usedPct };
    } catch {
      return null;
    }
  }));

  return results
    .filter(Boolean)
    .sort((a, b) => a.usedPct - b.usedPct)
    .slice(0, maxAccounts)
    .map(({ id, auth }) => ({ id, auth }));
}

describe('selectBestAccountFromLocal', () => {
  it('按 5h used_percent 升序排序', async () => {
    const mockAuth = (id) => ({ tokens: { access_token: 'tok', account_id: 'org' }, id });
    const usageMap = { team1: 80, team2: 10, team3: 50, team4: 20, team5: 90 };
    const fetchUsage = async (id) => ({
      rate_limit: { primary_window: { used_percent: usageMap[id] } },
    });

    const result = await selectBestAccountFromLocal(3, { readAuth: mockAuth, fetchUsage });

    expect(result.map(a => a.id)).toEqual(['team2', 'team4', 'team3']);
  });

  it('wham/usage 失败时跳过该账号', async () => {
    const mockAuth = (id) => ({ tokens: { access_token: 'tok', account_id: 'org' } });
    const fetchUsage = async (id) => {
      if (id === 'team1' || id === 'team2') return null; // 模拟失败
      return { rate_limit: { primary_window: { used_percent: 50 } } };
    };

    const result = await selectBestAccountFromLocal(5, { readAuth: mockAuth, fetchUsage });

    expect(result.map(a => a.id)).not.toContain('team1');
    expect(result.map(a => a.id)).not.toContain('team2');
    expect(result.length).toBe(3); // team3/4/5 成功
  });

  it('所有账号失败返回空数组', async () => {
    const mockAuth = () => ({ tokens: { access_token: 'tok', account_id: 'org' } });
    const fetchUsage = async () => null;

    const result = await selectBestAccountFromLocal(3, { readAuth: mockAuth, fetchUsage });
    expect(result).toEqual([]);
  });

  it('maxAccounts 限制返回数量', async () => {
    const mockAuth = () => ({ tokens: { access_token: 'tok', account_id: 'org' } });
    const fetchUsage = async () => ({ rate_limit: { primary_window: { used_percent: 10 } } });

    const result = await selectBestAccountFromLocal(2, { readAuth: mockAuth, fetchUsage });
    expect(result.length).toBe(2);
  });

  it('auth.json 无 access_token 时跳过', async () => {
    const mockAuth = (id) => id === 'team1' ? { tokens: {} } : { tokens: { access_token: 'tok', account_id: 'org' } };
    const fetchUsage = async () => ({ rate_limit: { primary_window: { used_percent: 10 } } });

    const result = await selectBestAccountFromLocal(5, { readAuth: mockAuth, fetchUsage });
    expect(result.map(a => a.id)).not.toContain('team1');
  });
});
