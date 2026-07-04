/**
 * Agent Credit 路由测试
 *
 * GET  /api/brain/agent/credit/balance?license_key=
 * POST /api/brain/agent/credit/deduct
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockQuery = vi.hoisted(() => vi.fn());
const mockConnect = vi.hoisted(() => vi.fn());

vi.mock('../db.js', () => ({
  default: { query: mockQuery, connect: mockConnect },
}));

let app;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();

  app = express();
  app.use(express.json());

  const { default: agentCreditRouter } = await import('../routes/agent-credit.js');
  app.use('/api/brain', agentCreditRouter);
});

// ─────────────────────────────────────────────────────
// GET /api/brain/agent/credit/balance
// ─────────────────────────────────────────────────────
describe('GET /api/brain/agent/credit/balance', () => {
  it('缺少 license_key 返回 400', async () => {
    const res = await request(app).get('/api/brain/agent/credit/balance');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/license_key/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('license 不存在返回 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/brain/agent/credit/balance?license_key=CECE-XXXX-XXXX-XXXX-XXXX');
    expect(res.status).toBe(404);
  });

  it('license 已吊销返回 403', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'uuid-1', license_key: 'CECE-AAAA-BBBB-CCCC-DDDD', tier: 'basic', credit_balance: '100.00', status: 'revoked' }] });
    const res = await request(app).get('/api/brain/agent/credit/balance?license_key=CECE-AAAA-BBBB-CCCC-DDDD');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/吊销/);
  });

  it('正常返回 credit_balance', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'uuid-1', license_key: 'CECE-AAAA-BBBB-CCCC-DDDD', tier: 'basic', credit_balance: '250.50', status: 'active' }],
    });
    const res = await request(app).get('/api/brain/agent/credit/balance?license_key=CECE-AAAA-BBBB-CCCC-DDDD');
    expect(res.status).toBe(200);
    expect(res.body.credit_balance).toBe(250.50);
    expect(res.body.tier).toBe('basic');
  });
});

// ─────────────────────────────────────────────────────
// POST /api/brain/agent/credit/deduct
// ─────────────────────────────────────────────────────
describe('POST /api/brain/agent/credit/deduct', () => {
  const makeClient = (rows, status = 'active') => {
    const client = {
      query: vi.fn(),
      release: vi.fn(),
    };
    // BEGIN, SELECT FOR UPDATE, UPDATE, INSERT, COMMIT
    client.query
      .mockResolvedValueOnce({})                   // BEGIN
      .mockResolvedValueOnce({ rows })              // SELECT FOR UPDATE
      .mockResolvedValueOnce({})                    // UPDATE
      .mockResolvedValueOnce({})                    // INSERT tx
      .mockResolvedValueOnce({});                   // COMMIT
    mockConnect.mockResolvedValueOnce(client);
    return client;
  };

  it('缺少 license_key 返回 400', async () => {
    const res = await request(app).post('/api/brain/agent/credit/deduct').send({ amount: 10 });
    expect(res.status).toBe(400);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('amount 无效返回 400', async () => {
    const res = await request(app).post('/api/brain/agent/credit/deduct').send({ license_key: 'CECE-AAAA-BBBB-CCCC-DDDD', amount: -5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/正数/);
  });

  it('license 不存在返回 404', async () => {
    const client = { query: vi.fn(), release: vi.fn() };
    client.query
      .mockResolvedValueOnce({})          // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // SELECT FOR UPDATE → 空
      .mockResolvedValueOnce({});          // ROLLBACK
    mockConnect.mockResolvedValueOnce(client);

    const res = await request(app).post('/api/brain/agent/credit/deduct').send({ license_key: 'CECE-XXXX-XXXX-XXXX-XXXX', amount: 10 });
    expect(res.status).toBe(404);
  });

  it('余额不足返回 402', async () => {
    const client = { query: vi.fn(), release: vi.fn() };
    client.query
      .mockResolvedValueOnce({})          // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'uuid-1', credit_balance: '5.00', status: 'active' }] })
      .mockResolvedValueOnce({});          // ROLLBACK
    mockConnect.mockResolvedValueOnce(client);

    const res = await request(app).post('/api/brain/agent/credit/deduct').send({ license_key: 'CECE-AAAA-BBBB-CCCC-DDDD', amount: 10 });
    expect(res.status).toBe(402);
    expect(res.body.error).toMatch(/余额不足/);
    expect(res.body.credit_balance).toBe(5);
    expect(res.body.required).toBe(10);
  });

  it('正常扣费返回新余额', async () => {
    makeClient([{ id: 'uuid-1', credit_balance: '100.00', status: 'active' }]);

    const res = await request(app)
      .post('/api/brain/agent/credit/deduct')
      .send({ license_key: 'CECE-AAAA-BBBB-CCCC-DDDD', amount: 30, description: '关键词采集' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.deducted).toBe(30);
    expect(res.body.credit_balance).toBe(70);
  });

  it('已吊销 license 返回 403', async () => {
    const client = { query: vi.fn(), release: vi.fn() };
    client.query
      .mockResolvedValueOnce({})          // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'uuid-1', credit_balance: '100.00', status: 'revoked' }] })
      .mockResolvedValueOnce({});          // ROLLBACK
    mockConnect.mockResolvedValueOnce(client);

    const res = await request(app).post('/api/brain/agent/credit/deduct').send({ license_key: 'CECE-AAAA-BBBB-CCCC-DDDD', amount: 10 });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/吊销/);
  });
});
