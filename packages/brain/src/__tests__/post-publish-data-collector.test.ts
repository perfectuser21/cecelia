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
let processPendingScraperTasks: (pool: any) => Promise<{ processed: number }>;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  const mod = await import('../post-publish-data-collector.js');
  schedulePostPublishCollection = mod.schedulePostPublishCollection;
  writePipelinePublishStats = mod.writePipelinePublishStats;
  processPendingScraperTasks = mod.processPendingScraperTasks;
});

describe('schedulePostPublishCollection', () => {
  it('当无待采集任务时，返回 scheduled=0', async () => {
    // call 1: fetchPendingCollectionTasks → 空
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // call 2: processPendingScraperTasks → fetchQueuedScraperTasks → 空
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await schedulePostPublishCollection(mockPool);

    expect(result.scheduled).toBe(0);
    // 两次 query：fetchPendingCollectionTasks + fetchQueuedScraperTasks
    expect(mockQuery).toHaveBeenCalledTimes(2);
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

    // call 1: fetchPendingCollectionTasks
    mockQuery.mockResolvedValueOnce({ rows: fakeTasks });
    // call 2: dispatchScraperTask (INSERT platform_scraper)
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // call 3: processPendingScraperTasks → fetchQueuedScraperTasks → 空（刚插入尚未处理无所谓）
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await schedulePostPublishCollection(mockPool);

    expect(result.scheduled).toBe(1);
    // 三次 query：fetchPendingCollectionTasks + dispatchScraperTask + fetchQueuedScraperTasks
    expect(mockQuery).toHaveBeenCalledTimes(3);

    // 验证 INSERT 调用包含 platform_scraper 类型
    const insertCall = mockQuery.mock.calls[1];
    expect(insertCall[0]).toContain('INSERT INTO tasks');
    expect(insertCall[1][0]).toBe('platform_scraper');
  });

  it('DB 异常时不抛出，返回 scheduled=0', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));
    // processPendingScraperTasks 会有自己的异常捕获，提供空结果
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    const result = await schedulePostPublishCollection(mockPool);

    expect(result.scheduled).toBe(0);
  });
});

describe('processPendingScraperTasks', () => {
  it('无排队任务时返回 processed=0', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await processPendingScraperTasks(mockPool);

    expect(result.processed).toBe(0);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('有排队任务且无真实数据时，写入 placeholder 并完成任务', async () => {
    const scraperTask = {
      id: 'scraper-uuid-1',
      payload: {
        platform: 'douyin',
        pipeline_id: 'pipe-1',
        source_publish_task_id: 'publish-1',
        triggered_by: 'post-publish-data-collector',
      },
      created_at: new Date().toISOString(),
    };

    // call 1: fetchQueuedScraperTasks
    mockQuery.mockResolvedValueOnce({ rows: [scraperTask] });
    // call 2: SELECT pipeline_publish_stats → 无真实数据
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // call 3: INSERT pipeline_publish_stats (placeholder)
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // call 4: UPDATE tasks (writeBackToPublishTask)
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // call 5: UPDATE tasks (completeScraperTask)
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await processPendingScraperTasks(mockPool);

    expect(result.processed).toBe(1);
    expect(mockQuery).toHaveBeenCalledTimes(5);

    // 验证 writeBackToPublishTask 的 UPDATE 调用包含 views/likes/comments
    const writeBackCall = mockQuery.mock.calls[3];
    expect(writeBackCall[0]).toContain('UPDATE tasks');
    const payloadStr = writeBackCall[1][0];
    const payload = JSON.parse(payloadStr);
    expect(payload.views).toBe(0);
    expect(payload.likes).toBe(0);
    expect(payload.comments).toBe(0);
    expect(payload).toHaveProperty('stats_collected_at');
  });

  it('有排队任务且 N8N 已采集真实数据时，回填真实数据', async () => {
    const scraperTask = {
      id: 'scraper-uuid-2',
      payload: {
        platform: 'kuaishou',
        pipeline_id: 'pipe-2',
        source_publish_task_id: 'publish-2',
        triggered_by: 'post-publish-data-collector',
      },
      created_at: new Date().toISOString(),
    };

    // call 1: fetchQueuedScraperTasks
    mockQuery.mockResolvedValueOnce({ rows: [scraperTask] });
    // call 2: SELECT pipeline_publish_stats → 有真实数据
    mockQuery.mockResolvedValueOnce({ rows: [{ views: 5000, likes: 300, comments: 42, shares: 15 }] });
    // call 3: writeBackToPublishTask (UPDATE)
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // call 4: completeScraperTask (UPDATE)
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await processPendingScraperTasks(mockPool);

    expect(result.processed).toBe(1);
    // 有真实数据时不写 pipeline_publish_stats，所以只有 4 次 query
    expect(mockQuery).toHaveBeenCalledTimes(4);

    // 验证 writeBackToPublishTask 携带真实数据
    const writeBackCall = mockQuery.mock.calls[2];
    const payload = JSON.parse(writeBackCall[1][0]);
    expect(payload.views).toBe(5000);
    expect(payload.likes).toBe(300);
    expect(payload.comments).toBe(42);
  });

  it('缺少 source_publish_task_id 时跳过并标记完成', async () => {
    const scraperTask = {
      id: 'scraper-uuid-3',
      payload: { platform: 'weibo', triggered_by: 'post-publish-data-collector' },
      created_at: new Date().toISOString(),
    };

    // call 1: fetchQueuedScraperTasks
    mockQuery.mockResolvedValueOnce({ rows: [scraperTask] });
    // call 2: completeScraperTask（跳过时仍标记完成）
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await processPendingScraperTasks(mockPool);

    // processed 不增加（跳过不算成功处理）
    expect(result.processed).toBe(0);
    // 仍然调用了 completeScraperTask
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('DB 异常时不抛出，返回 processed=0', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db error'));

    const result = await processPendingScraperTasks(mockPool);

    expect(result.processed).toBe(0);
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
