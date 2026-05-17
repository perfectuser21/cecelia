/**
 * credential-expiry-checker.js — cleanupDuplicateRescueTasks() 单元测试
 *
 * 验证救援风暴清理逻辑：
 * 1. 同分支有重复 quarantined pipeline_rescue 任务时，保留最新，取消其余
 * 2. 凭据不健康时跳过
 * 3. 无重复时 cancelled=0
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

import { cleanupDuplicateRescueTasks } from '../credential-expiry-checker.js';

// 构造健康的凭据文件（token 在未来 24h 过期）
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

describe('cleanupDuplicateRescueTasks', () => {
  it('凭据不健康时直接跳过', async () => {
    // 模拟 token 已过期
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ claudeAiOauth: { accessToken: 'tok', expiresAt: Date.now() - 1000 } })
    );

    const result = await cleanupDuplicateRescueTasks(mockPool);

    expect(result.skipped).toMatch(/credentials not healthy/);
    expect(result.cancelled).toBe(0);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('无重复分支时 cancelled=0，branches=0', async () => {
    // 第一次 query：返回无重复分支
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await cleanupDuplicateRescueTasks(mockPool);

    expect(result.skipped).toBeNull();
    expect(result.cancelled).toBe(0);
    expect(result.branches).toBe(0);
  });

  it('有重复分支时：保留最新，取消其余', async () => {
    const branch = 'cp-04050148-test-branch';

    // Query 1: 重复分支列表
    mockPool.query.mockResolvedValueOnce({
      rows: [{ branch, task_count: '3' }],
    });

    // Query 2: 该分支所有 quarantined 任务（降序）
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { id: 'newest-task-id', updated_at: new Date('2026-04-08T12:00:00Z') },
        { id: 'older-task-id-1', updated_at: new Date('2026-04-08T11:00:00Z') },
        { id: 'older-task-id-2', updated_at: new Date('2026-04-08T10:00:00Z') },
      ],
    });

    // Query 3: UPDATE 取消旧任务
    mockPool.query.mockResolvedValueOnce({ rowCount: 2 });

    const result = await cleanupDuplicateRescueTasks(mockPool);

    expect(result.skipped).toBeNull();
    expect(result.cancelled).toBe(2);
    expect(result.branches).toBe(1);

    // 验证 UPDATE 调用中包含 'cancelled' 状态 + 正确的取消 ID
    const updateCall = mockPool.query.mock.calls[2];
    expect(updateCall[0]).toContain("status = 'cancelled'");
    // 旧任务在参数中（WHERE IN 取消列表）
    expect(updateCall[1]).toContain('older-task-id-1');
    expect(updateCall[1]).toContain('older-task-id-2');
    // 最新任务作为 kept_task_id 传入（最后一个参数），不在 WHERE 取消范围内
    expect(updateCall[1][updateCall[1].length - 1]).toBe('newest-task-id');
  });

  it('多个分支都有重复时，每个分支独立处理', async () => {
    const branch1 = 'cp-04050148-branch-a';
    const branch2 = 'cp-04060439-branch-b';

    // Query 1: 重复分支列表（2个分支）
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { branch: branch1, task_count: '2' },
        { branch: branch2, task_count: '3' },
      ],
    });

    // Query 2: branch1 的任务列表
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { id: 'b1-newest', updated_at: new Date('2026-04-08T12:00:00Z') },
        { id: 'b1-older', updated_at: new Date('2026-04-08T11:00:00Z') },
      ],
    });

    // Query 3: branch1 的 UPDATE
    mockPool.query.mockResolvedValueOnce({ rowCount: 1 });

    // Query 4: branch2 的任务列表
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { id: 'b2-newest', updated_at: new Date('2026-04-08T12:00:00Z') },
        { id: 'b2-older-1', updated_at: new Date('2026-04-08T11:00:00Z') },
        { id: 'b2-older-2', updated_at: new Date('2026-04-08T10:00:00Z') },
      ],
    });

    // Query 5: branch2 的 UPDATE
    mockPool.query.mockResolvedValueOnce({ rowCount: 2 });

    const result = await cleanupDuplicateRescueTasks(mockPool);

    expect(result.skipped).toBeNull();
    expect(result.cancelled).toBe(3); // 1 + 2
    expect(result.branches).toBe(2);
  });

  it('UPDATE 失败时非阻塞，返回部分结果', async () => {
    const branch = 'cp-error-branch';

    mockPool.query.mockResolvedValueOnce({
      rows: [{ branch, task_count: '2' }],
    });

    mockPool.query.mockResolvedValueOnce({
      rows: [
        { id: 'newest', updated_at: new Date('2026-04-08T12:00:00Z') },
        { id: 'older', updated_at: new Date('2026-04-08T11:00:00Z') },
      ],
    });

    // UPDATE 抛出错误
    mockPool.query.mockRejectedValueOnce(new Error('DB connection lost'));

    // 不抛出，返回 cancelled=0（该分支处理失败）
    const result = await cleanupDuplicateRescueTasks(mockPool);

    expect(result.cancelled).toBe(0);
    expect(result.branches).toBe(1);
  });
});
