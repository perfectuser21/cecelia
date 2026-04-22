/**
 * task-api-prd-fallback.test.js
 * 测试 POST /api/brain/tasks description fallback 链：
 *   description > payload.prd_summary > prd
 */

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

async function buildApp(capturedInserts) {
  const mockPool = {
    query: vi.fn(async (sql, params) => {
      if (sql.includes('INSERT INTO tasks')) {
        capturedInserts.push({ sql, params });
        return { rows: [{ id: 'test-id', title: params[0], status: 'queued', task_type: params[3], priority: params[2] }] };
      }
      return { rows: [] };
    }),
  };

  vi.doMock('../db.js', () => ({ default: mockPool }));
  vi.resetModules();
  const router = (await import('../routes/task-tasks.js')).default;

  const app = express();
  app.use(express.json());
  app.use('/api/brain/tasks', router);
  return app;
}

describe('POST /api/brain/tasks — description fallback 3 层', () => {
  it('场景 1: prd 字段 fallback → description', async () => {
    const inserts = [];
    const app = await buildApp(inserts);
    const res = await request(app)
      .post('/api/brain/tasks/')
      .send({
        title: 'smoke',
        task_type: 'dev',
        priority: 'P2',
        prd: '这是通过 prd 字段传入的 PRD 内容，至少 20 字符。',
      });
    expect(res.status).toBe(201);
    expect(inserts.length).toBe(1);
    expect(inserts[0].params[1]).toContain('prd 字段传入');
  });

  it('场景 2: description 显式传入时优先于 prd', async () => {
    const inserts = [];
    const app = await buildApp(inserts);
    const res = await request(app)
      .post('/api/brain/tasks/')
      .send({
        title: 'smoke',
        task_type: 'dev',
        priority: 'P2',
        description: 'EXPLICIT_DESC',
        prd: 'SHOULD_NOT_WIN',
      });
    expect(res.status).toBe(201);
    expect(inserts[0].params[1]).toBe('EXPLICIT_DESC');
  });

  it('场景 3: payload.prd_summary fallback 原路径无回归', async () => {
    const inserts = [];
    const app = await buildApp(inserts);
    const res = await request(app)
      .post('/api/brain/tasks/')
      .send({
        title: 'smoke',
        task_type: 'dev',
        priority: 'P2',
        payload: { prd_summary: 'FROM_PAYLOAD' },
      });
    expect(res.status).toBe(201);
    expect(inserts[0].params[1]).toBe('FROM_PAYLOAD');
  });

  it('场景 4: prd_summary 优先于 prd（中间层优先）', async () => {
    const inserts = [];
    const app = await buildApp(inserts);
    const res = await request(app)
      .post('/api/brain/tasks/')
      .send({
        title: 'smoke',
        task_type: 'dev',
        priority: 'P2',
        payload: { prd_summary: 'WINS' },
        prd: 'LOSES',
      });
    expect(res.status).toBe(201);
    expect(inserts[0].params[1]).toBe('WINS');
  });
});
