/**
 * Social Trending Route Unit Tests
 * 使用 Vitest + mock pg（无需真实 TimescaleDB）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pg module 在 social-trending.js 使用它之前
const mockQuery = vi.fn();
const mockEnd = vi.fn();

vi.mock('pg', () => {
  const Pool = vi.fn(() => ({
    query: mockQuery,
    end: mockEnd,
  }));
  return { default: { Pool } };
});

import socialTrendingRouter from '../routes/social-trending.js';

// ===== 辅助函数 =====

function getHandler(path) {
  const layers = socialTrendingRouter.stack.filter(
    l => l.route && l.route.methods['get'] && l.route.path === path
  );
  if (layers.length === 0) throw new Error(`No GET handler for ${path}`);
  return layers[0].route.stack[0].handle;
}

function mockReqRes(query = {}) {
  const req = { query };
  const res = {
    _status: 200,
    _data: null,
    status(code) {
      this._status = code;
      return this;
    },
    json(data) {
      this._data = data;
      return this;
    },
  };
  return { req, res };
}

// ===== 测试用例 =====

describe('GET /social/trending', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('正常返回包含 platform 字段的 JSON 数组', async () => {
    const fakeRows = [
      { title: '测试标题', views: 1000, likes: 50, comments: 10, platform: 'douyin', scraped_at: new Date() },
      { title: '另一标题', views: 500, likes: 20, comments: 5, platform: 'kuaishou', scraped_at: new Date() },
    ];
    mockQuery.mockResolvedValueOnce({ rows: fakeRows });

    const handler = getHandler('/trending');
    const { req, res } = mockReqRes({});
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(Array.isArray(res._data)).toBe(true);
    expect(res._data.length).toBe(2);
    expect(res._data[0]).toHaveProperty('platform');
  });

  it('支持 ?platform 过滤参数', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ title: '抖音标题', views: 800, likes: 30, comments: 5, platform: 'douyin', scraped_at: new Date() }] });

    const handler = getHandler('/trending');
    const { req, res } = mockReqRes({ platform: 'douyin' });
    await handler(req, res);

    const callArgs = mockQuery.mock.calls[0];
    expect(callArgs[1]).toContain('douyin');
    expect(res._data[0].platform).toBe('douyin');
  });

  it('支持 ?limit 参数，默认 20，最大 100', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const handler = getHandler('/trending');
    const { req, res } = mockReqRes({ limit: '5' });
    await handler(req, res);

    const callArgs = mockQuery.mock.calls[0];
    expect(callArgs[1]).toContain(5);
  });

  it('TimescaleDB 不可达时降级返回空数组（不报 500）', async () => {
    mockQuery.mockRejectedValueOnce(new Error('Connection refused'));

    const handler = getHandler('/trending');
    const { req, res } = mockReqRes({});
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._data).toEqual([]);
  });
});
