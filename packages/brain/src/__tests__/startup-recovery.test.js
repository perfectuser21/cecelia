/**
 * startup-recovery.js 单元测试
 *
 * 覆盖：
 * - 正常恢复：有孤儿任务 → 重置为 queued，取消 run_events
 * - 无孤儿任务 → 返回空列表，不报错
 * - DB 错误 → 不抛出，返回 error 字段
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock pool：两次 query 调用（UPDATE tasks + UPDATE run_events）
const mockQuery = vi.fn();
const mockPool = { query: mockQuery };

// 动态 import 避免模块缓存影响 mock
const { runStartupRecovery } = await import('../startup-recovery.js');

describe('startup-recovery.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('有孤儿任务时：重置为 queued，取消 run_events，返回任务列表', async () => {
    const orphans = [
      { id: 'task-uuid-1', title: '任务 A' },
      { id: 'task-uuid-2', title: '任务 B' },
    ];

    // 第一次 query: UPDATE tasks RETURNING id, title
    mockQuery.mockResolvedValueOnce({ rows: orphans });
    // 第二次 query: UPDATE run_events
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await runStartupRecovery(mockPool);

    expect(result.requeued).toHaveLength(2);
    expect(result.requeued[0].id).toBe('task-uuid-1');
    expect(result.error).toBeUndefined();

    // 验证第一次 SQL：包含关键词
    const firstCall = mockQuery.mock.calls[0][0];
    expect(firstCall).toContain("status = 'queued'");
    expect(firstCall).toContain("status = 'in_progress'");
    expect(firstCall).toContain('5 minutes');
    expect(firstCall).toContain('RETURNING id, title');

    // 验证第二次 SQL：取消 run_events
    const secondCall = mockQuery.mock.calls[1][0];
    expect(secondCall).toContain("status = 'cancelled'");
    expect(secondCall).toContain('run_events');
    expect(secondCall).toContain("status = 'running'");

    // 验证第二次调用传入了 ids 数组
    const secondArgs = mockQuery.mock.calls[1][1];
    expect(secondArgs[0]).toEqual(['task-uuid-1', 'task-uuid-2']);
  });

  it('无孤儿任务时：返回空列表，只调用一次 query', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await runStartupRecovery(mockPool);

    expect(result.requeued).toHaveLength(0);
    expect(result.error).toBeUndefined();
    // 无孤儿任务则不需要执行 UPDATE run_events
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('DB 错误时：不抛出异常，返回 error 字段', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    const result = await runStartupRecovery(mockPool);

    expect(result.requeued).toHaveLength(0);
    expect(result.error).toBe('connection refused');
  });
});
