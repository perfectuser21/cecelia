import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const pool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db.js', () => ({ default: pool }));
import router from '../session-provenance.js';

const app = express();
app.use(express.json());
app.use('/session-provenance', router);
const sample = { session_id: 'session-123', kind: 'machine', launched_by: 'cecelia-run', task_id: null };

describe('会话出处 API', () => {
  beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('CECELIA_INTERNAL_TOKEN', ''); });
  afterEach(() => vi.unstubAllEnvs());

  it('生产未配认证拒绝写入，即使来自loopback', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect((await request(app).post('/session-provenance').send(sample)).status).toBe(503);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it.each(['', 'wrong-token'])('缺失或错误认证不能自标human：%s', async token => {
    vi.stubEnv('CECELIA_INTERNAL_TOKEN', 'route-auth-fixture');
    const res = await request(app).post('/session-provenance')
      .set('Authorization', `Bearer ${token}`).set('X-Forwarded-For', '127.0.0.1')
      .send({ ...sample, kind: 'human' });
    expect(res.status).toBe(401);
    expect(pool.query).not.toHaveBeenCalled();
    expect(JSON.stringify(res.body)).not.toContain('route-auth-fixture');
  });

  it('正确服务认证后才允许登记human', async () => {
    vi.stubEnv('CECELIA_INTERNAL_TOKEN', 'route-auth-fixture');
    pool.query.mockResolvedValueOnce({ rows: [{ ...sample, kind: 'human' }] });
    const res = await request(app).post('/session-provenance')
      .set('Authorization', 'Bearer route-auth-fixture').send({ ...sample, kind: 'human' });
    expect(res.status).toBe(201);
    expect(pool.query.mock.calls[0][1][1]).toBe('human');
  });

  it('登记经参数绑定写入既有表，返回数据库读回', async () => {
    pool.query.mockResolvedValueOnce({ rows: [sample] });
    const res = await request(app).post('/session-provenance').send(sample);
    expect(res.status).toBe(201);
    expect(res.body).toEqual(sample);
    expect(pool.query.mock.calls[0][0]).toContain('ON CONFLICT (session_id) DO NOTHING');
    expect(pool.query.mock.calls[0][1]).toEqual(['session-123', 'machine', 'cecelia-run', null]);
  });

  it('重复登记保留原始出处，不允许 machine 被改成 human', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [sample] });
    const res = await request(app).post('/session-provenance').send({ ...sample, kind: 'human' });
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('machine');
  });

  it.each([
    {}, { ...sample, session_id: '' }, { ...sample, session_id: '../secret' },
    { ...sample, kind: 'robot' }, { ...sample, launched_by: '/tmp/token' },
    { ...sample, task_id: 'not-uuid' }, { ...sample, transcript: 'private text' },
  ])('拒绝不完整或非出处字段 %j', async (body) => {
    expect((await request(app).post('/session-provenance').send(body)).status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('按 session_id 读取实际记录，不存在返回 404', async () => {
    pool.query.mockResolvedValueOnce({ rows: [sample] }).mockResolvedValueOnce({ rows: [] });
    expect((await request(app).get('/session-provenance/session-123')).body).toEqual(sample);
    expect((await request(app).get('/session-provenance/missing')).status).toBe(404);
  });

  it('数据库异常不向响应泄露连接或 SQL 内容', async () => {
    pool.query.mockRejectedValue(new Error('postgres://secret@database'));
    const res = await request(app).post('/session-provenance').send(sample);
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });
});
