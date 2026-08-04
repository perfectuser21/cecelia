/**
 * regression: capture→立项去向链
 * Migration 386 新增 dest_type/dest_id 字段；PATCH 端点写入，GET 端点读出。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockQuery = vi.fn();
vi.mock('../db.js', () => ({ default: { query: (...a) => mockQuery(...a) } }));

async function buildApp() {
  const { default: capturesRouter } = await import('../routes/captures.js');
  const app = express();
  app.use(express.json());
  app.use('/api/brain/captures', capturesRouter);
  return app;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('PATCH /api/brain/captures/:id — dest_type/dest_id 写入', () => {
  it('有效 dest_type=task + dest_id → 200 返回更新行', async () => {
    const destId = '11111111-1111-1111-1111-111111111111';
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'cap-1', status: 'done', dest_type: 'task', dest_id: destId, updated_at: new Date() }],
    });
    const app = await buildApp();
    const res = await request(app)
      .patch('/api/brain/captures/cap-1')
      .send({ status: 'done', dest_type: 'task', dest_id: destId });

    expect(res.status).toBe(200);
    expect(res.body.dest_type).toBe('task');
    expect(res.body.dest_id).toBe(destId);
  });

  it('无效 dest_type → 400', async () => {
    const app = await buildApp();
    const res = await request(app)
      .patch('/api/brain/captures/cap-2')
      .send({ dest_type: 'invalid_type', dest_id: '22222222-2222-2222-2222-222222222222' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/dest_type/);
  });

  it('有 dest_id 但无 dest_type → 400', async () => {
    const app = await buildApp();
    const res = await request(app)
      .patch('/api/brain/captures/cap-3')
      .send({ dest_id: '33333333-3333-3333-3333-333333333333' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/dest_type/);
  });

  it('capture 不存在 → 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const app = await buildApp();
    const res = await request(app)
      .patch('/api/brain/captures/nonexistent')
      .send({ status: 'done' });

    expect(res.status).toBe(404);
  });

  it('dest_type=initiative 合法', async () => {
    const destId = '44444444-4444-4444-4444-444444444444';
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'cap-4', status: 'done', dest_type: 'initiative', dest_id: destId, updated_at: new Date() }],
    });
    const app = await buildApp();
    const res = await request(app)
      .patch('/api/brain/captures/cap-4')
      .send({ dest_type: 'initiative', dest_id: destId });

    expect(res.status).toBe(200);
    expect(res.body.dest_type).toBe('initiative');
  });

  it('空 body → 400（无字段可更新）', async () => {
    const app = await buildApp();
    const res = await request(app)
      .patch('/api/brain/captures/cap-5')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no fields/);
  });
});

describe('GET /api/brain/captures/:id — 返回 dest_type/dest_id', () => {
  it('已设置去向的 capture 详情含 dest_type/dest_id', async () => {
    const destId = '55555555-5555-5555-5555-555555555555';
    // 第一次 query → captures 行；第二次 query → atoms
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'cap-6', content: 'test', source: 'api', nature: null,
          repo: null, lane: null, ref_task_id: null, ref_journey_id: null,
          ref_pr_url: null, dedupe_key: null,
          status: 'done', dest_type: 'task', dest_id: destId,
          created_at: new Date(), updated_at: new Date(),
        }],
      })
      .mockResolvedValueOnce({ rows: [] }); // atoms

    const app = await buildApp();
    const res = await request(app).get('/api/brain/captures/cap-6');

    expect(res.status).toBe(200);
    expect(res.body.dest_type).toBe('task');
    expect(res.body.dest_id).toBe(destId);
  });
});
