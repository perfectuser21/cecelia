import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
// ── Mocks ──────────────────────────────────────────────────────────────────

const { mockPool } = vi.hoisted(() => ({ mockPool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock('../db.js', () => ({ default: mockPool }));

// Mock所有 routes.js 依赖的外部模块，防止副作用
vi.mock('../event-bus.js', () => ({ emit: vi.fn(), on: vi.fn() }));
vi.mock('../alertness/index.js', () => ({
  initAlertness: vi.fn(), evaluateAlertness: vi.fn(),
  getCurrentAlertness: vi.fn().mockReturnValue({ level: 'GREEN', score: 0 }),
  canDispatch: vi.fn().mockReturnValue(true), canPlan: vi.fn().mockReturnValue(true),
  getDispatchRate: vi.fn().mockReturnValue(1),
  ALERTNESS_LEVELS: { GREEN: 'GREEN' }, LEVEL_NAMES: {},
}));
vi.mock('../alertness/metrics.js', () => ({ recordTickTime: vi.fn(), recordOperation: vi.fn() }));
vi.mock('../executor.js', () => ({
  triggerCeceliaRun: vi.fn(), checkCeceliaRunAvailable: vi.fn().mockResolvedValue(true),
  getActiveProcessCount: vi.fn().mockReturnValue(0), killProcess: vi.fn(),
  cleanupOrphanProcesses: vi.fn().mockResolvedValue([]),
  checkServerResources: vi.fn().mockResolvedValue({ ok: true }),
  probeTaskLiveness: vi.fn().mockResolvedValue(null),
  syncOrphanTasksOnStartup: vi.fn().mockResolvedValue(0),
  killProcessTwoStage: vi.fn(), requeueTask: vi.fn(),
  MAX_SEATS: 4, INTERACTIVE_RESERVE: 1, getBillingPause: vi.fn().mockResolvedValue(false),
}));
vi.mock('../planner.js', () => ({ planNextTask: vi.fn().mockResolvedValue({ reason: 'no_tasks' }) }));
vi.mock('../thalamus.js', () => ({
  processEvent: vi.fn().mockResolvedValue(null),
  EVENT_TYPES: {},
  ACTION_WHITELIST: {},
}));
vi.mock('../circuit-breaker.js', () => ({
  isAllowed: vi.fn().mockReturnValue(true), recordSuccess: vi.fn(), recordFailure: vi.fn(),
  getAllStates: vi.fn().mockReturnValue({}),
}));
vi.mock('../embedding-service.js', () => ({
  generateTaskEmbeddingAsync: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../events/taskEvents.js', () => ({
  publishTaskStarted: vi.fn(), publishExecutorStatus: vi.fn(),
  publishCognitiveState: vi.fn(), publishTaskCompleted: vi.fn(),
  publishTaskFailed: vi.fn(),
}));
vi.mock('../slot-allocator.js', () => ({
  harnessSlotCheck: vi.fn().mockResolvedValue({ allow: true, reason: 'ok', containers: 0, inflight: 0, cap: { effective: 4, mem_cap: 8, acct_cap: 4, hard_cap: 8 }, stale: false }),
  calculateSlotBudget: vi.fn().mockReturnValue({ available: 4 }),
}));


let handler;
beforeAll(async () => {
  const { default: router } = await import('../routes/tasks.js');
  handler = router.stack.find(layer => layer.route?.path === '/tasks/:task_id/feedback').route.stack[0].handle;
});
beforeEach(() => {
  mockPool.query.mockReset();
  mockPool.query.mockImplementation(async sql => {
    if (sql.includes('SELECT id, status, goal_id')) return { rows: [{ id: 'task-1', status: 'in_progress', goal_id: null }] };
    if (sql.includes('UPDATE tasks')) return { rows: [] };
    throw new Error(`本测试禁止未声明查询: ${sql}`);
  });
});
async function invoke(body) {
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; } };
  await handler({ params: { task_id: 'task-1' }, body }, res);
  return res;
}
function writes() { return mockPool.query.mock.calls.filter(([sql]) => sql.includes('UPDATE tasks')); }

describe('真实任务反馈路由合同（无网络/数据库）', () => {
  it('接受合法反馈并生成反馈ID和时间戳', async () => {
    const res = await invoke({ status: 'completed', summary: '完成' });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    const [[sql, params]] = writes();
    expect(sql).toContain('feedback_count = feedback_count + 1');
    expect(params[1]).toBe('task-1');
    expect(JSON.parse(params[0])).toEqual([{ id: res.body.feedback_id, received_at: res.body.received_at, status: 'completed', summary: '完成' }]);
    expect(res.body.feedback_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isFinite(Date.parse(res.body.received_at))).toBe(true);
  });
  it('缺少summary拒绝且不写库', async () => {
    const res = await invoke({ status: 'completed' });
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('MISSING_FIELD');
    expect(mockPool.query).not.toHaveBeenCalled();
  });
  it.each(['pending', 'in_progress', 'invalid'])('非法反馈状态%s拒绝且不写库', async status => {
    const res = await invoke({ status, summary: '反馈' });
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('INVALID_STATUS');
    expect(mockPool.query).not.toHaveBeenCalled();
  });
  it('不存在的任务返回404且不写库', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    const res = await invoke({ summary: '反馈' });
    expect(res.statusCode).toBe(404);
    expect(res.body.code).toBe('TASK_NOT_FOUND');
    expect(writes()).toHaveLength(0);
  });
  it('多次反馈都追加，使用不同反馈ID', async () => {
    const first = await invoke({ summary: '第一条' });
    const second = await invoke({ status: 'failed', summary: '第二条' });
    expect(first.body.feedback_id).not.toBe(second.body.feedback_id);
    expect(writes()).toHaveLength(2);
    expect(JSON.parse(writes()[1][1][0])[0]).toMatchObject({ status: 'failed', summary: '第二条' });
  });
  it('每次提交使用原子追加和自增SQL', async () => {
    for (let i = 0; i < 3; i++) await invoke({ summary: `反馈${i}` });
    expect(writes()).toHaveLength(3);
    for (const [sql] of writes()) {
      expect(sql).toContain('feedback = feedback || $1::jsonb');
      expect(sql).toContain('feedback_count = feedback_count + 1');
    }
  });
  it('保留可选metrics/artifacts/issues/learnings', async () => {
    const optional = { metrics: { duration_seconds: 100 }, artifacts: { pr_url: 'https://example.invalid/pr/123' }, issues: ['问题'], learnings: ['经验'] };
    expect((await invoke({ summary: '完成', ...optional })).statusCode).toBe(200);
    expect(JSON.parse(writes()[0][1][0])[0]).toMatchObject(optional);
  });
  it('queued任务拒绝反馈且不写库', async () => {
    mockPool.query.mockResolvedValue({ rows: [{ id: 'task-1', status: 'queued' }] });
    const res = await invoke({ summary: '反馈' });
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('INVALID_TASK_STATUS');
    expect(writes()).toHaveLength(0);
  });
  it('数据库写失败返回500，不能伪报成功', async () => {
    mockPool.query.mockImplementation(async sql => {
      if (sql.includes('SELECT id, status, goal_id')) return { rows: [{ id: 'task-1', status: 'in_progress' }] };
      throw new Error('写入失败');
    });
    expect((await invoke({ summary: '反馈' })).statusCode).toBe(500);
  });
});
