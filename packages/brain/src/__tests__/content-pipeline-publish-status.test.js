/**
 * GET /pipelines/:id/publish-status — KR5-P1 详情页用
 *
 * 测试合并逻辑：
 *   - publish_results 优先（含 url），覆盖 content_publish_jobs
 *   - publish_results 没数据时落到 jobs.status：running/pending → pending；success → posted；failed → failed
 *   - 同 platform 多条 publish_results 取最新一条
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => {
  const mockPool = { query: vi.fn() };
  return { default: mockPool };
});

import pool from '../db.js';
import contentPipelineRoutes from '../routes/content-pipeline.js';

function getHandler(method, path) {
  const layers = contentPipelineRoutes.stack.filter(
    (l) => l.route && l.route.methods[method] && l.route.path === path
  );
  if (layers.length === 0) throw new Error(`No handler for ${method} ${path}`);
  return layers[0].route.stack[0].handle;
}

function mockReqRes(params = {}) {
  const req = { params };
  const res = {
    _data: null,
    _status: 200,
    json(data) { this._data = data; return this; },
    status(code) { this._status = code; return this; },
  };
  return { req, res };
}

describe('GET /pipelines/:id/publish-status', () => {
  const handler = getHandler('get', '/:id/publish-status');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns posted with url when publish_results.success=true', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [
          { platform: 'douyin', success: true, url: 'https://www.douyin.com/video/abc',
            error: null, created_at: new Date('2026-04-25T10:00:00Z') },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const { req, res } = mockReqRes({ id: 'pipe-1' });
    await handler(req, res);

    expect(res._data.pipeline_id).toBe('pipe-1');
    expect(res._data.platforms).toHaveLength(1);
    expect(res._data.platforms[0]).toMatchObject({
      platform: 'douyin',
      status: 'posted',
      url: 'https://www.douyin.com/video/abc',
      error: null,
    });
  });

  it('returns failed with error when publish_results.success=false', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [
          { platform: 'kuaishou', success: false, url: null, error: 'login expired',
            created_at: new Date('2026-04-25T11:00:00Z') },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const { req, res } = mockReqRes({ id: 'pipe-2' });
    await handler(req, res);

    expect(res._data.platforms[0]).toMatchObject({
      platform: 'kuaishou',
      status: 'failed',
      url: null,
      error: 'login expired',
    });
  });

  it('falls back to content_publish_jobs when publish_results empty', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          { platform: 'xiaohongshu', status: 'pending', error_message: null,
            completed_at: null, created_at: new Date() },
          { platform: 'weibo', status: 'failed', error_message: 'image too large',
            completed_at: new Date(), created_at: new Date() },
          { platform: 'zhihu', status: 'success', error_message: null,
            completed_at: new Date('2026-04-25T12:00:00Z'),
            created_at: new Date() },
        ],
      });

    const { req, res } = mockReqRes({ id: 'pipe-3' });
    await handler(req, res);

    const map = Object.fromEntries(res._data.platforms.map((p) => [p.platform, p]));
    expect(map.xiaohongshu.status).toBe('pending');
    expect(map.weibo.status).toBe('failed');
    expect(map.weibo.error).toBe('image too large');
    expect(map.zhihu.status).toBe('posted');
    expect(map.zhihu.url).toBeNull();
  });

  it('publish_results overrides jobs for same platform', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [
          { platform: 'douyin', success: true, url: 'https://x.com/v/123',
            error: null, created_at: new Date('2026-04-25T13:00:00Z') },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { platform: 'douyin', status: 'failed', error_message: 'old err',
            completed_at: new Date('2026-04-25T09:00:00Z'),
            created_at: new Date('2026-04-25T09:00:00Z') },
        ],
      });

    const { req, res } = mockReqRes({ id: 'pipe-4' });
    await handler(req, res);

    expect(res._data.platforms).toHaveLength(1);
    expect(res._data.platforms[0]).toMatchObject({
      platform: 'douyin',
      status: 'posted',
      url: 'https://x.com/v/123',
      error: null,
    });
  });

  it('returns empty array when no publish data exists', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const { req, res } = mockReqRes({ id: 'pipe-empty' });
    await handler(req, res);

    expect(res._data.pipeline_id).toBe('pipe-empty');
    expect(res._data.platforms).toEqual([]);
  });

  it('handles pool error with 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'));

    const { req, res } = mockReqRes({ id: 'pipe-err' });
    await handler(req, res);

    expect(res._status).toBe(500);
    expect(res._data.error).toBe('db down');
  });

  it('sorts platforms alphabetically', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [
          { platform: 'weibo', success: true, url: 'u1', error: null, created_at: new Date() },
          { platform: 'douyin', success: true, url: 'u2', error: null, created_at: new Date() },
          { platform: 'kuaishou', success: false, url: null, error: 'e', created_at: new Date() },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const { req, res } = mockReqRes({ id: 'pipe-sort' });
    await handler(req, res);

    const platforms = res._data.platforms.map((p) => p.platform);
    expect(platforms).toEqual(['douyin', 'kuaishou', 'weibo']);
  });
});
