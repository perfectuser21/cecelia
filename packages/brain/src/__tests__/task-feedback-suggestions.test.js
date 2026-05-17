/**
 * Task Feedback → Suggestions 桥接测试
 *
 * 测试覆盖：
 * - D1: 支持 flat 和 wrapped 两种请求格式
 * - D2: issues_found → suggestions(type=issue, score=0.75)
 * - D3: next_steps_suggested → suggestions(type=next_step, score=0.55)
 * - D4: 幂等性（同一 feedback_id 不重复创建）
 * - D5: status 字段可选（默认 'completed'）
 * - D6: Suggestions 创建失败不影响主流程
 * - D7: 响应包含 suggestions_created 字段
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockPool = { query: vi.fn(), connect: vi.fn() };
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
  calculateSlotBudget: vi.fn().mockReturnValue({ available: 4 }),
}));

// ── App setup ──────────────────────────────────────────────────────────────

let app;

beforeEach(async () => {
  vi.resetModules();
  mockPool.query.mockReset();
  mockPool.connect.mockReset();

  vi.doMock('../db.js', () => ({ default: mockPool }));

  const { default: router } = await import('../routes.js');
  app = express();
  app.use(express.json());
  app.use('/api/brain', router);
});

// ── Helpers ────────────────────────────────────────────────────────────────

/** task 存在，状态 in_progress，带 goal_id */
function mockTaskExists(goalId = 'goal-abc') {
  mockPool.query.mockImplementation(async (sql, params) => {
    if (sql.includes('SELECT id, status, goal_id')) {
      return { rows: [{ id: params[0], status: 'in_progress', goal_id: goalId }] };
    }
    if (sql.includes('UPDATE tasks')) {
      return { rows: [] };
    }
    if (sql.includes('SELECT id FROM suggestions')) {
      return { rows: [] }; // no existing suggestion (not duplicate)
    }
    if (sql.includes('INSERT INTO suggestions')) {
      return { rows: [] };
    }
    return { rows: [] };
  });
}

// ── Tests: D5 status optional ─────────────────────────────────────────────

