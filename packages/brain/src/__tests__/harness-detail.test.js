/**
 * harness-detail.test.js
 * 验证 routes/harness.js 中 GET /initiative/:id/detail 端点
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ default: mockPool, pool: mockPool }));

const { default: harnessRouter } = await import('../routes/harness.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/harness', harnessRouter);
  return app;
}

const INIT_ID = '12345678-1234-1234-1234-123456789abc';

describe('GET /harness/initiative/:id/detail', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  function mockFullSuccess() {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: INIT_ID }] })
      .mockResolvedValueOnce({ rows: [{ prd_content: 'prd text', contract_content: 'contract text', review_rounds: 3 }] })
      .mockResolvedValueOnce({ rows: [{ payload: { nodeName: 'planner' }, created_at: '2026-01-01T00:00:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [] });
  }

  it('HTTP 200 + initiative_id(string) + step_timing(array) + screenshot_urls(array)', async () => {
    mockFullSuccess();
    const res = await request(app).get(`/harness/initiative/${INIT_ID}/detail`);
    expect(res.status).toBe(200);
    expect(typeof res.body.initiative_id).toBe('string');
    expect(Array.isArray(res.body.step_timing)).toBe(true);
    expect(Array.isArray(res.body.screenshot_urls)).toBe(true);
  });

  it('prd_content(string|null) + contract_content(string|null) + gan_rounds(number|null) 类型正确', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: INIT_ID }] })
      .mockResolvedValueOnce({ rows: [{ prd_content: 'some prd', contract_content: null, review_rounds: 2 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get(`/harness/initiative/${INIT_ID}/detail`);
    expect(res.status).toBe(200);
    expect(typeof res.body.prd_content === 'string' || res.body.prd_content === null).toBe(true);
    expect(typeof res.body.contract_content === 'string' || res.body.contract_content === null).toBe(true);
    expect(typeof res.body.gan_rounds === 'number' || res.body.gan_rounds === null).toBe(true);
  });

  it('顶层 keys 完整性等于 PRD 定义集合', async () => {
    mockFullSuccess();
    const res = await request(app).get(`/harness/initiative/${INIT_ID}/detail`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      ['contract_content', 'gan_rounds', 'initiative_id', 'prd_content', 'screenshot_urls', 'step_timing']
    );
  });

  it('禁用字段 steps/timeline/result/data/details/info 不出现', async () => {
    mockFullSuccess();
    const res = await request(app).get(`/harness/initiative/${INIT_ID}/detail`);
    expect(res.status).toBe(200);
    const body = res.body;
    expect(body).not.toHaveProperty('steps');
    expect(body).not.toHaveProperty('timeline');
    expect(body).not.toHaveProperty('result');
    expect(body).not.toHaveProperty('data');
    expect(body).not.toHaveProperty('details');
    expect(body).not.toHaveProperty('info');
  });

  it('404 + error string（initiative 不存在）', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get(`/harness/initiative/${INIT_ID}/detail`);
    expect(res.status).toBe(404);
    expect(typeof res.body.error).toBe('string');
  });
});
