/**
 * post-publish-data-collector.test.ts
 *
 * 发布后数据回收模块单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// 模拟 pg Pool
const mockQuery = vi.fn();
const mockPool = { query: mockQuery } as any;

// 动态 import 被测模块
let schedulePostPublishCollection: (pool: any) => Promise<{ scheduled: number }>;
let writePipelinePublishStats: (pool: any, params: any) => Promise<void>;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  const mod = await import('../post-publish-data-collector.js');
  schedulePostPublishCollection = mod.schedulePostPublishCollection;
  writePipelinePublishStats = mod.writePipelinePublishStats;
});

describe('schedulePostPublishCollection', () => {
  it('当无待采集任务时，返回 scheduled=0', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await schedulePostPublishCollection(mockPool);

    expect(result.scheduled).toBe(0);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('有待采集任务时，每个任务派发一个 scraper 任务', async () => {
    const fakeTasks = [
      {
        id: 'task-uuid-1',
        title: '发布小红书',
        payload: { platform: 'xiaohongshu', pipeline_id: 'pipe-uuid-1' },
        completed_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
        pipeline_id: 'pipe-uuid-1',
        platform: 'xiaohongshu',
      },
    ];

    // 第一次 query：返回待采集任务
    mockQuery.mockResolvedValueOnce({ rows: fakeTasks });
    // 第二次 query：INSERT platform_scraper 任务
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await schedulePostPublishCollection(mockPool);

    expect(result.scheduled).toBe(1);
    expect(mockQuery).toHaveBeenCalledTimes(2);

    // 验证 INSERT 调用包含 platform_scraper 类型
    const insertCall = mockQuery.mock.calls[1];
    expect(insertCall[0]).toContain('INSERT INTO tasks');
    expect(insertCall[1][0]).toBe('platform_scraper');
  });

  it('DB 异常时不抛出，返回 scheduled=0', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    const result = await schedulePostPublishCollection(mockPool);

    expect(result.scheduled).toBe(0);
  });
});

describe('writePipelinePublishStats', () => {
  it('正常写入时调用 INSERT', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await writePipelinePublishStats(mockPool, {
      pipelineId: 'pipe-1',
      publishTaskId: 'task-1',
      platform: 'douyin',
      metrics: { views: 1000, likes: 50, comments: 10, shares: 5 },
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('pipeline_publish_stats');
    expect(params).toContain('pipe-1');
    expect(params).toContain('douyin');
    expect(params).toContain(1000);
  });

  it('metrics 缺省时使用 0', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await writePipelinePublishStats(mockPool, {
      pipelineId: 'pipe-2',
      publishTaskId: 'task-2',
      platform: 'weibo',
      metrics: {},
    });

    const [, params] = mockQuery.mock.calls[0];
    // views, likes, comments, shares 均为 0
    expect(params).toContain(0);
  });
});
