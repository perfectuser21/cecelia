/**
 * data-pipeline.test.ts
 *
 * 验证数据采集管道核心写入函数（纯单元测试，mock pool，无真实 DB 连接）：
 * - writeContentAnalytics
 * - bulkWriteContentAnalytics
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
  getPoolHealth: vi.fn(() => ({ total: 0, idle: 0, waiting: 0, activeCount: 0 })),
}));

import { writeContentAnalytics, bulkWriteContentAnalytics } from '../content-analytics.js';

function makeMockPool(rows: unknown[] = [{ id: 'fake-uuid' }]) {
  return { query: vi.fn(async () => ({ rows })) };
}

// ─── writeContentAnalytics ──────────────────────────────────────────────────

describe('writeContentAnalytics', () => {
  it('调用 INSERT 并返回 UUID', async () => {
    const fakeId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const pool = makeMockPool([{ id: fakeId }]);

    const result = await writeContentAnalytics(pool as never, {
      platform: 'douyin',
      metrics:  { views: 1000, likes: 50, comments: 5, shares: 2, clicks: 0 },
    });

    expect(result).toBe(fakeId);
    expect(pool.query).toHaveBeenCalledOnce();
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO content_analytics');
  });

  it('platform 为空时抛出错误', async () => {
    const pool = makeMockPool([]);
    await expect(
      writeContentAnalytics(pool as never, { platform: '', metrics: {} })
    ).rejects.toThrow('platform is required');
  });

  it('metrics 缺省字段默认 0', async () => {
    const pool = makeMockPool([{ id: 'test-id' }]);
    await writeContentAnalytics(pool as never, {
      platform: 'weibo',
      metrics:  {},
    });

    const [, params] = pool.query.mock.calls[0] as [string, number[]];
    // INSERT 参数顺序: platform, content_id, title, published_at, views(4), likes(5), comments(6), shares(7), clicks(8)
    const [, , , , views, likes, comments, shares, clicks] = params;
    expect(views).toBe(0);
    expect(likes).toBe(0);
    expect(comments).toBe(0);
    expect(shares).toBe(0);
    expect(clicks).toBe(0);
  });

  it('传入 pipelineId 时包含在参数中', async () => {
    const pool = makeMockPool([{ id: 'pid-test' }]);
    await writeContentAnalytics(pool as never, {
      platform:   'xiaohongshu',
      pipelineId: 'pipe-abc-123',
      metrics:    { views: 500 },
    });

    const [, params] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(params).toContain('pipe-abc-123');
  });
});

// ─── bulkWriteContentAnalytics ──────────────────────────────────────────────

describe('bulkWriteContentAnalytics', () => {
  it('空数组返回 0，不调用 DB', async () => {
    const pool = makeMockPool([]);
    const count = await bulkWriteContentAnalytics(pool as never, []);
    expect(count).toBe(0);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('多条写入返回成功数量', async () => {
    let callCount = 0;
    const pool = { query: vi.fn(async () => ({ rows: [{ id: `id-${++callCount}` }] })) };

    const items = [
      { platform: 'douyin',      metrics: { views: 100 } },
      { platform: 'kuaishou',    metrics: { views: 200 } },
      { platform: 'xiaohongshu', metrics: { views: 50  } },
    ];
    const count = await bulkWriteContentAnalytics(pool as never, items);
    expect(count).toBe(3);
  });

  it('单条失败时跳过，其余继续写入', async () => {
    let callCount = 0;
    const pool = {
      query: vi.fn(async () => {
        callCount++;
        if (callCount === 2) throw new Error('DB error');
        return { rows: [{ id: `id-${callCount}` }] };
      }),
    };

    const items = [
      { platform: 'douyin', metrics: {} },
      { platform: 'bad',    metrics: {} },
      { platform: 'weibo',  metrics: {} },
    ];
    const count = await bulkWriteContentAnalytics(pool as never, items);
    expect(count).toBe(2);
  });
});