describe('D5: status 可选', () => {
  it('没有 status 时默认 completed，请求不报错', async () => {
    mockTaskExists();

    const res = await request(app)
      .post('/api/brain/tasks/task-1/feedback')
      .send({ summary: '实现完成', issues_found: [] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('status=completed 正常处理', async () => {
    mockTaskExists();

    const res = await request(app)
      .post('/api/brain/tasks/task-1/feedback')
      .send({ status: 'completed', summary: '实现完成' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('缺少 summary 仍返回 400', async () => {
    const res = await request(app)
      .post('/api/brain/tasks/task-1/feedback')
      .send({ status: 'completed' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_FIELD');
  });
});

// ── Tests: D1 两种格式 ────────────────────────────────────────────────────

describe('D1: 支持 flat 和 wrapped 两种格式', () => {
  it('flat 格式直接字段', async () => {
    mockTaskExists();

    const res = await request(app)
      .post('/api/brain/tasks/task-1/feedback')
      .send({
        summary: '功能实现完成',
        issues_found: ['发现一个 bug'],
        next_steps_suggested: ['增加测试'],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('wrapped 格式 {feedback: {...}}（upload-feedback.sh 发送的格式）', async () => {
    mockTaskExists();

    const res = await request(app)
      .post('/api/brain/tasks/task-1/feedback')
      .send({
        feedback: {
          summary: '功能实现完成',
          issues_found: ['发现一个 bug'],
          next_steps_suggested: ['增加测试'],
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ── Tests: D2/D3 suggestions 创建 ────────────────────────────────────────

describe('D2/D3: issues_found 和 next_steps_suggested → suggestions 表', () => {
  it('issues_found 写入 suggestions(type=issue, score=0.75)', async () => {
    const insertedSuggestions = [];
    mockPool.query.mockImplementation(async (sql, params) => {
      if (sql.includes('SELECT id, status, goal_id')) {
        return { rows: [{ id: params[0], status: 'in_progress', goal_id: 'goal-1' }] };
      }
      if (sql.includes('UPDATE tasks')) return { rows: [] };
      if (sql.includes('SELECT id FROM suggestions')) return { rows: [] };
      if (sql.includes('INSERT INTO suggestions')) {
        insertedSuggestions.push({ content: params[0], score: params[1], type: params[2] });
        return { rows: [] };
      }
      return { rows: [] };
    });

    await request(app)
      .post('/api/brain/tasks/task-1/feedback')
      .send({
        summary: '完成',
        issues_found: ['认证模块有内存泄漏'],
      });

    expect(insertedSuggestions.length).toBe(1);
    expect(insertedSuggestions[0].content).toBe('认证模块有内存泄漏');
    expect(Number(insertedSuggestions[0].score)).toBe(0.75);
    expect(insertedSuggestions[0].type).toBe('issue');
  });

  it('next_steps_suggested 写入 suggestions(type=next_step, score=0.55)', async () => {
    const insertedSuggestions = [];
    mockPool.query.mockImplementation(async (sql, params) => {
      if (sql.includes('SELECT id, status, goal_id')) {
        return { rows: [{ id: params[0], status: 'in_progress', goal_id: 'goal-1' }] };
      }
      if (sql.includes('UPDATE tasks')) return { rows: [] };
      if (sql.includes('SELECT id FROM suggestions')) return { rows: [] };
      if (sql.includes('INSERT INTO suggestions')) {
        insertedSuggestions.push({ content: params[0], score: params[1], type: params[2] });
        return { rows: [] };
      }
      return { rows: [] };
    });

    await request(app)
      .post('/api/brain/tasks/task-1/feedback')
      .send({
        summary: '完成',
        next_steps_suggested: ['增加单元测试覆盖率', '添加 rate limiting'],
      });

    expect(insertedSuggestions.length).toBe(2);
    expect(insertedSuggestions[0].score).toBe(0.55);
    expect(insertedSuggestions[0].type).toBe('next_step');
    expect(insertedSuggestions[1].type).toBe('next_step');
  });

  it('混合 issues + next_steps 同时写入', async () => {
    const insertedSuggestions = [];
    mockPool.query.mockImplementation(async (sql, params) => {
      if (sql.includes('SELECT id, status, goal_id')) {
        return { rows: [{ id: params[0], status: 'in_progress', goal_id: null }] };
      }
      if (sql.includes('UPDATE tasks')) return { rows: [] };
      if (sql.includes('SELECT id FROM suggestions')) return { rows: [] };
      if (sql.includes('INSERT INTO suggestions')) {
        insertedSuggestions.push(params[2]);
        return { rows: [] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .post('/api/brain/tasks/task-1/feedback')
      .send({
        summary: '完成',
        issues_found: ['bug A'],
        next_steps_suggested: ['step B'],
      });

    expect(res.body.suggestions_created).toBe(2);
    expect(insertedSuggestions).toEqual(expect.arrayContaining(['issue', 'next_step']));
  });

  it('空数组不创建 suggestions', async () => {
    mockTaskExists();

    const res = await request(app)
      .post('/api/brain/tasks/task-1/feedback')
      .send({
        summary: '完成',
        issues_found: [],
        next_steps_suggested: [],
      });

    expect(res.status).toBe(200);
    expect(res.body.suggestions_created).toBe(0);
  });

  it('没有 issues_found/next_steps_suggested 时 suggestions_created=0', async () => {
    mockTaskExists();

    const res = await request(app)
      .post('/api/brain/tasks/task-1/feedback')
      .send({ summary: '完成' });

    expect(res.body.suggestions_created).toBe(0);
  });
});

// ── Tests: D4 幂等性 ──────────────────────────────────────────────────────

describe('D4: 幂等性 — 同一 feedback_id 不重复写入', () => {
  it('已存在相同 feedback_id + content 时跳过 INSERT', async () => {
    let insertCount = 0;
    mockPool.query.mockImplementation(async (sql, params) => {
      if (sql.includes('SELECT id, status, goal_id')) {
        return { rows: [{ id: params[0], status: 'in_progress', goal_id: null }] };
      }
      if (sql.includes('UPDATE tasks')) return { rows: [] };
      if (sql.includes('SELECT id FROM suggestions')) {
        // 模拟已存在
        return { rows: [{ id: 'existing-sug-id' }] };
      }
      if (sql.includes('INSERT INTO suggestions')) {
        insertCount++;
        return { rows: [] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .post('/api/brain/tasks/task-1/feedback')
      .send({
        summary: '完成',
        issues_found: ['重复的 bug'],
      });

    expect(res.status).toBe(200);
    // 因为已存在，不应该 INSERT
    expect(insertCount).toBe(0);
    expect(res.body.suggestions_created).toBe(0);
  });
});

// ── Tests: D6 best-effort ─────────────────────────────────────────────────

describe('D6: suggestions 创建失败不影响主流程', () => {
  it('suggestions INSERT 抛异常时，主 feedback 仍返回 success:true', async () => {
    let taskUpdateCalled = false;
    mockPool.query.mockImplementation(async (sql, params) => {
      if (sql.includes('SELECT id, status, goal_id')) {
        return { rows: [{ id: params[0], status: 'in_progress', goal_id: null }] };
      }
      if (sql.includes('UPDATE tasks')) {
        taskUpdateCalled = true;
        return { rows: [] };
      }
      if (sql.includes('SELECT id FROM suggestions')) {
        throw new Error('DB connection lost');
      }
      return { rows: [] };
    });

    const res = await request(app)
      .post('/api/brain/tasks/task-1/feedback')
      .send({
        summary: '完成',
        issues_found: ['bug'],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(taskUpdateCalled).toBe(true);
  });
});

// ── Tests: D7 responses_created in response ───────────────────────────────

describe('D7: 响应包含 suggestions_created 字段', () => {
  it('response 有 suggestions_created 字段', async () => {
    mockTaskExists();

    const res = await request(app)
      .post('/api/brain/tasks/task-1/feedback')
      .send({ summary: '完成' });

    expect(res.body).toHaveProperty('suggestions_created');
    expect(typeof res.body.suggestions_created).toBe('number');
  });

  it('response 有 feedback_id 字段', async () => {
    mockTaskExists();

    const res = await request(app)
      .post('/api/brain/tasks/task-1/feedback')
      .send({ summary: '完成' });

    expect(res.body).toHaveProperty('feedback_id');
    expect(res.body).toHaveProperty('received_at');
  });
});
