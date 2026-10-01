import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createOnboardingRouter } from '../router.js';
function setup() {
  const service = Object.fromEntries(['create', 'list', 'get', 'retry'].map(k => [k, vi.fn()]));
  const app = express();
  app.use(express.json());
  app.use('/machines/onboarding', createOnboardingRouter(service));
  return { service, app };
}
describe('机器接入 HTTP 边界', () => {
  it('传递幂等键与请求，返回已登记任务', async () => {
    const { service, app } = setup();
    service.create.mockResolvedValue({ id: 'node', status: 'queued' });
    const response = await request(app).post('/machines/onboarding').set('Idempotency-Key', 'key').send({ name: 'cn-node' });
    expect(response.status).toBe(202);
    expect(service.create).toHaveBeenCalledWith({ name: 'cn-node' }, 'key');
    expect(response.body.status).toBe('queued');
  });
  it('列表、读取与重试连接真实服务契约', async () => {
    const { service, app } = setup();
    service.list.mockResolvedValue({ items: [] });
    service.get.mockResolvedValue({ id: 'node', status: 'failed' });
    service.retry.mockResolvedValue({ id: 'node', status: 'queued' });
    expect((await request(app).get('/machines/onboarding')).body).toEqual({ items: [] });
    expect((await request(app).get('/machines/onboarding/node')).body.status).toBe('failed');
    expect((await request(app).post('/machines/onboarding/node/retry')).status).toBe(202);
    expect(service.get).toHaveBeenCalledWith('node');
    expect(service.retry).toHaveBeenCalledWith('node');
  });
  it.each([400, 404, 409, 422])('保留可解释的业务错误 %s', async status => {
    const { service, app } = setup();
    service.create.mockRejectedValue(Object.assign(new Error('接入信息不符合要求'), { status }));
    const response = await request(app).post('/machines/onboarding').send({});
    expect(response.status).toBe(status);
    expect(response.body.error).toBe('接入信息不符合要求');
  });
  it('内部连接异常不泄漏数据库或凭据', async () => {
    const { service, app } = setup();
    service.list.mockRejectedValue(new Error('postgres://secret:password@private-host'));
    const response = await request(app).get('/machines/onboarding');
    expect(response.status).toBe(503);
    expect(response.text).not.toMatch(/secret|password|private-host/);
  });
});
