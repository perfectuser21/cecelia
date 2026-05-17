/**
 * social-trending.test.ts
 *
 * GET /api/brain/social/trending 路由单元测试
 * 使用 vitest + express supertest 模拟，独立于 TimescaleDB 服务
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// --- mock pg Pool ---
const mockQuery = vi.fn();
const mockEnd = vi.fn();
vi.mock('pg', () => ({
  default: {
    Pool: vi.fn().mockImplementation(() => ({
      query: mockQuery,
      end: mockEnd,
    })),
  },
}));

// --- 动态 import 被测模块 ---
let socialTrendingRouter: express.Router;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  const mod = await import('../routes/social-trending.js');
  socialTrendingRouter = mod.default;
});

function makeApp() {
  const app = express();
  app.use('/api/brain/social', socialTrendingRouter);
  return app;
}

function makeFakeRow(platform: string, overrides: Record<string, unknown> = {}) {
  return {
    platform,
    title: `测试内容-${platform}`,
    views: 10000,
    likes: 500,
    scraped_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('GET /api/brain/social/trending', () => {
  it('TimescaleDB 可达时：返回 200 + JSON 数组，每条记录含 platform 字段', async () => {
    const fakeRows = [makeFakeRow('douyin'), makeFakeRow('xiaohongshu')];
    mockQuery.mockResolvedValueOnce({ rows: fakeRows });

    const res = await request(makeApp()).get('/api/brain/social/trending');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(2);
    expect(res.body[0]).toHaveProperty('platform');
  });

  it('platform 参数过滤：?platform=douyin 只返回 douyin 数据', async () => {
    const fakeRows = [makeFakeRow('douyin'), makeFakeRow('douyin')];
    mockQuery.mockResolvedValueOnce({ rows: fakeRows });

    const res = await request(makeApp()).get('/api/brain/social/trending?platform=douyin');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    for (const row of res.body) {
      expect(row.platform).toBe('douyin');
    }
    const callArg = mockQuery.mock.calls[0];
    expect(callArg[1]).toContain('douyin');
  });

  it('limit 参数控制返回条数：?limit=5 最多返回 5 条', async () => {
    const fakeRows = Array.from({ length: 5 }, (_, i) => makeFakeRow(`platform${i}`));
    mockQuery.mockResolvedValueOnce({ rows: fakeRows });

    const res = await request(makeApp()).get('/api/brain/social/trending?limit=5');

    expect(res.status).toBe(200);
    expect(res.body.length).toBeLessThanOrEqual(5);
    const callArg = mockQuery.mock.calls[0];
    expect(callArg[1]).toContain(5);
  });

  it('TimescaleDB 不可达时：降级返回 200 + 空数组', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    const res = await request(makeApp()).get('/api/brain/social/trending');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(0);
  });
});
