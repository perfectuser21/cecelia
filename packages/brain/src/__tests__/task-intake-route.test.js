import { beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'node:fs';

let createTaskIntakeRouter;
beforeAll(async () => {
  ({ createTaskIntakeRouter } = await import('../routes/task-intake.js').catch(() => ({})));
  expect(createTaskIntakeRouter, '必须接入真实HTTP路由').toBeTypeOf('function');
});
describe('task-intake HTTP契约', () => {
  it.each([201, 200, 400, 409, 422, 502, 503])('原样传播服务状态 %s', async (status) => {
    const body = { outcome: 'created', task_id: status === 201 ? 'real-task' : null };
    const intake = vi.fn(async () => ({ status, body }));
    const app = express().use(express.json()).use('/api/brain/task-intake', createTaskIntakeRouter({ intake }));
    const response = await request(app).post('/api/brain/task-intake')
      .set('x-tenant-id', 'team-a').send({ text: '调研设计方案', source_id: 'one' });
    expect(response.status).toBe(status);
    expect(response.body).toEqual(body);
    expect(intake).toHaveBeenCalledWith({ text: '调研设计方案', source_id: 'one' }, { tenantId: 'team-a' });
  });
  it('缺省租户采用现有default入口规则', async () => {
    const intake = vi.fn(async () => ({ status: 400, body: {} }));
    const app = express().use(express.json()).use(createTaskIntakeRouter({ intake }));
    await request(app).post('/').send({ text: '任务', source_id: 'one' });
    expect(intake.mock.calls[0][1]).toEqual({ tenantId: 'default' });
  });
  it('server.js实际挂载入口', () => {
    const server = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
    expect(server).toContain("import taskIntakeRoutes from './src/routes/task-intake.js'");
    expect(server).toContain("app.use('/api/brain/task-intake', taskIntakeRoutes)");
  });
});
