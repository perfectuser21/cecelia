/**
 * GET /api/brain/incidents 端点
 * task_id: c11cdec4-c845-447f-80da-9d528753be1d
 * 保留原regression副本的RefusingPool、fingerprint和失败分支，近源统一覆盖。
 *
 * 覆盖：
 *   [BEHAVIOR-4] GET /api/brain/incidents 返回 HTTP 200 含 incidents 数组
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// 没接上真实router的DB边界时直接拒绝，禁止意外连接任何数据库。
vi.mock('pg', async original => {
  const actual = await original();
  class RefusingPool {
    on() { return this; }
    async query() { throw new Error('incidents_test_database_boundary_unmocked'); }
    async connect() { throw new Error('incidents_test_database_boundary_unmocked'); }
    async end() {}
  }
  return {...actual, Pool: RefusingPool, default: {...actual.default, Pool: RefusingPool}};
});

// ── Mock DB pool ──────────────────────────────────────────────────────────────
const mockQuery = vi.fn();
vi.mock('../../db/pool.js', () => ({
  default: { query: mockQuery },
  pool: { query: mockQuery },
}));

async function createIncidentsApp(loadRouter = () => import('../incidents.js')) {
  const app = express();
  app.use(express.json());
  const {default: incidentsRouter} = await loadRouter();
  app.use('/api/brain', incidentsRouter);
  return app;
}

// ── 测试套件 ──────────────────────────────────────────────────────────────────
describe('[BEHAVIOR-4] GET /api/brain/incidents', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Mock 返回 2 条 incidents
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'uuid-1',
          probe_id: 'launchd-patrol',
          fingerprint: 'launchd-patrol:com.cecelia.bridge',
          severity: 'p1',
          status: 'open',
          task_id: null,
          recurrence_count: 2,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          evidence: { detail: 'test' },
        },
        {
          id: 'uuid-2',
          probe_id: 'dept-heartbeat',
          fingerprint: 'heartbeat-silent:brain',
          severity: 'p2',
          status: 'open',
          task_id: null,
          recurrence_count: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          evidence: { dept: 'brain' },
        },
      ],
    });

    app = await createIncidentsApp();
  });

  it('一次真实HTTP请求同时验证状态、数组和记录字段', async () => {
    const res = await request(app).get('/api/brain/incidents');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.incidents)).toBe(true);
    expect(res.body.incidents).toHaveLength(2);
    const required = ['id', 'probe_id', 'fingerprint', 'severity', 'status', 'task_id',
      'recurrence_count', 'created_at', 'updated_at', 'evidence'];
    for (const record of res.body.incidents) {
      for (const field of required) expect(record).toHaveProperty(field);
    }
  });

  it('应能找到 fingerprint=launchd-patrol:com.cecelia.bridge 的记录', async () => {
    const res = await request(app).get('/api/brain/incidents');
    const found = res.body.incidents.find(
      (r) => r.fingerprint === 'launchd-patrol:com.cecelia.bridge'
    );
    expect(found).toBeDefined();
  });

  it('真实router导入失败必须向测试传播，不得另造成功响应', async () => {
    await expect(createIncidentsApp(async () => { throw new Error('incidents_router_import_failed'); }))
      .rejects.toThrow('incidents_router_import_failed');
  });

  it('真实router的SQL失败必须返回500，并且错误不能由假成功路由吞掉', async () => {
    mockQuery.mockReset();
    mockQuery.mockRejectedValueOnce(new Error('incidents_query_failed'));
    const response = await request(app).get('/api/brain/incidents');
    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({error: 'internal_error', message: 'incidents_query_failed'});
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('FROM incidents'));
  });
});
