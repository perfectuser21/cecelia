/**
 * blocked-tasks.test.js
 * 测试 blockTask / unblockTask / unblockExpiredTasks 及相关 API 路由
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pool
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));

// Mock event publishers（task-updater 导入链依赖）
vi.mock('../events/taskEvents.js', () => ({
  publishTaskStarted: vi.fn(),
  publishTaskCompleted: vi.fn(),
  publishTaskFailed: vi.fn(),
  publishTaskProgress: vi.fn(),
}));

// Mock event-bus（blockTask/unblockTask 调用 emit）
vi.mock('../event-bus.js', () => ({ emit: vi.fn().mockResolvedValue(undefined) }));

const { blockTask, unblockTask, unblockExpiredTasks } = await import('../task-updater.js');

// ======================================================================
// blockTask
// ======================================================================
describe('blockTask', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('写入所有 4 个 blocked_* 字段（完整参数）', async () => {
    const fakeTask = {
      id: 'task-1', status: 'blocked',
      blocked_at: new Date().toISOString(),
      blocked_reason: 'dependency',
      blocked_detail: { message: 'waiting for task-2' },
      blocked_until: new Date(Date.now() + 60000).toISOString(),
    };
    mockQuery.mockResolvedValueOnce({ rows: [fakeTask] });

    const until = new Date(Date.now() + 60000);
    const result = await blockTask('task-1', {
      reason: 'dependency',
      detail: 'waiting for task-2',
      until,
    });

    expect(result.success).toBe(true);
    expect(result.task.status).toBe('blocked');
    expect(result.task.blocked_reason).toBe('dependency');

    const [sql, params] = mockQuery.mock.calls[0];
    // 验证 SQL 包含 4 个 blocked_* 字段
    expect(sql).toContain('blocked_at');
    expect(sql).toContain('blocked_reason');
    expect(sql).toContain('blocked_detail');
    expect(sql).toContain('blocked_until');
    // 验证 detail 被序列化为 JSONB
    expect(params[2]).toBe(JSON.stringify({ message: 'waiting for task-2' }));
    // 验证 reason 传入
    expect(params[1]).toBe('dependency');
  });

  it('旧调用方式（只传 taskId）向后兼容，reason 默认 other', async () => {
    const fakeTask = { id: 'task-2', status: 'blocked', blocked_reason: 'other' };
    mockQuery.mockResolvedValueOnce({ rows: [fakeTask] });

    const result = await blockTask('task-2');
    expect(result.success).toBe(true);
    expect(mockQuery.mock.calls[0][1][1]).toBe('other');
  });

  it('非法 blocked_reason 枚举值抛出错误', async () => {
    await expect(blockTask('task-x', { reason: 'invalid_reason' }))
      .rejects.toThrow('Invalid blocked_reason');
  });

  it('任务不存在或状态不可 block 时返回 success:false', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await blockTask('not-exist', { reason: 'manual' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found or not in blockable state');
  });

  it('已是 blocked 状态无法再次 block（WHERE 条件过滤，返回 success:false）', async () => {
    // DB 返回空行（因为 status = 'blocked' 不满足 WHERE IN ('queued','in_progress','failed')）
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await blockTask('task-blocked', { reason: 'manual' });
    expect(result.success).toBe(false);
  });

  it('detail 为对象时直接序列化', async () => {
    const fakeTask = { id: 'task-3', status: 'blocked', blocked_reason: 'resource' };
    mockQuery.mockResolvedValueOnce({ rows: [fakeTask] });

    await blockTask('task-3', { reason: 'resource', detail: { code: 'ENOMEM', used: 90 } });
    const detailParam = mockQuery.mock.calls[0][1][2];
    expect(JSON.parse(detailParam)).toEqual({ code: 'ENOMEM', used: 90 });
  });
});

// ======================================================================
// unblockTask
// ======================================================================
describe('unblockTask', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('恢复状态为 queued 并清空所有 blocked_* 字段', async () => {
    const fakeTask = {
      id: 'task-1', status: 'queued',
      blocked_at: null, blocked_reason: null,
      blocked_detail: null, blocked_until: null,
    };
    mockQuery.mockResolvedValueOnce({ rows: [fakeTask] });

    const result = await unblockTask('task-1');
    expect(result.success).toBe(true);
    expect(result.task.status).toBe('queued');

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain("status = 'queued'");
    expect(sql).toContain('blocked_at = NULL');
    expect(sql).toContain('blocked_reason = NULL');
    expect(sql).toContain('blocked_detail = NULL');
    expect(sql).toContain('blocked_until = NULL');
    expect(sql).toContain("AND status = 'blocked'");
  });

  it('非 blocked 状态任务调用 unblock 返回 success:false', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await unblockTask('task-queued');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found or not in blocked state');
  });

  it('任务不存在时返回 success:false', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await unblockTask('not-exist');
    expect(result.success).toBe(false);
  });
});

// ======================================================================
// unblockExpiredTasks
// ======================================================================
describe('unblockExpiredTasks', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('解除过期 blocked 任务，返回解除任务数组', async () => {
    // 第一个 query: SELECT 过期任务
    mockQuery.mockResolvedValueOnce({ rows: [
      { id: 'a', title: 'Task A', blocked_reason: 'rate_limit' },
      { id: 'b', title: 'Task B', blocked_reason: 'manual' },
    ] });
    // 第二、三个 query: unblockTask 的 UPDATE（每个任务一次）
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'a', status: 'queued', title: 'Task A' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'b', status: 'queued', title: 'Task B' }] });

    const recovered = await unblockExpiredTasks();
    expect(Array.isArray(recovered)).toBe(true);
    expect(recovered.length).toBe(2);
    expect(recovered[0].task_id).toBe('a');
    expect(recovered[0].blocked_reason).toBe('rate_limit');

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain("status = 'blocked'");
    expect(sql).toContain('blocked_until IS NOT NULL');
    expect(sql).toContain('blocked_until < NOW()');
  });

  it('无过期任务时返回空数组', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const recovered = await unblockExpiredTasks();
    expect(Array.isArray(recovered)).toBe(true);
    expect(recovered.length).toBe(0);
  });

  it('DB 报错时静默返回空数组（不抛出）', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB connection lost'));
    const recovered = await unblockExpiredTasks();
    expect(Array.isArray(recovered)).toBe(true);
    expect(recovered.length).toBe(0);
  });
});

// ======================================================================
// 枚举完整性
// ======================================================================
describe('blocked_reason 枚举完整性', () => {
  const validReasons = ['dependency', 'resource', 'auth', 'manual', 'rate_limit', 'other'];
  beforeEach(() => { vi.clearAllMocks(); });

  it.each(validReasons)('valid reason: %s', async (reason) => {
    const fakeTask = { id: 'task-enum', status: 'blocked', blocked_reason: reason };
    mockQuery.mockResolvedValueOnce({ rows: [fakeTask] });

    const result = await blockTask('task-enum', { reason });
    expect(result.success).toBe(true);
  });

  it('无效 reason 拒绝', async () => {
    await expect(blockTask('x', { reason: 'unknown' })).rejects.toThrow('Invalid blocked_reason');
    await expect(blockTask('x', { reason: 'billing_cap' })).rejects.toThrow('Invalid blocked_reason');
    await expect(blockTask('x', { reason: '' })).rejects.toThrow('Invalid blocked_reason');
  });
});
