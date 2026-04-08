/**
 * credential-expiry-checker.js — cleanupAuthQuarantinedRescueTasks() 单元测试
 *
 * 验证 auth 故障遗留 rescue 清理逻辑：
 * 1. 凭据不健康时跳过
 * 2. DB auth circuit 仍开启时跳过
 * 3. 凭据健康 + circuit 关闭时取消所有 quarantined auth rescue 任务
 * 4. 无任务时 cancelled=0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPool, mockReadFileSync } = vi.hoisted(() => {
  const mockPool = { query: vi.fn() };
  const mockReadFileSync = vi.fn();
  return { mockPool, mockReadFileSync };
});

vi.mock('../db.js', () => ({ default: mockPool }));
vi.mock('fs', () => ({ existsSync: vi.fn(() => true), readFileSync: mockReadFileSync }));
vi.mock('os', () => ({ homedir: vi.fn(() => '/mock/home') }));
vi.mock('../actions.js', () => ({ createTask: vi.fn().mockResolvedValue({}) }));

import { cleanupAuthQuarantinedRescueTasks } from '../credential-expiry-checker.js';

function makeHealthyCredentials() {
  return JSON.stringify({
    claudeAiOauth: {
      accessToken: 'valid-token',
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockReadFileSync.mockReturnValue(makeHealthyCredentials());
});

describe('cleanupAuthQuarantinedRescueTasks', () => {
  it('凭据不健康（token 已过期）时跳过，不查询 DB', async () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ claudeAiOauth: { accessToken: 'tok', expiresAt: Date.now() - 1000 } })
    );

    const result = await cleanupAuthQuarantinedRescueTasks(mockPool);

    expect(result.skipped).toMatch(/credentials not healthy/);
    expect(result.cancelled).toBe(0);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('DB auth circuit 仍开启时跳过（is_auth_failed=true）', async () => {
    // 守卫 2：account_usage_cache 中有 is_auth_failed=true
    mockPool.query.mockResolvedValueOnce({ rows: [{ cnt: '1' }] });

    const result = await cleanupAuthQuarantinedRescueTasks(mockPool);

    expect(result.skipped).toBe('db auth_failed circuit still open');
    expect(result.cancelled).toBe(0);
  });

  it('凭据健康且 circuit 关闭时取消所有 quarantined auth rescue 任务', async () => {
    // 守卫 2：无 is_auth_failed
    mockPool.query.mockResolvedValueOnce({ rows: [{ cnt: '0' }] });
    // UPDATE 返回 5 行受影响
    mockPool.query.mockResolvedValueOnce({ rowCount: 5 });

    const result = await cleanupAuthQuarantinedRescueTasks(mockPool);

    expect(result.skipped).toBeNull();
    expect(result.cancelled).toBe(5);

    // 验证 UPDATE 语句内容
    const updateCall = mockPool.query.mock.calls[1];
    expect(updateCall[0]).toContain("status = 'cancelled'");
    expect(updateCall[0]).toContain("task_type = 'pipeline_rescue'");
    expect(updateCall[0]).toContain("failure_class' = 'auth'");
    expect(updateCall[0]).toContain('auth_outage_rescue_stale');
  });

  it('无 quarantined auth rescue 任务时 cancelled=0', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ cnt: '0' }] });
    mockPool.query.mockResolvedValueOnce({ rowCount: 0 });

    const result = await cleanupAuthQuarantinedRescueTasks(mockPool);

    expect(result.skipped).toBeNull();
    expect(result.cancelled).toBe(0);
  });

  it('account_usage_cache 不存在时降级继续（跳过守卫 2）', async () => {
    // 守卫 2 查询抛错 → 继续执行
    mockPool.query.mockRejectedValueOnce(new Error('relation "account_usage_cache" does not exist'));
    mockPool.query.mockResolvedValueOnce({ rowCount: 3 });

    const result = await cleanupAuthQuarantinedRescueTasks(mockPool);

    expect(result.skipped).toBeNull();
    expect(result.cancelled).toBe(3);
  });

  it('UPDATE 失败时返回 skipped 而非抛出异常', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ cnt: '0' }] });
    mockPool.query.mockRejectedValueOnce(new Error('DB connection lost'));

    const result = await cleanupAuthQuarantinedRescueTasks(mockPool);

    expect(result.skipped).toMatch(/DB connection lost/);
    expect(result.cancelled).toBe(0);
  });
});
