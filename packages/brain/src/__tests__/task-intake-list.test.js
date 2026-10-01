import { beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createTaskIntakeRouter } from '../routes/task-intake.js';

let createTaskIntakeList;
beforeAll(async () => {
  ({ createTaskIntakeList } = await import('../task-intake.js'));
  expect(createTaskIntakeList, '必须从真实收据查询租户交办历史').toBeTypeOf('function');
});
describe('交办历史', () => {
  it.each(['0', '-1', '51', '1.2', '20abc', '', ['2'], null])('非法limit %j返回400', async (limit) => {
    const db = { query: vi.fn() };
    expect(await createTaskIntakeList({ db })({ limit }, { tenantId: 'a' })).toMatchObject({ status: 400 });
    expect(db.query).not.toHaveBeenCalled();
  });
  it('查询默认20条，并在SQL中约束租户/交办来源/真实收据', async () => {
    const row = { id: 'task', title: '原始标题', status: 'queued', created_at: '2026-10-01', updated_at: '2026-10-01', completed_at: null };
    const db = { query: vi.fn(async () => ({ rows: [row] })) };
    expect(await createTaskIntakeList({ db })({}, { tenantId: 'a' })).toEqual({ status: 200, body: { tasks: [row] } });
    expect(db.query.mock.calls[0][1]).toEqual(['a', 20]);
    expect(db.query.mock.calls[0][0]).toMatch(/tenant_id/);
    expect(db.query.mock.calls[0][0]).toMatch(/work_routing_receipts/);
    expect(db.query.mock.calls[0][0]).toMatch(/dashboard/);
  });
  it('GET路径传递租户和limit', async () => {
    const listTasks = vi.fn(async () => ({ status: 200, body: { tasks: [] } }));
    const app = express().use('/api/brain/task-intake', createTaskIntakeRouter({ listTasks }));
    const response = await request(app).get('/api/brain/task-intake?limit=10').set('x-tenant-id', 'team-a');
    expect(response.status).toBe(200);
    expect(listTasks).toHaveBeenCalledWith({ limit: '10' }, { tenantId: 'team-a' });
  });
});
