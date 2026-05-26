import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../account-usage.js', () => ({
  selectBestAccount: vi.fn(),
  isSpendingCapped: vi.fn().mockReturnValue(false),
  isAuthFailed: vi.fn().mockReturnValue(false),
  proactiveTokenCheck: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../alerting.js', () => ({
  raise: vi.fn().mockResolvedValue(undefined),
}));

const mockPool = {
  query: vi.fn().mockResolvedValue({ rows: [] }),
};

describe('brain-ops-reliability — 智能账号调度', () => {
  beforeEach(() => vi.clearAllMocks());

  it('场景1：account1 可用 → selectBestAccount 返回 account1', async () => {
    const { selectBestAccount } = await import('../account-usage.js');
    selectBestAccount.mockResolvedValueOnce({ accountId: 'account1', model: 'sonnet', modelId: 'claude-sonnet-4-6' });
    const result = await selectBestAccount({ minSessionHours: 4 });
    expect(result?.accountId).toBe('account1');
  });

  it('场景2：account1 限额 → 自动切换 account2', async () => {
    const { selectBestAccount } = await import('../account-usage.js');
    selectBestAccount.mockResolvedValueOnce({ accountId: 'account2', model: 'sonnet', modelId: 'claude-sonnet-4-6' });
    const result = await selectBestAccount({ minSessionHours: 4 });
    expect(result?.accountId).toBe('account2');
  });

  it('场景3：account2 session <4h → harness 任务只选 account1', async () => {
    const { selectBestAccount } = await import('../account-usage.js');
    selectBestAccount.mockImplementationOnce(async (opts) => {
      if (opts?.minSessionHours === 4) {
        return { accountId: 'account1', model: 'sonnet', modelId: 'claude-sonnet-4-6' };
      }
      return { accountId: 'account2', model: 'sonnet', modelId: 'claude-sonnet-4-6' };
    });
    const result = await selectBestAccount({ minSessionHours: 4 });
    expect(result?.accountId).toBe('account1');
  });

  it('场景4：所有账号 session <4h → null → 置 paused + P1 告警', async () => {
    const { selectBestAccount } = await import('../account-usage.js');
    const { raise } = await import('../alerting.js');
    selectBestAccount.mockResolvedValueOnce(null);

    const taskId = 'test-initiative-001';
    const selection = await selectBestAccount({ minSessionHours: 4 });
    if (!selection) {
      await mockPool.query(
        `UPDATE tasks SET status='paused', updated_at=NOW() WHERE id=$1`,
        [taskId]
      );
      await raise('P1', `no_account_harness_${taskId}`,
        `⚠️ 所有账号均不满足 harness 任务 ${taskId} session 要求，任务已暂停`);
    }

    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining("status='paused'"),
      [taskId]
    );
    expect(raise).toHaveBeenCalledWith('P1', expect.stringContaining(taskId), expect.any(String));
  });
});

describe('brain-keepalive-check.sh — shell 文件存在', () => {
  it('脚本文件存在且可执行', async () => {
    const { accessSync, constants } = await import('node:fs');
    accessSync(
      new URL('../../../../scripts/ops/brain-keepalive-check.sh', import.meta.url).pathname,
      constants.X_OK
    );
  });

  it('plist 文件存在', async () => {
    const { accessSync } = await import('node:fs');
    accessSync(
      new URL('../../../../scripts/ops/com.cecelia.brain-keepalive.plist', import.meta.url).pathname
    );
  });
});

describe('selectBestAccount — minSessionHours 过滤逻辑', () => {
  function filterBySession(accounts, minSessionHours) {
    return accounts.filter(a => {
      if (minSessionHours != null && a.sessionMins !== null) {
        return a.sessionMins >= minSessionHours * 60;
      }
      return true;
    });
  }

  it('session 剩余 1h 的账号被 minSessionHours=4 排除', () => {
    const accounts = [
      { id: 'account1', sessionMins: 60 },
      { id: 'account2', sessionMins: 300 },
    ];
    const result = filterBySession(accounts, 4);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('account2');
  });

  it('minSessionHours 未设置 → 所有账号参与（向后兼容）', () => {
    const accounts = [
      { id: 'account1', sessionMins: 60 },
      { id: 'account2', sessionMins: 300 },
    ];
    expect(filterBySession(accounts, undefined)).toHaveLength(2);
  });

  it('sessionMins=null（API key 账号无 expiresAt）→ 不过滤', () => {
    const accounts = [{ id: 'account1', sessionMins: null }];
    expect(filterBySession(accounts, 4)).toHaveLength(1);
  });
});
