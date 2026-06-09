import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

async function makeApp() {
  const { default: router } = await import('../abilities.js');
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/brain', router);
  return app;
}
const req = async () => (await import('supertest')).default;

describe('abilities routes', () => {
  beforeEach(() => mockQuery.mockReset());

  it('GET /abilities 返回数组', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'a1', name: '抖音视频发布', kind: 'ability' }] });
    const res = await (await req())(await makeApp()).get('/api/brain/abilities');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /abilities 缺 name 返回 400', async () => {
    const res = await (await req())(await makeApp()).post('/api/brain/abilities').send({ area: 'zenithjoy' });
    expect(res.status).toBe(400);
  });

  it('POST /abilities 建一条返回 201', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'area-uuid' }] }); // areas 表查 area_id
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'a2', name: 'X', area_id: 'area-uuid', kind: 'ability' }] }); // INSERT journey_features
    const res = await (await req())(await makeApp()).post('/api/brain/abilities').send({ name: 'X', area: 'zenithjoy' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('X');
    expect(res.body.kind).toBe('ability');
  });

  it('PATCH /abilities/:id 不存在返回 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await (await req())(await makeApp()).patch('/api/brain/abilities/nope').send({ status: 'working' });
    expect(res.status).toBe(404);
  });

  it('GET /golden_path 返回数组（按 order_no）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'g1', order_no: 1, ability_id: 'a1' }] });
    const res = await (await req())(await makeApp()).get('/api/brain/golden_path?scope_type=journey&scope_id=j1');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /golden_path 缺字段返回 400', async () => {
    const res = await (await req())(await makeApp()).post('/api/brain/golden_path').send({ scope_type: 'journey' });
    expect(res.status).toBe(400);
  });


  it('POST /abilities 查 journey_features 而非 abilities（kind 字段必须存在）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'area-uuid' }] }); // areas 查 area_id
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'ab1', name: 'Y', kind: 'feature', area_id: 'area-uuid' }] }); // INSERT
    const res = await (await req())(await makeApp()).post('/api/brain/abilities').send({ name: 'Y', kind: 'feature' });
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe('feature');
  });

  it('DB 报错返回 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db error'));
    const res = await (await req())(await makeApp()).get('/api/brain/abilities');
    expect(res.status).toBe(500);
  });
});
