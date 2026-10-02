/**
 * execution-callback-await.test.js
 *
 * 验证行为：/execution-callback 路由在 callback_queue INSERT 全部失败时
 * 返回 HTTP 503，而非 200。
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock pool
const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../../packages/brain/src/db.js', () => ({ default: { query: mockQuery } }));

vi.mock('../../packages/brain/src/tick.js', () => ({
  runTickSafe: vi.fn(),
  getTickStatus: vi.fn(),
}));
vi.mock('../../packages/brain/src/templates.js', () => ({}));
vi.mock('../../packages/brain/src/decision.js', () => ({}));
vi.mock('../../packages/brain/src/planner.js', () => ({}));
vi.mock('../../packages/brain/src/thalamus.js', () => ({ processEvent: vi.fn(), EVENT_TYPES: {} }));
vi.mock('../../packages/brain/src/decision-executor.js', () => ({ executeDecision: vi.fn() }));
vi.mock('../../packages/brain/src/embedding-service.js', () => ({ generateTaskEmbeddingAsync: vi.fn() }));
vi.mock('../../packages/brain/src/events/taskEvents.js', () => ({
  publishTaskCompleted: vi.fn(),
  publishTaskFailed: vi.fn(),
}));
vi.mock('../../packages/brain/src/event-bus.js', () => ({ emit: vi.fn() }));
vi.mock('../../packages/brain/src/circuit-breaker.js', () => ({
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
}));
vi.mock('../../packages/brain/src/notifier.js', () => ({ notifyTaskCompleted: vi.fn() }));
vi.mock('../../packages/brain/src/callback-processor.js', () => ({
  processCallback: vi.fn().mockResolvedValue({ updated: true }),
}));

let app;

beforeAll(async () => {
  vi.resetModules();
  const { default: executionRouter } = await import('../../packages/brain/src/routes/execution.js');
  app = express();
  app.use(express.json());
  app.use('/api/brain', executionRouter);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('/execution-callback — callback_queue INSERT 行为', () => {
  it('INSERT 全部失败 → 返回 503', { timeout: 15000 }, async () => {
    mockQuery.mockRejectedValue(new Error('DB unavailable'));

    const res = await request(app)
      .post('/api/brain/execution-callback')
      .send({
        task_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        status: 'success',
        exit_code: 0,
      });

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    // 所有权先查；queue INSERT 仍是初始 + 3 retry，不能把 owner 查询算作 INSERT。
    expect(mockQuery.mock.calls[0][0]).toContain("payload->'headed_takeover'");
    const inserts=mockQuery.mock.calls.filter(([sql])=>sql.includes('INSERT INTO callback_queue'));
    expect(inserts).toHaveLength(4);
    expect(mockQuery).toHaveBeenCalledTimes(5);
  });

  it('owner读取失败时failclosed，不能写callback_queue或继续副作用',async()=>{
    mockQuery.mockRejectedValue(new Error('owner lookup unavailable'));
    const res=await request(app).post('/api/brain/execution-callback').send({task_id:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',status:'success'});
    expect(res.status).toBe(500);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).toContain("payload->'headed_takeover'");
    expect(mockQuery.mock.calls.some(([sql])=>sql.includes('INSERT INTO callback_queue'))).toBe(false);
  });

  it('task_id 缺失 → 400（不触发 INSERT）', async () => {
    const res = await request(app)
      .post('/api/brain/execution-callback')
      .send({ status: 'success' });

    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
