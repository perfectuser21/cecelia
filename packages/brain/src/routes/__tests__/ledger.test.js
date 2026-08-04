/**
 * TDD: GET /api/brain/ledger
 *
 * 验证新增的统一账本端点正确聚合 journey_features + decisions，
 * 并在服务端计算 11 要素覆盖率，响应单次 JSON。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

async function makeApp() {
  const { default: router } = await import('../journeys.js');
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/brain', router);
  return app;
}

async function request() {
  return (await import('supertest')).default;
}

describe('GET /api/brain/ledger', () => {
  beforeEach(() => mockQuery.mockReset());

  it('[LED-1] 无过滤时返回所有 journey_features 并计算覆盖', async () => {
    mockQuery
      // 第一次查询: journey_features JOIN journeys
      .mockResolvedValueOnce({
        rows: [{
          id: 'feat-1',
          name: '智能路由与转发处理',
          journey_id: 'journey-1',
          journey_name: '智能客服接入',
          status: 'working',
          kind: 'feature',
          thickness: 'thin',
          area_id: 'area-1',
          unit_test_path: 'tests/routing.test.js',
          guard_ref: null,
          workflow_ref: null,
          e2e_test_path: null,
          updated_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        }],
      })
      // 第二次查询: decisions
      .mockResolvedValueOnce({ rows: [] });

    const app = await makeApp();
    const req = await request();
    const res = await req(app).get('/api/brain/ledger');

    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].name).toBe('智能路由与转发处理');
    expect(res.body.rows[0].coverage).toBeDefined();
    expect(res.body.rows[0].coverage.fr).toBe('present');
    expect(res.body.rows[0].coverage.ttl).toBe('present');  // unit_test_path 已设
    expect(res.body.rows[0].coverage.death).toBe('missing'); // guard_ref 未设
    expect(res.body.rows[0].coverage_score).toBeGreaterThan(0);
    expect(res.body.meta.total).toBe(1);
  });

  it('[LED-2] journey_id 过滤参数生效', async () => {
    const journeyId = 'journey-42';
    mockQuery
      .mockResolvedValueOnce({ rows: [] })  // journey_features（无匹配）
      .mockResolvedValueOnce({ rows: [] }); // decisions

    const app = await makeApp();
    const req = await request();
    const res = await req(app).get(`/api/brain/ledger?journey_id=${journeyId}`);

    expect(res.status).toBe(200);
    expect(res.body.meta.journey_id).toBe(journeyId);
    expect(res.body.rows).toHaveLength(0);
  });

  it('[LED-3] NFR decisions 提升 nfr 覆盖至 present', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'feat-2',
          name: '支付回调校验',
          journey_id: 'journey-2',
          journey_name: '支付 GP',
          status: 'working',
          kind: 'ability',
          thickness: 'medium',
          area_id: null,
          unit_test_path: null,
          guard_ref: null,
          workflow_ref: null,
          e2e_test_path: null,
          updated_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ category: 'nfr', topic: '幂等性', status: 'active', target_id: 'feat-2', target_type: 'journey_feature' }],
      });

    const app = await makeApp();
    const req = await request();
    const res = await req(app).get('/api/brain/ledger');

    expect(res.status).toBe(200);
    expect(res.body.rows[0].coverage.nfr).toBe('present');
    expect(res.body.rows[0].coverage.fr).toBe('present');  // name 长度 > 5
    expect(res.body.rows[0].coverage.ttl).toBe('missing'); // unit_test_path 未设
  });

  it('[LED-4] DB 错误返回 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB connection refused'));

    const app = await makeApp();
    const req = await request();
    const res = await req(app).get('/api/brain/ledger');

    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });

  it('[LED-5] 过期记录（>30天未更新）freshness 为 stale', async () => {
    const oldDate = new Date(Date.now() - 40 * 86400000).toISOString();
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'feat-3',
          name: '长期未更新的功能点',
          journey_id: 'journey-3',
          journey_name: 'test journey',
          status: 'planned',
          kind: 'feature',
          thickness: 'thin',
          area_id: null,
          unit_test_path: null,
          guard_ref: null,
          workflow_ref: null,
          e2e_test_path: null,
          updated_at: oldDate,
          created_at: oldDate,
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const app = await makeApp();
    const req = await request();
    const res = await req(app).get('/api/brain/ledger');

    expect(res.status).toBe(200);
    expect(res.body.rows[0].coverage.freshness).toBe('stale');
  });
});
