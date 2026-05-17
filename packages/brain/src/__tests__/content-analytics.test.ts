/**
 * content-analytics.test.ts
 *
 * content-analytics.js 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockPool = { query: mockQuery } as any;

let writeContentAnalytics: (pool: any, params: any) => Promise<string>;
let bulkWriteContentAnalytics: (pool: any, items: any[]) => Promise<number>;
let queryWeeklyROI: (pool: any, start: Date, end: Date) => Promise<any[]>;
let getTopContentByPlatform: (pool: any, opts?: any) => Promise<any[]>;
let upsertPipelinePublishStats: (pool: any, params: any) => Promise<void>;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  const mod = await import('../content-analytics.js');
  writeContentAnalytics = mod.writeContentAnalytics;
  bulkWriteContentAnalytics = mod.bulkWriteContentAnalytics;
  queryWeeklyROI = mod.queryWeeklyROI;
  getTopContentByPlatform = mod.getTopContentByPlatform;
  upsertPipelinePublishStats = mod.upsertPipelinePublishStats;
});

describe('writeContentAnalytics', () => {
  it('插入成功时返回新记录 UUID', async () => {
    const fakeId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    mockQuery.mockResolvedValueOnce({ rows: [{ id: fakeId }] });

    const id = await writeContentAnalytics(mockPool, {
      platform: 'douyin',
      title: '测试内容',
      metrics: { views: 1000, likes: 50, comments: 10, shares: 5 },
    });

    expect(id).toBe(fakeId);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('INSERT INTO content_analytics');
  });

  it('缺少 platform 时抛出错误', async () => {
    await expect(
      writeContentAnalytics(mockPool, { platform: '', metrics: {} })
    ).rejects.toThrow('platform is required');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('metrics 为空时默认全为 0', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'test-id' }] });
    await writeContentAnalytics(mockPool, { platform: 'weibo', metrics: {} });
    const params = mockQuery.mock.calls[0][1] as any[];
    // params: [platform, contentId, title, publishedAt, views, likes, comments, shares, clicks, source, pipelineId, rawData]
    expect(params[4]).toBe(0); // views
    expect(params[5]).toBe(0); // likes
    expect(params[6]).toBe(0); // comments
    expect(params[7]).toBe(0); // shares
    expect(params[8]).toBe(0); // clicks
  });
});

describe('bulkWriteContentAnalytics', () => {
  it('空数组时返回 0', async () => {
    const count = await bulkWriteContentAnalytics(mockPool, []);
    expect(count).toBe(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('部分失败时跳过并返回成功条数', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'id-1' }] });
    mockQuery.mockRejectedValueOnce(new Error('DB error'));
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'id-3' }] });

    const count = await bulkWriteContentAnalytics(mockPool, [
      { platform: 'douyin', metrics: {} },
      { platform: 'weibo', metrics: {} },
      { platform: 'xiaohongshu', metrics: {} },
    ]);

    expect(count).toBe(2);
  });
});

describe('queryWeeklyROI', () => {
  it('返回正确的 ROI 数据结构', async () => {
    const start = new Date('2026-03-30T00:00:00Z');
    const end = new Date('2026-04-06T00:00:00Z');

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          platform: 'douyin',
          content_count: '5',
          total_views: '10000',
          total_likes: '500',
          total_comments: '100',
          total_shares: '50',
          avg_views_per_content: '2000',
          engagement_rate: '65.00',
        },
      ],
    });

    const roi = await queryWeeklyROI(mockPool, start, end);

    expect(roi).toHaveLength(1);
    expect(roi[0].platform).toBe('douyin');
    expect(roi[0].content_count).toBe(5);
    expect(roi[0].total_views).toBe(10000);
    expect(roi[0].avg_views_per_content).toBe(2000);
    expect(roi[0].engagement_rate).toBe(65);
  });

  it('无数据时返回空数组', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const roi = await queryWeeklyROI(mockPool, new Date(), new Date());
    expect(roi).toEqual([]);
  });
});

describe('upsertPipelinePublishStats', () => {
  it('成功写入 pipeline_publish_stats', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await upsertPipelinePublishStats(mockPool, {
      publishTaskId: 'pub-task-123',
      pipelineId: 'pipe-456',
      platform: 'douyin',
      metrics: { views: 1000, likes: 50, comments: 10, shares: 5 },
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('INSERT INTO pipeline_publish_stats');
    const params = mockQuery.mock.calls[0][1] as any[];
    expect(params[1]).toBe('pub-task-123'); // publish_task_id
    expect(params[2]).toBe('douyin');        // platform
    expect(params[3]).toBe(1000);            // views
    expect(params[4]).toBe(50);              // likes
  });

  it('缺少 publishTaskId 时抛出错误', async () => {
    await expect(
      upsertPipelinePublishStats(mockPool, { publishTaskId: '', platform: 'weibo', metrics: {} })
    ).rejects.toThrow('publishTaskId is required');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('metrics 为空时默认全为 0', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await upsertPipelinePublishStats(mockPool, {
      publishTaskId: 'pub-task-789',
      platform: 'xiaohongshu',
      metrics: {},
    });
    const params = mockQuery.mock.calls[0][1] as any[];
    expect(params[3]).toBe(0); // views
    expect(params[4]).toBe(0); // likes
    expect(params[5]).toBe(0); // comments
    expect(params[6]).toBe(0); // shares
  });

  it('pipelineId 为空时写入 null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await upsertPipelinePublishStats(mockPool, {
      publishTaskId: 'pub-task-000',
      platform: 'weibo',
      metrics: { views: 500 },
    });
    const params = mockQuery.mock.calls[0][1] as any[];
    expect(params[0]).toBeNull(); // pipeline_id
  });
});

describe('getTopContentByPlatform', () => {
  it('按曝光量返回热门内容', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { platform: 'douyin', title: '热门视频', content_id: 'abc', views: 50000, likes: 2000, comments: 300, shares: 100, collected_at: new Date() },
      ],
    });

    const items = await getTopContentByPlatform(mockPool, { platform: 'douyin', limit: 5 });
    expect(items).toHaveLength(1);
    expect(items[0].views).toBe(50000);
  });

  it('不传 platform 时不加平台过滤', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await getTopContentByPlatform(mockPool);
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).not.toContain('platform = $3');
  });
});
