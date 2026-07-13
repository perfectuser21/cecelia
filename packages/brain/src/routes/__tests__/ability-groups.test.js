import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

async function makeApp() {
  const { default: router } = await import('../ability-groups.js');
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/brain', router);
  return app;
}
const req = async () => (await import('supertest')).default;

const JID = '11111111-1111-1111-1111-111111111111';
const GID = '22222222-2222-2222-2222-222222222222';
const GROUP_ROW = { id: GID, journey_id: JID, name: '微信客户沟通', notion_id: null };

describe('ability-groups routes（能力轴 L2 子领域 CRUD）', () => {
  beforeEach(() => mockQuery.mockReset());

  describe('GET /ability-groups', () => {
    it('无参返回全量列表', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [GROUP_ROW] });
      const res = await (await req())(await makeApp()).get('/api/brain/ability-groups');
      expect(res.status).toBe(200);
      expect(res.body.ability_groups).toHaveLength(1);
      expect(mockQuery.mock.calls[0][0]).toMatch(/FROM ability_groups/);
    });

    it('?journey_id= 过滤且参数化', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const res = await (await req())(await makeApp()).get(`/api/brain/ability-groups?journey_id=${JID}`);
      expect(res.status).toBe(200);
      expect(mockQuery.mock.calls[0][0]).toMatch(/WHERE journey_id = \$1/);
      expect(mockQuery.mock.calls[0][1]).toEqual([JID]);
    });

    it('非法 journey_id 返回 400', async () => {
      const res = await (await req())(await makeApp()).get('/api/brain/ability-groups?journey_id=bogus');
      expect(res.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe('POST /ability-groups', () => {
    it('建子领域返回 201', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [GROUP_ROW] });
      const res = await (await req())(await makeApp())
        .post('/api/brain/ability-groups')
        .send({ name: '微信客户沟通', journey_id: JID });
      expect(res.status).toBe(201);
      expect(res.body.ability_group.name).toBe('微信客户沟通');
      expect(mockQuery.mock.calls[0][0]).toMatch(/INSERT INTO ability_groups/);
      expect(mockQuery.mock.calls[0][1]).toEqual(['微信客户沟通', JID]);
    });

    it('缺 name 返回 400', async () => {
      const res = await (await req())(await makeApp())
        .post('/api/brain/ability-groups').send({ journey_id: JID });
      expect(res.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('非法 journey_id 返回 400', async () => {
      const res = await (await req())(await makeApp())
        .post('/api/brain/ability-groups').send({ name: 'x', journey_id: 'bogus' });
      expect(res.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('journey_id 可空（无 journey_id 也能建）', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ ...GROUP_ROW, journey_id: null }] });
      const res = await (await req())(await makeApp())
        .post('/api/brain/ability-groups').send({ name: '未归属子领域' });
      expect(res.status).toBe(201);
      expect(mockQuery.mock.calls[0][1]).toEqual(['未归属子领域', null]);
    });

    it('同域重名（唯一约束 23505）返回 409', async () => {
      mockQuery.mockRejectedValueOnce({ code: '23505' });
      const res = await (await req())(await makeApp())
        .post('/api/brain/ability-groups').send({ name: '微信客户沟通', journey_id: JID });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('DUPLICATE_NAME');
    });

    it('journey_id 不存在（FK 违反 23503）返回 400', async () => {
      mockQuery.mockRejectedValueOnce({ code: '23503' });
      const res = await (await req())(await makeApp())
        .post('/api/brain/ability-groups').send({ name: 'x', journey_id: JID });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_JOURNEY');
    });
  });

  describe('PATCH /ability-groups/:id', () => {
    it('改名返回 200', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ ...GROUP_ROW, name: '改后名字' }] });
      const res = await (await req())(await makeApp())
        .patch(`/api/brain/ability-groups/${GID}`).send({ name: '改后名字' });
      expect(res.status).toBe(200);
      expect(res.body.ability_group.name).toBe('改后名字');
      expect(mockQuery.mock.calls[0][0]).toMatch(/UPDATE ability_groups SET name/);
    });

    it('非法 id 返回 400', async () => {
      const res = await (await req())(await makeApp())
        .patch('/api/brain/ability-groups/bogus').send({ name: 'x' });
      expect(res.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('缺 name 返回 400', async () => {
      const res = await (await req())(await makeApp())
        .patch(`/api/brain/ability-groups/${GID}`).send({});
      expect(res.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('不存在返回 404', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const res = await (await req())(await makeApp())
        .patch(`/api/brain/ability-groups/${GID}`).send({ name: 'x' });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('GROUP_NOT_FOUND');
    });
  });

  describe('DELETE /ability-groups/:id', () => {
    it('删除返回 200', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: GID }] });
      const res = await (await req())(await makeApp())
        .delete(`/api/brain/ability-groups/${GID}`);
      expect(res.status).toBe(200);
      expect(res.body.deleted_id).toBe(GID);
      expect(mockQuery.mock.calls[0][0]).toMatch(/DELETE FROM ability_groups/);
    });

    it('非法 id 返回 400', async () => {
      const res = await (await req())(await makeApp())
        .delete('/api/brain/ability-groups/bogus');
      expect(res.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('不存在返回 404', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const res = await (await req())(await makeApp())
        .delete(`/api/brain/ability-groups/${GID}`);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('GROUP_NOT_FOUND');
    });
  });
});
