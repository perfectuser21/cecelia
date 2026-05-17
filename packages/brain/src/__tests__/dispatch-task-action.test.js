/**
 * 验证 dispatch_task action 不将 params.trigger 字符串传给 dispatchNextTask
 *
 * 根因：decision-executor.js 曾把 params.trigger（字符串 'task_completed'）
 * 传给 dispatchNextTask(goalIds)，导致 PostgreSQL = ANY($1) 报
 * "malformed array literal: task_completed"，thalamus 每次回调都回滚。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { actionHandlers } from '../decision-executor.js';

// Mock tick.js 捕获实际传入的参数
const mockDispatchNextTask = vi.fn().mockResolvedValue({ dispatched: true });

vi.mock('../tick.js', () => ({
  dispatchNextTask: (...args) => mockDispatchNextTask(...args),
}));

vi.mock('../db.js', () => ({
  default: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    connect: vi.fn().mockResolvedValue({ query: vi.fn(), release: vi.fn() }),
  },
}));

describe('dispatch_task action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('调用 dispatchNextTask 时不传字符串（避免 malformed array literal）', async () => {
    await actionHandlers.dispatch_task({ trigger: 'task_completed' }, {});

    expect(mockDispatchNextTask).toHaveBeenCalledTimes(1);
    const arg = mockDispatchNextTask.mock.calls[0][0];
    // 不能是字符串，否则 PostgreSQL = ANY($1) 会崩
    expect(typeof arg).not.toBe('string');
  });

  it('传 null 给 dispatchNextTask（允许不过滤 goal 的全局派发）', async () => {
    await actionHandlers.dispatch_task({ trigger: 'task_completed' }, {});

    const arg = mockDispatchNextTask.mock.calls[0][0];
    expect(arg).toBeNull();
  });

  it('返回 success: true', async () => {
    const result = await actionHandlers.dispatch_task({ trigger: 'task_completed' }, {});
    expect(result.success).toBe(true);
  });
});
