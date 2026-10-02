import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createWorkflowAuthoringRouter } from './workflow-authoring.js';

const id = '11111111-1111-4111-8111-111111111111';
const token = 'authoring-route-test-token';
let db;
let app;
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('CECELIA_INTERNAL_TOKEN', token);
  db = { query: vi.fn().mockResolvedValue({ rows: [] }) };
  app = express();
  app.use(express.json());
  app.use('/api/brain/workflow-authoring', createWorkflowAuthoringRouter({ db }));
});
afterEach(() => vi.unstubAllEnvs());

describe('workflow-authoring HTTP鉴权与业务错误', () => {
  it('生产未配置token返回503，即使来自loopback也不接触数据库', async () => {
    vi.stubEnv('CECELIA_INTERNAL_TOKEN', '');
    const res = await request(app).get(`/api/brain/workflow-authoring/runs/${id}`);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('INTERNAL_AUTH_NOT_CONFIGURED');
    expect(db.query).not.toHaveBeenCalled();
  });
  it.each([undefined, 'wrong-token'])('缺失或错误token返回401', async (value) => {
    const req = request(app).get(`/api/brain/workflow-authoring/runs/${id}`);
    if (value) req.set('Authorization', `Bearer ${value}`);
    const res = await req;
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(db.query).not.toHaveBeenCalled();
  });
  it('正确token进入真实业务，未知任务返回404', async () => {
    const res = await request(app).get(`/api/brain/workflow-authoring/runs/${id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('任务不存在');
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('FROM tasks'), [id]);
  });
  it('正确X-Internal-Token进入真实业务，普通任务返回409', async () => {
    db.query.mockResolvedValue({ rows: [{ id, payload: {}, result: {} }] });
    const res = await request(app).get(`/api/brain/workflow-authoring/runs/${id}`)
      .set('X-Internal-Token', token);
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('未声明');
  });
  it('数据库异常返回500且不泄露底层异常内容', async () => {
    db.query.mockRejectedValue(new Error('敏感连接信息'));
    const res = await request(app).get(`/api/brain/workflow-authoring/runs/${id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('敏感连接信息');
  });
});
