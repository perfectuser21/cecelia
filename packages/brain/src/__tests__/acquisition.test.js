/**
 * Acquisition 路由测试
 *
 * GET /api/brain/acquisition/pending-keyword-tasks?license_key=
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));

let app;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();

  app = express();
  app.use(express.json());

  const { default: acquisitionRouter } = await import('../routes/acquisition.js');
  app.use('/api/brain', acquisitionRouter);
});

describe('GET /api/brain/acquisition/pending-keyword-tasks', () => {
  const activeLicense = {
    id: 'lic-uuid-1',
    credit_balance: '100.00',
    status: 'active',
  };

  it('缺少 license_key 返回 400', async () => {
    const res = await request(app).get('/api/brain/acquisition/pending-keyword-tasks');
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('license 不存在返回 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/brain/acquisition/pending-keyword-tasks?license_key=CECE-XXXX-XXXX-XXXX-XXXX');
    expect(res.status).toBe(404);
  });

  it('license 已吊销返回 403', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...activeLicense, status: 'revoked' }] });
    const res = await request(app).get('/api/brain/acquisition/pending-keyword-tasks?license_key=CECE-AAAA-BBBB-CCCC-DDDD');
    expect(res.status).toBe(403);
  });

  it('credit_balance = 0 返回空 tasks 列表', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...activeLicense, credit_balance: '0.00' }] });
    const res = await request(app).get('/api/brain/acquisition/pending-keyword-tasks?license_key=CECE-AAAA-BBBB-CCCC-DDDD');
    expect(res.status).toBe(200);
    expect(res.body.tasks).toEqual([]);
    expect(res.body.credit_balance).toBe(0);
    // 不应查 keyword_tasks
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('credit_balance < 0 返回空 tasks 列表', async () => {
    // balance 字段有 CHECK >= 0，此处测边界防御
    mockQuery.mockResolvedValueOnce({ rows: [{ ...activeLicense, credit_balance: '-1.00' }] });
    const res = await request(app).get('/api/brain/acquisition/pending-keyword-tasks?license_key=CECE-AAAA-BBBB-CCCC-DDDD');
    expect(res.status).toBe(200);
    expect(res.body.tasks).toEqual([]);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('有余额时返回 pending 任务列表', async () => {
    const fakeTasks = [
      { id: 'task-1', keyword: '小红书获客', status: 'pending', created_at: '2026-07-04T00:00:00Z' },
      { id: 'task-2', keyword: '抖音获客',   status: 'pending', created_at: '2026-07-04T00:01:00Z' },
    ];
    mockQuery
      .mockResolvedValueOnce({ rows: [activeLicense] })
      .mockResolvedValueOnce({ rows: fakeTasks });

    const res = await request(app).get('/api/brain/acquisition/pending-keyword-tasks?license_key=CECE-AAAA-BBBB-CCCC-DDDD');
    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(2);
    expect(res.body.credit_balance).toBe(100);
    expect(res.body.tasks[0].keyword).toBe('小红书获客');

    // 第二次 query 应带 license_id 和 limit
    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toContain("status = 'pending'");
    expect(params[0]).toBe('lic-uuid-1');
    expect(params[1]).toBe(20);
  });

  it('支持 ?limit= 参数', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [activeLicense] })
      .mockResolvedValueOnce({ rows: [] });

    await request(app).get('/api/brain/acquisition/pending-keyword-tasks?license_key=CECE-AAAA-BBBB-CCCC-DDDD&limit=5');
    const [, params] = mockQuery.mock.calls[1];
    expect(params[1]).toBe(5);
  });
});
