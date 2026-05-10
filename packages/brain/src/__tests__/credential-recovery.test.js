/**
 * credential-recovery.test.js
 *
 * 测试 recoverAuthQuarantinedTasks — 凭据恢复后自动重排队逻辑
 * 测试 checkAndAlertExpiringCredentials — 凭据告警两层机制（常规 + 紧急升级）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs/os before importing the module
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));
vi.mock('os', () => ({
  homedir: vi.fn(() => '/mock/home'),
}));
vi.mock('../actions.js', () => ({
  createTask: vi.fn().mockResolvedValue({ id: 'mock-task-id', deduplicated: false }),
}));
vi.mock('../alerting.js', () => ({
  raise: vi.fn().mockResolvedValue(undefined),
}));

import { readFileSync, existsSync } from 'fs';
import { recoverAuthQuarantinedTasks, checkAndAlertExpiringCredentials, _resetAlertDedup } from '../credential-expiry-checker.js';
import { createTask } from '../actions.js';
import { raise } from '../alerting.js';

// Helper: build a fresh mock pool
function makePool({ accountUsageRows = [], candidateRows = [], updateOk = true } = {}) {
  const query = vi.fn().mockImplementation(async (sql) => {
    if (sql.includes('account_usage_cache')) {
      return { rows: accountUsageRows };
    }
    if (sql.includes('SELECT id') && sql.includes('failure_class')) {
      return { rows: candidateRows };
    }
    if (sql.includes('UPDATE tasks')) {
      if (!updateOk) throw new Error('DB update failed');
      return { rowCount: candidateRows.length };
    }
    return { rows: [] };
  });
  return { query };
}

// Helper: mock healthy credentials
function mockHealthyCredentials() {
  existsSync.mockReturnValue(true);
  readFileSync.mockReturnValue(JSON.stringify({
    claudeAiOauth: {
      expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours from now (well above any alert threshold)
    },
  }));
}

// Helper: mock expired credentials
function mockExpiredCredentials() {
  existsSync.mockReturnValue(true);
  readFileSync.mockReturnValue(JSON.stringify({
    claudeAiOauth: {
      expiresAt: Date.now() - 1000, // already expired
    },
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('recoverAuthQuarantinedTasks', () => {
  it('跳过：本地凭据已过期时不恢复', async () => {
    mockExpiredCredentials();
    const pool = makePool();

    const result = await recoverAuthQuarantinedTasks(pool);

    expect(result.recovered).toBe(0);
    expect(result.skipped).toMatch(/credentials not healthy/);
    // 不应查询 DB
    expect(pool.query).not.toHaveBeenCalledWith(expect.stringContaining('SELECT id'));
  });

  it('跳过：DB auth_failed 熔断未恢复时不操作', async () => {
    mockHealthyCredentials();
    const pool = makePool({
      accountUsageRows: [{ cnt: '1' }], // is_auth_failed still true
    });

    const result = await recoverAuthQuarantinedTasks(pool);

    expect(result.recovered).toBe(0);
    expect(result.skipped).toMatch(/circuit still open/);
  });

  it('跳过：无 quarantined auth 任务时返回 skipped', async () => {
    mockHealthyCredentials();
    const pool = makePool({
      accountUsageRows: [{ cnt: '0' }],
      candidateRows: [],
    });

    const result = await recoverAuthQuarantinedTasks(pool);

    expect(result.recovered).toBe(0);
    expect(result.skipped).toMatch(/no quarantined/);
  });

  it('成功恢复：正常 quarantined 任务被重排队', async () => {
    mockHealthyCredentials();
    const candidates = [
      { id: 'aaa-111', title: '诊断任务1', retry_count: '0', max_retries: '3' },
      { id: 'bbb-222', title: '诊断任务2', retry_count: '1', max_retries: '3' },
    ];
    const pool = makePool({
      accountUsageRows: [{ cnt: '0' }],
      candidateRows: candidates,
    });

    const result = await recoverAuthQuarantinedTasks(pool);

    expect(result.recovered).toBe(2);
    expect(result.taskIds).toEqual(['aaa-111', 'bbb-222']);
    expect(result.skipped).toBeNull();
    // UPDATE 应该被调用
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE tasks'),
      expect.arrayContaining(['aaa-111', 'bbb-222'])
    );
  });

  it('过滤：超过 max_retries 的任务不恢复', async () => {
    mockHealthyCredentials();
    const candidates = [
      { id: 'ccc-333', title: '已用完重试', retry_count: '3', max_retries: '3' },
      { id: 'ddd-444', title: '正常任务', retry_count: '1', max_retries: '3' },
    ];
    const pool = makePool({
      accountUsageRows: [{ cnt: '0' }],
      candidateRows: candidates,
    });

    const result = await recoverAuthQuarantinedTasks(pool);

    expect(result.recovered).toBe(1);
    expect(result.taskIds).toEqual(['ddd-444']);
  });

  it('跳过：所有候选都超过 max_retries', async () => {
    mockHealthyCredentials();
    const candidates = [
      { id: 'eee-555', title: '已用完重试', retry_count: '3', max_retries: '3' },
    ];
    const pool = makePool({
      accountUsageRows: [{ cnt: '0' }],
      candidateRows: candidates,
    });

    const result = await recoverAuthQuarantinedTasks(pool);

    expect(result.recovered).toBe(0);
    expect(result.skipped).toMatch(/max_retries/);
  });

  it('容错：DB update 失败时返回 skipped 不抛出', async () => {
    mockHealthyCredentials();
    const candidates = [
      { id: 'fff-666', title: '正常任务', retry_count: '0', max_retries: '3' },
    ];
    const pool = makePool({
      accountUsageRows: [{ cnt: '0' }],
      candidateRows: candidates,
      updateOk: false,
    });

    const result = await recoverAuthQuarantinedTasks(pool);

    expect(result.recovered).toBe(0);
    expect(result.skipped).toMatch(/update failed/);
  });

  it('容错：account_usage_cache 不存在时降级跳过 DB 检查并继续', async () => {
    mockHealthyCredentials();
    const candidates = [
      { id: 'ggg-777', title: '降级测试任务', retry_count: '0', max_retries: '3' },
    ];
    // pool: account_usage_cache 查询抛出异常（表不存在）
    const pool = {
      query: vi.fn().mockImplementation(async (sql) => {
        if (sql.includes('account_usage_cache')) throw new Error('relation does not exist');
        if (sql.includes('SELECT id')) return { rows: candidates };
        if (sql.includes('UPDATE')) return { rowCount: 1 };
        return { rows: [] };
      }),
    };

    const result = await recoverAuthQuarantinedTasks(pool);

    // account_usage_cache 异常应降级（不阻断），继续查候选并恢复
    expect(result.recovered).toBe(1);
  });
});

// ============================================================
// checkAndAlertExpiringCredentials — raise() 轻量告警通道测试
// ============================================================

describe('checkAndAlertExpiringCredentials', () => {
  function mockExpiringCredential(remainingMs) {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(JSON.stringify({
      claudeAiOauth: {
        expiresAt: Date.now() + remainingMs,
      },
    }));
  }

  const pool = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };

  beforeEach(() => {
    vi.clearAllMocks();
    _resetAlertDedup(); // 清除内存去重缓存，确保每个测试独立
  });

  it('< 3h 剩余：通过 raise() 发送 P0 紧急告警', async () => {
    mockExpiringCredential(2 * 60 * 60 * 1000); // 2h remaining

    const result = await checkAndAlertExpiringCredentials(pool);

    expect(result.alerted).toBe(2); // H14: ACCOUNTS={account1, account2}（account3 退订）
    expect(raise).toHaveBeenCalledWith(
      'P0',
      expect.stringContaining('credential_expiry_account'),
      expect.stringContaining('需立即刷新')
    );
    expect(createTask).not.toHaveBeenCalled(); // 不再创建 research 任务
  });

  it('< 3h 剩余：1h 内已告警时跳过（内存去重）', async () => {
    mockExpiringCredential(2 * 60 * 60 * 1000); // 2h remaining
    // 第一次调用 — 填充去重缓存
    await checkAndAlertExpiringCredentials(pool);
    vi.clearAllMocks();
    // 第二次调用 — 1h 内同账号同级别应被跳过
    const result = await checkAndAlertExpiringCredentials(pool);

    expect(result.alerted).toBe(0);
    expect(raise).not.toHaveBeenCalled();
  });

  it('3h~8h 剩余：通过 raise() 发送 P1 常规告警', async () => {
    mockExpiringCredential(5 * 60 * 60 * 1000); // 5h remaining

    const result = await checkAndAlertExpiringCredentials(pool);

    expect(result.alerted).toBe(2); // H14: ACCOUNTS={account1, account2}
    expect(raise).toHaveBeenCalledWith(
      'P1',
      expect.stringContaining('credential_expiry_account'),
      expect.stringContaining('需尽快刷新')
    );
    expect(createTask).not.toHaveBeenCalled();
  });

  it('3h~8h 剩余：1h 内已告警时跳过（内存去重）', async () => {
    mockExpiringCredential(5 * 60 * 60 * 1000); // 5h remaining
    await checkAndAlertExpiringCredentials(pool);
    vi.clearAllMocks();
    const result = await checkAndAlertExpiringCredentials(pool);

    expect(result.alerted).toBe(0);
    expect(raise).not.toHaveBeenCalled();
  });

  it('凭据健康（> 8h）：不告警', async () => {
    mockExpiringCredential(10 * 60 * 60 * 1000); // 10h — above 8h threshold

    const result = await checkAndAlertExpiringCredentials(pool);

    expect(result.alerted).toBe(0);
    expect(raise).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
  });
});
