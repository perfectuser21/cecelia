/**
 * Workstream 1 — F1 接任务（start-dev endpoint）BEHAVIOR 测试
 *
 * 目标 handler: POST /api/brain/tasks/:id/start-dev
 * 实现位置:    packages/brain/src/routes/tasks.js
 *
 * 红阶段：handler 不存在 → 路由查找失败 → 全部 it 失败
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../packages/brain/src/db.js', () => ({
  default: { query: vi.fn() },
}));

vi.mock('../../../packages/brain/src/actions.js', () => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
}));

vi.mock('../../../packages/brain/src/tick-helpers.js', () => ({
  routeTask: vi.fn(),
  TASK_TYPE_AGENT_MAP: {},
}));

vi.mock('../../../packages/brain/src/task-router.js', () => ({
  identifyWorkType: vi.fn(),
  getTaskLocation: vi.fn(),
  routeTaskCreate: vi.fn(),
  getValidTaskTypes: vi.fn(() => []),
  LOCATION_MAP: {},
  diagnoseKR: vi.fn(),
}));

vi.mock('../../../packages/brain/src/task-weight.js', () => ({
  getTaskWeights: vi.fn(),
}));

vi.mock('../../../packages/brain/src/events/taskEvents.js', () => ({
  publishTaskCreated: vi.fn(),
  publishTaskDispatched: vi.fn(),
  publishTaskStarted: vi.fn(),
  publishTaskCompleted: vi.fn(),
  publishTaskFailed: vi.fn(),
}));

vi.mock('../../../packages/brain/src/quarantine.js', () => ({
  getQuarantinedTasks: vi.fn(),
  getQuarantineStats: vi.fn(),
  releaseTask: vi.fn(),
  quarantineTask: vi.fn(),
  QUARANTINE_REASONS: {},
  REVIEW_ACTIONS: {},
}));

vi.mock('../../../packages/brain/src/executor.js', () => ({
  triggerCeceliaRun: vi.fn(),
  checkCeceliaRunAvailable: vi.fn(),
}));

vi.mock('../../../packages/brain/src/event-bus.js', () => ({
  emit: vi.fn(),
}));

// 关键：mock worktree 创建模块——start-dev handler 必须调用此函数
const createWorktreeMock = vi.fn();
vi.mock('../../../packages/brain/src/worktree-manager.js', () => ({
  createWorktree: createWorktreeMock,
}));

describe('Workstream 1 — start-dev route [BEHAVIOR]', () => {
  let router: any;
  let pool: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    pool = (await import('../../../packages/brain/src/db.js')).default;
    const mod = await import('../../../packages/brain/src/routes/tasks.js');
    router = mod.default;
  });

  function findHandler(method: string, pathRegex: RegExp) {
    const layer = router.stack.find(
      (l: any) => l.route?.path && pathRegex.test(l.route.path) && l.route.methods?.[method],
    );
    return layer?.route?.stack[0]?.handle;
  }

  function mockRes() {
    const res: any = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
  }

  it('POST /tasks/:id/start-dev 路由已注册', () => {
    const handler = findHandler('post', /\/tasks\/:[a-zA-Z_]+\/start-dev$/);
    expect(handler).toBeDefined();
    expect(typeof handler).toBe('function');
  });

  it('happy path: pending task → 200 + {worktree_path, branch} 字段非空，branch 以 cp- 开头', async () => {
    pool.query.mockImplementation((sql: string) => {
      if (/SELECT/i.test(sql)) {
        return Promise.resolve({ rows: [{ id: 'task-1', status: 'pending' }] });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    });
    createWorktreeMock.mockResolvedValueOnce({
      worktree_path: '/tmp/worktrees/cp-task1',
      branch: 'cp-task1-1234',
    });

    const handler = findHandler('post', /\/tasks\/:[a-zA-Z_]+\/start-dev$/);
    expect(handler).toBeDefined();
    const res = mockRes();
    await handler({ params: { id: 'task-1', task_id: 'task-1' }, body: {} }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload).toBeDefined();
    expect(payload.worktree_path).toBeTruthy();
    expect(payload.branch).toBeTruthy();
    expect(payload.branch).toMatch(/^cp-/);
  });

  it('happy path: task.status 由 pending 切到 in_progress（DB UPDATE 实际下发）', async () => {
    pool.query.mockImplementation((sql: string) => {
      if (/SELECT/i.test(sql)) {
        return Promise.resolve({ rows: [{ id: 'task-2', status: 'pending' }] });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    });
    createWorktreeMock.mockResolvedValueOnce({
      worktree_path: '/tmp/wt2',
      branch: 'cp-task2',
    });

    const handler = findHandler('post', /\/tasks\/:[a-zA-Z_]+\/start-dev$/);
    expect(handler).toBeDefined();
    await handler({ params: { id: 'task-2', task_id: 'task-2' }, body: {} }, mockRes());

    const updateCalls = pool.query.mock.calls.filter((args: any[]) =>
      /UPDATE\s+tasks/i.test(args[0]) && /in_progress/.test(JSON.stringify(args)),
    );
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('重复调用同一 task → 409，且不再调用 worktree 创建函数', async () => {
    pool.query.mockImplementation((sql: string) => {
      if (/SELECT/i.test(sql)) {
        return Promise.resolve({ rows: [{ id: 'task-3', status: 'in_progress' }] });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const handler = findHandler('post', /\/tasks\/:[a-zA-Z_]+\/start-dev$/);
    expect(handler).toBeDefined();
    const res = mockRes();
    await handler({ params: { id: 'task-3', task_id: 'task-3' }, body: {} }, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(createWorktreeMock).not.toHaveBeenCalled();
  });

  it('非 pending 状态调用（completed）→ 409', async () => {
    pool.query.mockImplementation((sql: string) => {
      if (/SELECT/i.test(sql)) {
        return Promise.resolve({ rows: [{ id: 'task-4', status: 'completed' }] });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const handler = findHandler('post', /\/tasks\/:[a-zA-Z_]+\/start-dev$/);
    expect(handler).toBeDefined();
    const res = mockRes();
    await handler({ params: { id: 'task-4', task_id: 'task-4' }, body: {} }, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(createWorktreeMock).not.toHaveBeenCalled();
  });

  it('worktree 创建失败时不修改 task.status', async () => {
    pool.query.mockImplementation((sql: string) => {
      if (/SELECT/i.test(sql)) {
        return Promise.resolve({ rows: [{ id: 'task-5', status: 'pending' }] });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    });
    createWorktreeMock.mockRejectedValueOnce(new Error('disk full'));

    const handler = findHandler('post', /\/tasks\/:[a-zA-Z_]+\/start-dev$/);
    expect(handler).toBeDefined();
    const res = mockRes();
    await handler({ params: { id: 'task-5', task_id: 'task-5' }, body: {} }, res);

    const updateToInProgress = pool.query.mock.calls.filter((args: any[]) =>
      /UPDATE\s+tasks/i.test(args[0]) && /in_progress/.test(JSON.stringify(args)),
    );
    expect(updateToInProgress.length).toBe(0);
  });
});
