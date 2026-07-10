/**
 * B1 — executor 白名单 + 组合校验
 * Red 阶段：task-tasks.js 尚无 executor 校验逻辑，测试预期失败。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pool so we don't need a real DB connection
const mockPool = {
  query: vi.fn(),
};

vi.mock('../../../packages/brain/src/db.js', () => ({ default: mockPool }));
vi.mock('../../../packages/brain/src/task-router.js', () => ({
  identifyWorkType: vi.fn(() => ({ domain: 'brain' })),
  getTaskLocation: vi.fn(() => 'us'),
  routeTaskCreate: vi.fn(() => ({})),
  getValidTaskTypes: vi.fn(() => []),
  LOCATION_MAP: {},
  diagnoseKR: vi.fn(),
  detectDomain: vi.fn(() => ({ domain: 'brain' })),
}));
vi.mock('../../../packages/brain/src/actions.js', () => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
}));
vi.mock('../../../packages/brain/src/tick-helpers.js', () => ({
  routeTask: vi.fn(),
  TASK_TYPE_AGENT_MAP: {},
}));
vi.mock('../../../packages/brain/src/executor.js', () => ({
  triggerCeceliaRun: vi.fn(),
  checkCeceliaRunAvailable: vi.fn(() => false),
}));
vi.mock('../../../packages/brain/src/event-bus.js', () => ({
  emit: vi.fn(),
}));
vi.mock('../../../packages/brain/src/events/taskEvents.js', () => ({
  publishTaskCreated: vi.fn(),
}));
vi.mock('../../../packages/brain/src/quarantine.js', () => ({
  getQuarantinedTasks: vi.fn(),
  getQuarantineStats: vi.fn(),
  releaseTask: vi.fn(),
  quarantineTask: vi.fn(),
  QUARANTINE_REASONS: {},
  REVIEW_ACTIONS: {},
}));

import express from 'express';
import request from 'supertest';

describe('B1: executor 白名单校验', () => {
  let app: ReturnType<typeof express>;

  beforeEach(async () => {
    vi.clearAllMocks();
    // mockReset 而非只 clearAllMocks：本文件里前几个测试（executor 校验失败）
    // 从不真正调用 pool.query，若只 clearAllMocks，上一轮排队的 mockResolvedValueOnce
    // 会残留到下一个测试，跟这里新排的队错位。mockReset 连队列一起清空，保证每个
    // 测试都是干净的两次调用（去重 SELECT + INSERT）。
    mockPool.query.mockReset();
    // C3 去重护栏（issue 655691d2）：POST /tasks 现在先跑一次去重 SELECT 再 INSERT。
    // 第一次调用（去重查询）返回空结果（无命中），后续调用（INSERT）沿用原有 mock。
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    mockPool.query.mockResolvedValue({
      rows: [{ id: 'test-uuid-1234', title: 'test', status: 'queued', task_type: 'harness_initiative' }],
    });

    app = express();
    app.use(express.json());
    // Import router after mocks are set up
    const { default: taskTasksRouter } = await import('../../../packages/brain/src/routes/task-tasks.js');
    app.use('/api/brain', taskTasksRouter);
  });

  it('executor=invalid → 400', async () => {
    const res = await request(app)
      .post('/api/brain/')
      .send({
        title: 'test task',
        task_type: 'harness_initiative',
        payload: { orchestrator: 'skill-relay', executor: 'invalid' },
      });

    // This should fail until executor validation is implemented
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/executor must be claude or codex/i);
  });

  it('executor=gemini → 400', async () => {
    const res = await request(app)
      .post('/api/brain/')
      .send({
        title: 'test task',
        task_type: 'harness_initiative',
        payload: { orchestrator: 'skill-relay', executor: 'gemini' },
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/executor must be claude or codex/i);
  });

  it('executor=codex + orchestrator≠skill-relay → 400', async () => {
    const res = await request(app)
      .post('/api/brain/')
      .send({
        title: 'test task',
        task_type: 'harness_initiative',
        payload: { orchestrator: 'langgraph', executor: 'codex' },
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/executor=codex requires orchestrator=skill-relay/i);
  });

  it('executor=codex + orchestrator 缺失 → 400', async () => {
    const res = await request(app)
      .post('/api/brain/')
      .send({
        title: 'test task',
        task_type: 'harness_initiative',
        payload: { executor: 'codex' },
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/executor=codex requires orchestrator=skill-relay/i);
  });

  it('executor=codex + orchestrator=skill-relay → 201 入队', async () => {
    const res = await request(app)
      .post('/api/brain/')
      .send({
        title: 'test codex relay',
        task_type: 'harness_initiative',
        payload: { orchestrator: 'skill-relay', executor: 'codex', journey_id: 'jid-test' },
      });

    expect(res.status).toBe(201);
  });

  it('executor=claude → 201（白名单通过）', async () => {
    const res = await request(app)
      .post('/api/brain/')
      .send({
        title: 'test claude relay',
        task_type: 'harness_initiative',
        payload: { orchestrator: 'skill-relay', executor: 'claude' },
      });

    expect(res.status).toBe(201);
  });

  it('executor 缺失 → 201（向后兼容）', async () => {
    const res = await request(app)
      .post('/api/brain/')
      .send({
        title: 'test no executor',
        task_type: 'harness_initiative',
        payload: { orchestrator: 'skill-relay' },
      });

    expect(res.status).toBe(201);
  });
});
