/**
 * selectNextDispatchableTask — task_dependencies 表依赖门禁测试
 *
 * 背景：普通 dispatch 路径（selectNextDispatchableTask in tick.js）原先只检查
 * payload.depends_on，对 task_dependencies 表（harness_task/Initiative 子任务
 * 使用的硬边）盲视。结果 4 个 Generator ws1/ws2/ws3/ws4 同时 queued 时被
 * 并行派发，基于错误 worktree 状态产出冲突 PR。
 *
 * 修复：把 task_dependencies 表检查下沉进主 SELECT 的 WHERE 子句
 * （NOT EXISTS 子查询），参考 harness-dag.js:nextRunnableTask 的同款做法。
 *
 * 本测试断言：
 * 1. 主 SELECT SQL 包含 task_dependencies + from_task_id 的 NOT EXISTS 片段
 * 2. 该片段同时检查 to_task_id 关联的 dep.status
 * 3. 已过滤 completed/cancelled/canceled 作为"已解决"状态
 * 4. goalIds 任意两种入参下（null / 数组），依赖门禁都生效
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: mockQuery }
}));

vi.mock('../alertness-actions.js', () => ({
  getMitigationState: vi.fn().mockReturnValue({ p2_paused: false, drain_mode_requested: false })
}));

vi.mock('../task-weight.js', () => ({
  sortTasksByWeight: vi.fn((rows) => rows)
}));

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
});

describe('selectNextDispatchableTask — task_dependencies 表依赖门禁 SQL', () => {
  it('主 SELECT SQL 包含 task_dependencies + from_task_id 的 NOT EXISTS 片段', async () => {
    const { selectNextDispatchableTask } = await import('../tick.js');

    await selectNextDispatchableTask(['goal-1']);

    expect(mockQuery).toHaveBeenCalled();
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('task_dependencies');
    expect(sql).toContain('from_task_id');
    expect(sql).toContain('to_task_id');
  });

  it('task_dependencies 门禁检查 dep.status 且把 completed/cancelled/canceled 算已解决', async () => {
    const { selectNextDispatchableTask } = await import('../tick.js');

    await selectNextDispatchableTask(['goal-1']);

    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain('dep.status');
    expect(sql).toContain('completed');
    expect(sql).toContain('cancelled');
    expect(sql).toContain('canceled');
  });

  it('goalIds=null（无 goal 过滤）时 SQL 仍含 task_dependencies 门禁', async () => {
    const { selectNextDispatchableTask } = await import('../tick.js');

    await selectNextDispatchableTask(null);

    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain('task_dependencies');
    expect(sql).toContain('from_task_id');
  });

  it('SQL 过滤后候选列表为空时返回 null（依赖全阻塞场景）', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const { selectNextDispatchableTask } = await import('../tick.js');

    const result = await selectNextDispatchableTask(['goal-1']);

    expect(result).toBeNull();
  });

  it('SQL 过滤后候选非空 → 返回第一个 task（依赖解除场景）', async () => {
    const { selectNextDispatchableTask } = await import('../tick.js');

    const runnable = {
      id: 'task-ws1',
      title: 'ws1',
      status: 'queued',
      priority: 'P1',
      payload: {},
      project_id: null,
      created_at: '2026-04-23',
    };

    mockQuery.mockResolvedValueOnce({ rows: [runnable] });

    const result = await selectNextDispatchableTask(['goal-1']);

    expect(result).not.toBeNull();
    expect(result.id).toBe('task-ws1');
  });
});
