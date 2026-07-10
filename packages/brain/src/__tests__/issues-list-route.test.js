import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const queryMock = vi.fn();
vi.mock('../db.js', () => ({ default: { query: (...a) => queryMock(...a) } }));

const { default: journeysRouter } = await import('../routes/journeys.js');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain', journeysRouter);
  return app;
}

beforeEach(() => { queryMock.mockReset(); });

describe('GET /api/brain/issues（T6）', () => {
  it('无参：默认 limit 20，返回 {issues:[...]}', async () => {
    queryMock.mockResolvedValue({ rows: [{ id: 'i1', title: 'x', priority: 'P1', status: 'In progress' }] });
    const res = await request(makeApp()).get('/api/brain/issues');
    expect(res.status).toBe(200);
    expect(res.body.issues).toHaveLength(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/FROM issues/);
    expect(sql).toMatch(/ORDER BY priority ASC, created_at DESC/);
    expect(params[params.length - 1]).toBe(20);
  });

  it('status + journey_id 过滤进 WHERE，limit 钳制到 100', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const res = await request(makeApp()).get('/api/brain/issues?status=open&journey_id=j-1&limit=999');
    expect(res.status).toBe(200);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/status=\$1/);
    expect(sql).toMatch(/journey_id=\$2/);
    expect(params).toEqual(['open', 'j-1', 100]);
  });

  it('查询抛错 → 500 + error', async () => {
    queryMock.mockRejectedValue(new Error('boom'));
    const res = await request(makeApp()).get('/api/brain/issues');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('boom');
  });
});
