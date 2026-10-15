import express from 'express';
import request from 'supertest';
import { describe, it, expect, afterEach } from 'vitest';
import { createTreeLegacyLayoutRouter } from '../tree-legacy-layout.js';

const task_id = 'a2b3101f-f76b-4d13-816e-7c42926c2875';
const decision_id = '5155c28c-ce2a-4452-87d4-cefb0362bf34';
const workflow_id = '11111111-1111-4111-8111-111111111111';
const capability_id = '22222222-2222-4222-8222-222222222222';
const target_id = '33333333-3333-4333-8333-333333333333';
const body = { actor: '主会话', task_id, decision_id, client_request_id: 'request-1', changes: [{ workflow_id, expected_capability_id: capability_id, target_capability_id: target_id, expected_active_reference_ids: [], deactivate_reference_ids: [] }] };
const app = express(); app.use(express.json());
app.use('/api/brain/tree', createTreeLegacyLayoutRouter({ pool: { connect: () => { throw Error('不应访问数据库'); } } }));
const post = data => request(app).post('/api/brain/tree/legacy-layout').set('Authorization', 'Bearer test-token').send(data);
afterEach(() => { delete process.env.CECELIA_INTERNAL_TOKEN; });

describe('旧流程改挂入口', () => {
  it('拒绝缺失和错误令牌，且未访问数据库', async () => {
    process.env.CECELIA_INTERNAL_TOKEN = 'test-token';
    expect((await request(app).post('/api/brain/tree/legacy-layout').send(body)).status).toBe(401);
    expect((await request(app).post('/api/brain/tree/legacy-layout').set('Authorization', 'Bearer wrong').send(body)).status).toBe(401);
  });
  it('拒绝无关任务或决策', async () => {
    process.env.CECELIA_INTERNAL_TOKEN = 'test-token';
    expect((await post({ ...body, task_id: workflow_id })).status).toBe(403);
    expect((await post({ ...body, decision_id: workflow_id })).status).toBe(403);
  });
  it.each([
    [{ ...body, unexpected: true }, 400],
    [{ ...body, actor: ' ' }, 400],
    [{ ...body, changes: [] }, 400],
    [{ ...body, changes: Array(21).fill(body.changes[0]) }, 400],
    [{ ...body, changes: [body.changes[0], body.changes[0]] }, 400],
    [{ ...body, changes: [{ ...body.changes[0], workflow_id: 'bad' }] }, 400],
    [{ ...body, changes: [{ ...body.changes[0], name: 'a'.repeat(256) }] }, 400],
    [{ ...body, changes: [{ ...body.changes[0], expected_active_reference_ids: [workflow_id, workflow_id] }] }, 400],
  ])('拒绝非法请求 %#', async (input, status) => {
    process.env.CECELIA_INTERNAL_TOKEN = 'test-token';
    expect((await post(input)).status).toBe(status);
  });
});
