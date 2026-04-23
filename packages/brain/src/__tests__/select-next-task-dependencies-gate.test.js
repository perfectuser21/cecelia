/**
 * selectNextDispatchableTask — task_dependencies 表依赖门禁测试
 *
 * 背景：普通 dispatch 路径（selectNextDispatchableTask in tick.js）原先只检查
 * payload.depends_on，对 task_dependencies 表（harness_task/Initiative 子任务
 * 使用的硬边）盲视。结果 4 个 Generator ws1/ws2/ws3/ws4 同时 queued 时被
 * 并行派发，基于错误 worktree 状态产出冲突 PR。
 *
 * 本测试拦截 pool.query，按 SQL 文本分支返回不同结果，断言：
 * 1. task_dependencies 有未完成依赖 → 跳过此 task
 * 2. task_dependencies 全部 completed → 返回此 task
 * 3. payload.depends_on 和 task_dependencies 同时存在，任一未满足即跳过
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

/**
 * 创建一个智能 mock：按 SQL 文本路由到不同返回值
 *
 * @param {object} opts
 * @param {Array} opts.selectRows  — 主 SELECT 返回的候选 task 行
 * @param {number} opts.payloadBlockedCount  — payload.depends_on 检查返回值
 * @param {number} opts.tableBlockedCount    — task_dependencies 检查返回值
 */
function setupMock({ selectRows = [], payloadBlockedCount = 0, tableBlockedCount = 0 }) {
  mockQuery.mockImplementation((sql, params) => {
    // 主 SELECT（查询 queued task）
    if (sql.includes("t.status = 'queued'")) {
      return Promise.resolve({ rows: selectRows });
    }
    // payload.depends_on 检查
    if (sql.includes('id = ANY($1)') && sql.includes("status NOT IN")) {
      return Promise.resolve({ rows: [{ count: String(payloadBlockedCount) }] });
    }
    // task_dependencies 表检查
    if (sql.includes('task_dependencies') && sql.includes('from_task_id')) {
      return Promise.resolve({ rows: [{ blocked_count: String(tableBlockedCount) }] });
    }
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => {
  mockQuery.mockReset();
});

describe('selectNextDispatchableTask — task_dependencies 表依赖门禁', () => {
  it('task_dependencies 有未完成依赖 → 跳过此 task（返回 null）', async () => {
    const { selectNextDispatchableTask } = await import('../tick.js');

    setupMock({
      selectRows: [
        { id: 'task-ws2', title: 'ws2', status: 'queued', priority: 'P1', payload: {} }
      ],
      payloadBlockedCount: 0,
      tableBlockedCount: 1, // ws2 的依赖 ws1 还没 completed
    });

    const result = await selectNextDispatchableTask(['goal-1']);

    expect(result).toBeNull();

    // 断言确实查询了 task_dependencies 表
    const tableDepCall = mockQuery.mock.calls.find(
      (call) => call[0].includes('task_dependencies') && call[0].includes('from_task_id')
    );
    expect(tableDepCall).toBeDefined();
    expect(tableDepCall[1]).toEqual(['task-ws2']);
  });

  it('task_dependencies 全部 completed → 返回此 task', async () => {
    const { selectNextDispatchableTask } = await import('../tick.js');

    const targetTask = { id: 'task-ws1', title: 'ws1', status: 'queued', priority: 'P1', payload: {} };
    setupMock({
      selectRows: [targetTask],
      payloadBlockedCount: 0,
      tableBlockedCount: 0, // 无未完成依赖
    });

    const result = await selectNextDispatchableTask(['goal-1']);

    expect(result).not.toBeNull();
    expect(result.id).toBe('task-ws1');
  });

  it('payload.depends_on 有未满足 → 跳过（不必查 task_dependencies）', async () => {
    const { selectNextDispatchableTask } = await import('../tick.js');

    setupMock({
      selectRows: [
        {
          id: 'task-A',
          title: 'A',
          status: 'queued',
          priority: 'P1',
          payload: { depends_on: ['dep-x'] },
        }
      ],
      payloadBlockedCount: 1, // payload 依赖未完成
      tableBlockedCount: 0,
    });

    const result = await selectNextDispatchableTask(['goal-1']);

    expect(result).toBeNull();
  });

  it('payload.depends_on OK 但 task_dependencies 未完成 → 跳过', async () => {
    const { selectNextDispatchableTask } = await import('../tick.js');

    setupMock({
      selectRows: [
        {
          id: 'task-ws3',
          title: 'ws3',
          status: 'queued',
          priority: 'P1',
          payload: { depends_on: ['some-completed-dep'] },
        }
      ],
      payloadBlockedCount: 0, // payload 检查通过
      tableBlockedCount: 2,   // 但 task_dependencies 表有 2 条未完成
    });

    const result = await selectNextDispatchableTask(['goal-1']);

    expect(result).toBeNull();

    // 两次检查都应被调用
    const payloadCall = mockQuery.mock.calls.find(
      (call) => call[0].includes('id = ANY($1)') && !call[0].includes('task_dependencies')
    );
    const tableCall = mockQuery.mock.calls.find(
      (call) => call[0].includes('task_dependencies')
    );
    expect(payloadCall).toBeDefined();
    expect(tableCall).toBeDefined();
  });

  it('第一个 task 被依赖阻塞时应继续尝试下一个', async () => {
    const { selectNextDispatchableTask } = await import('../tick.js');

    const blocked = { id: 'task-ws2', title: 'ws2', status: 'queued', priority: 'P1', payload: {} };
    const runnable = { id: 'task-ws1', title: 'ws1', status: 'queued', priority: 'P1', payload: {} };

    // 按 task.id 分支返回不同 blocked_count
    mockQuery.mockImplementation((sql, params) => {
      if (sql.includes("t.status = 'queued'")) {
        return Promise.resolve({ rows: [blocked, runnable] });
      }
      if (sql.includes('task_dependencies') && sql.includes('from_task_id')) {
        const taskId = params?.[0];
        const count = taskId === 'task-ws2' ? 1 : 0;
        return Promise.resolve({ rows: [{ blocked_count: String(count) }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await selectNextDispatchableTask(['goal-1']);

    expect(result).not.toBeNull();
    expect(result.id).toBe('task-ws1');
  });
});
