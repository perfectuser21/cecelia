/**
 * task-get-invalid-id.test.js
 * 回归测试 GET /api/brain/tasks/:id：
 *   非 UUID id → 400，不查库、不透出 PG 原始报错；合法 UUID 保持 404 / 200。
 */

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const MISSING_ID = '00000000-0000-4000-8000-000000000000';
const UPPER_ID = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';

async function buildApp(queryImpl = async () => ({ rows: [] })) {
  const mockPool = { query: vi.fn(queryImpl) };

  vi.doMock('../db.js', () => ({ default: mockPool }));
  vi.resetModules();
  const router = (await import('../routes/task-tasks.js')).default;

  const app = express();
  app.use(express.json());
  app.use('/api/brain/tasks', router);
  return { app, mockPool };
}

describe('GET /api/brain/tasks/:id — 非法 id 返回 400', () => {
  it('not-a-uuid → 400，不查库，不透出 PG 报错', async () => {
    const { app, mockPool } = await buildApp();
    const res = await request(app).get('/api/brain/tasks/not-a-uuid');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain('invalid input syntax');
    expect(mockPool.query).toHaveBeenCalledTimes(0);
  });

  it('%20 → 400，不查库，不含 uuid 类型报错', async () => {
    const { app, mockPool } = await buildApp();
    const res = await request(app).get('/api/brain/tasks/%20');
    expect(res.status).toBe(400);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('invalid input syntax');
    expect(body).not.toContain('for type uuid');
    expect(mockPool.query).toHaveBeenCalledTimes(0);
  });

  it('兜底：PG 抛 22P02 → 400，不带 details', async () => {
    const { app } = await buildApp(async () => {
      throw Object.assign(new Error('invalid input syntax for type uuid: "x"'), { code: '22P02' });
    });
    const res = await request(app).get(`/api/brain/tasks/${MISSING_ID}`);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain('invalid input syntax');
    expect(res.body.details).toBeUndefined();
  });
});

describe('GET /api/brain/tasks/:id — 合法 UUID 行为不变', () => {
  it('查不到 → 404 Task not found，按该 UUID 查库 1 次', async () => {
    const { app, mockPool } = await buildApp(async () => ({ rows: [] }));
    const res = await request(app).get(`/api/brain/tasks/${MISSING_ID}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Task not found');
    expect(mockPool.query).toHaveBeenCalledTimes(1);
    expect(mockPool.query.mock.calls[0][1]).toEqual([MISSING_ID]);
  });

  it('查到 → 200 返回该行', async () => {
    const { app } = await buildApp(async () => ({ rows: [{ id: MISSING_ID, title: 't' }] }));
    const res = await request(app).get(`/api/brain/tasks/${MISSING_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(MISSING_ID);
  });

  it('大写 UUID 不被判为非法', async () => {
    const { app } = await buildApp(async () => ({ rows: [] }));
    const res = await request(app).get(`/api/brain/tasks/${UPPER_ID}`);
    expect(res.status).not.toBe(400);
  });
});

// PR#6139 QA X-2：/chain 收到非法 id 时返回 500 并透出 PG 报错
describe('GET /api/brain/tasks/:id/chain — 非法 id 返回 400', () => {
  it('not-a-uuid/chain → 400，不查库，不透出 PG 报错', async () => {
    const { app, mockPool } = await buildApp(async () => {
      throw Object.assign(new Error('invalid input syntax for type uuid: "not-a-uuid"'), { code: '22P02' });
    });
    const res = await request(app).get('/api/brain/tasks/not-a-uuid/chain');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain('invalid input syntax');
    expect(res.body.details).toBeUndefined();
    expect(mockPool.query).toHaveBeenCalledTimes(0);
  });

  it('合法但不存在的 UUID → 仍走查库，返回 404', async () => {
    const { app, mockPool } = await buildApp(async () => ({ rows: [] }));
    const res = await request(app).get(`/api/brain/tasks/${MISSING_ID}/chain`);
    expect(res.status).toBe(404);
    expect(mockPool.query).toHaveBeenCalled();
  });
});
