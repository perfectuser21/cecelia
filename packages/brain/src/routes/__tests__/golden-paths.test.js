import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

async function makeApp() {
  const { default: router } = await import('../golden-paths.js');
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/brain', router);
  return app;
}
const req = async () => (await import('supertest')).default;

const GP_ROW = { id: 'gp-1', title: '朋友圈GP', one_liner: '一句话', status: 'candidate', source: 'strategist' };

describe('golden-paths routes（GP 蓝图级实体，区别于既有 golden_path FR 台账）', () => {
  beforeEach(() => mockQuery.mockReset());

  describe('GET /golden-paths', () => {
    it('无参返回全量列表', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [GP_ROW] });
      const res = await (await req())(await makeApp()).get('/api/brain/golden-paths');
      expect(res.status).toBe(200);
      expect(res.body.golden_paths).toHaveLength(1);
      expect(mockQuery.mock.calls[0][0]).toMatch(/FROM golden_paths/);
    });

    it('?status= 过滤且参数化', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const res = await (await req())(await makeApp()).get('/api/brain/golden-paths?status=candidate');
      expect(res.status).toBe(200);
      expect(mockQuery.mock.calls[0][0]).toMatch(/WHERE status = \$1/);
      expect(mockQuery.mock.calls[0][1]).toEqual(['candidate']);
    });

    it('非法 status 返回 400', async () => {
      const res = await (await req())(await makeApp()).get('/api/brain/golden-paths?status=bogus');
      expect(res.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe('POST /golden-paths', () => {
    it('建 candidate 返回 201，默认 source=strategist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [GP_ROW] });
      const res = await (await req())(await makeApp())
        .post('/api/brain/golden-paths')
        .send({ title: '朋友圈GP', one_liner: '一句话' });
      expect(res.status).toBe(201);
      expect(res.body.golden_path.status).toBe('candidate');
      expect(mockQuery.mock.calls[0][0]).toMatch(/INSERT INTO golden_paths/);
    });

    it('缺 title/one_liner 返回 400', async () => {
      const res = await (await req())(await makeApp())
        .post('/api/brain/golden-paths').send({ title: '只有标题' });
      expect(res.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('非法 source 返回 400', async () => {
      const res = await (await req())(await makeApp())
        .post('/api/brain/golden-paths')
        .send({ title: 't', one_liner: 'o', source: 'hacker' });
      expect(res.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /golden-paths/:id 状态机', () => {
    it('合法流转 candidate→proposed 返回 200', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'candidate' }] });
      mockQuery.mockResolvedValueOnce({ rows: [{ ...GP_ROW, status: 'proposed' }] });
      const res = await (await req())(await makeApp())
        .patch('/api/brain/golden-paths/gp-1').send({ status: 'proposed' });
      expect(res.status).toBe(200);
      expect(res.body.golden_path.status).toBe('proposed');
    });

    it('非法流转 candidate→delivered 返回 409 INVALID_TRANSITION 且回传 allowed', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'candidate' }] });
      const res = await (await req())(await makeApp())
        .patch('/api/brain/golden-paths/gp-1').send({ status: 'delivered' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('INVALID_TRANSITION');
      expect(res.body.allowed).toEqual(['proposed', 'rejected', 'superseded', 'blocked_gate']);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('superseded 是终态，任何流转 409', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'superseded' }] });
      const res = await (await req())(await makeApp())
        .patch('/api/brain/golden-paths/gp-1').send({ status: 'candidate' });
      expect(res.status).toBe(409);
      expect(res.body.allowed).toEqual([]);
    });

    it('不存在返回 404', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const res = await (await req())(await makeApp())
        .patch('/api/brain/golden-paths/nope').send({ status: 'proposed' });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('GP_NOT_FOUND');
    });

    it('流转到 approved 自动注入 approved_at 与默认 review_after(+14d)', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'converged' }] });
      mockQuery.mockResolvedValueOnce({ rows: [{ ...GP_ROW, status: 'approved' }] });
      const res = await (await req())(await makeApp())
        .patch('/api/brain/golden-paths/gp-1').send({ status: 'approved' });
      expect(res.status).toBe(200);
      const updateSql = mockQuery.mock.calls[1][0];
      expect(updateSql).toMatch(/approved_at = now\(\)/);
      expect(updateSql).toMatch(/review_after = now\(\) \+ interval '14 days'/);
    });

    it('非状态字段更新（status_reason）不需要 status', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'candidate' }] });
      mockQuery.mockResolvedValueOnce({ rows: [{ ...GP_ROW, status_reason: 'x' }] });
      const res = await (await req())(await makeApp())
        .patch('/api/brain/golden-paths/gp-1').send({ status_reason: 'x' });
      expect(res.status).toBe(200);
    });

    it('空 body 返回 400', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'candidate' }] });
      const res = await (await req())(await makeApp())
        .patch('/api/brain/golden-paths/gp-1').send({});
      expect(res.status).toBe(400);
    });
  });
});
