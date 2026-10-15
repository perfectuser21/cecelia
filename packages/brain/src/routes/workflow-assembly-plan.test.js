import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createWorkflowAuthoringRouter } from './workflow-authoring.js';

const id = '11111111-1111-4111-8111-111111111111';
const token = 'assembly-route-test-token';
let app, db, client;
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('CECELIA_INTERNAL_TOKEN', token);
  client = { query: vi.fn(async sql => {
    if (sql.includes('FROM tasks')) return { rows: [{ id, payload: { tenant_id: 'company-a', workflow_authoring: true }, result: {
      workflow_authoring: { outputs: { compose: { definition: { key: 'report', activities: [] } } } },
    } }] };
    return { rows: [] };
  }), release: vi.fn() };
  db = { connect: vi.fn(async () => client), query: vi.fn() };
  app = express();
  app.use(express.json());
  app.use('/api/brain/workflow-authoring', createWorkflowAuthoringRouter({ db }));
});
afterEach(() => vi.unstubAllEnvs());

describe('工作流装配计划只读入口', () => {
  it('对已有管理任务返回具体缺口，而不是把目录记录当成可调用', async () => {
    const res = await request(app).get(`/api/brain/workflow-authoring/runs/${id}/assembly-plan`)
      .set('X-Internal-Token', token).set('X-Tenant-Id', 'company-a');
    expect(res.status).toBe(200);
    expect(res.body.plan.callable).toBe(false);
    expect(res.body.plan.gaps.map(g => g.code)).toContain('activities_missing');
    expect(client.query.mock.calls[0][0]).toBe('BEGIN READ ONLY');
    expect(client.query.mock.calls.at(-1)[0]).toBe('COMMIT');
    expect(client.query.mock.calls.some(([sql]) => /INSERT|UPDATE|DELETE/i.test(sql))).toBe(false);
    expect(client.release).toHaveBeenCalledOnce();
  });
  it('认证和租户边界在读取目录之前执行', async () => {
    const path = `/api/brain/workflow-authoring/runs/${id}/assembly-plan`;
    expect((await request(app).get(path)).status).toBe(401);
    expect(db.connect).not.toHaveBeenCalled();
    const res = await request(app).get(path).set('X-Internal-Token', token).set('X-Tenant-Id', 'company-b');
    expect(res.status).toBe(404);
    expect(client.query.mock.calls.some(([sql]) => sql.includes('warehouse_items'))).toBe(false);
  });
  it('来源目录读取故障回滚，错误不泄露连接详情', async () => {
    client.query.mockRejectedValue(new Error('secret-database-address'));
    const res = await request(app).get(`/api/brain/workflow-authoring/runs/${id}/assembly-plan`)
      .set('X-Internal-Token', token).set('X-Tenant-Id', 'company-a');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret-database-address');
    expect(client.release).toHaveBeenCalledOnce();
  });
});
