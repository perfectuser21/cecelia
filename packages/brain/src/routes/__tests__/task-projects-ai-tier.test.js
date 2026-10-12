import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db.js', () => ({ default: db }));
let app;
const id = '00000000-0000-4000-8000-000000000001';
beforeAll(async () => {
  app = express();
  app.use(express.json());
  app.use('/projects', (await import('../task-projects.js')).default);
});
beforeEach(() => db.query.mockReset());

describe('项目 AI 参与档位', () => {
  it.each(['知情', '盯着', '介入'])('创建时保存档位 %s', async (ai_tier) => {
    db.query.mockResolvedValue({ rows: [{ id, ai_tier }] });
    const response = await request(app).post('/projects').send({ name: '项目', ai_tier });
    expect(response.status).toBe(201);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('ai_tier');
    expect(params).toContain(ai_tier);
    expect(response.body.ai_tier).toBe(ai_tier);
  });
  it('未指定时默认为知情', async () => {
    db.query.mockResolvedValue({ rows: [{ id, ai_tier: '知情' }] });
    expect((await request(app).post('/projects').send({ name: '项目' })).status).toBe(201);
    expect(db.query.mock.calls[0][1]).toContain('知情');
  });
  it.each(['知情', '盯着', '介入'])('更新时保存档位 %s', async (ai_tier) => {
    db.query.mockResolvedValue({ rows: [{ id, ai_tier }] });
    const response = await request(app).patch(`/projects/${id}`).send({ ai_tier });
    expect(response.status).toBe(200);
    expect(db.query.mock.calls[0][0]).toContain('ai_tier = $1');
    expect(db.query.mock.calls[0][1]).toEqual([ai_tier, id]);
  });
  for (const method of ['post', 'patch']) {
    it.each(['invalid', '', null, 1, {}, ['知情']])(`${method} 非法档位 %j 返回 400 且不查库`, async (ai_tier) => {
      const response = await request(app)[method](method === 'post' ? '/projects' : `/projects/${id}`)
        .send({ name: '项目', ai_tier });
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('invalid_ai_tier');
      expect(db.query).not.toHaveBeenCalled();
    });
  }
  it('更新其他字段时保留档位', async () => {
    db.query.mockResolvedValue({ rows: [{ id, name: '新名称', ai_tier: '介入' }] });
    expect((await request(app).patch(`/projects/${id}`).send({ name: '新名称' })).status).toBe(200);
    expect(db.query.mock.calls[0][0]).not.toContain('ai_tier');
  });
});
