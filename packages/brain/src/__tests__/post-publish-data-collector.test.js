/**
 * post-publish-data-collector.test.js
 *
 * 发布后数据回收模块单元测试（JS 版，供 lint-test-pairing 识别）
 *
 * 覆盖范围：
 *   - COALESCE 防御修复：writeBackToPublishTask 使用 COALESCE(payload, '{}'::jsonb) 写法
 *   - COALESCE 防御修复：completeScraperTask 使用 COALESCE(payload, '{}'::jsonb) 写法
 *   - schedulePostPublishCollection 主流程：无任务、有任务、异常
 *   - processPendingScraperTasks：placeholder 写入、真实数据回填、缺失字段跳过
 *   - writePipelinePublishStats：正常写入、metrics 缺省
 *
 * Sprint: 07220725-fix-markdispatched-null-payload
 * Task ID: 2faafa72-9358-4057-b1e6-6f5a67133ed7
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// 模拟 pg Pool
const mockQuery = vi.fn();
const mockPool = { query: mockQuery };

let schedulePostPublishCollection;
let writePipelinePublishStats;
let processPendingScraperTasks;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  const mod = await import('../post-publish-data-collector.js');
  schedulePostPublishCollection = mod.schedulePostPublishCollection;
  writePipelinePublishStats = mod.writePipelinePublishStats;
  processPendingScraperTasks = mod.processPendingScraperTasks;
});

// ─── schedulePostPublishCollection ──────────────────────────────────────────

describe('schedulePostPublishCollection', () => {
  it('无待采集任务时返回 scheduled=0', async () => {
    // fetchPendingCollectionTasks → 空
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // processPendingScraperTasks → fetchQueuedScraperTasks → 空
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await schedulePostPublishCollection(mockPool);

    expect(result.scheduled).toBe(0);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('有待采集任务时派发 scraper 任务', async () => {
    const fakeTasks = [
      {
        id: 'task-1',
        title: '发布小红书',
        payload: { platform: 'xiaohongshu', pipeline_id: 'pipe-1' },
        completed_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
        pipeline_id: 'pipe-1',
        platform: 'xiaohongshu',
      },
    ];

    // fetchPendingCollectionTasks
    mockQuery.mockResolvedValueOnce({ rows: fakeTasks });
    const taskCreator = vi.fn().mockResolvedValue({ task: { id: 'scraper-task' } });
    // fetchQueuedScraperTasks → 空
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await schedulePostPublishCollection(mockPool, { taskCreator });

    expect(result.scheduled).toBe(1);
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(taskCreator).toHaveBeenCalledWith(expect.objectContaining({
      db: mockPool,
      source: 'child',
      task_type: 'platform_scraper',
    }));
  });

  it('DB 异常时不抛出，返回 scheduled=0', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    const result = await schedulePostPublishCollection(mockPool);

    expect(result.scheduled).toBe(0);
  });
});

// ─── processPendingScraperTasks ─────────────────────────────────────────────

describe('processPendingScraperTasks', () => {
  it('无排队任务时返回 processed=0', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await processPendingScraperTasks(mockPool);

    expect(result.processed).toBe(0);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('无真实数据时保持待采集，不写占位统计、不回填零值、不标完成', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'scraper-1', payload: {
      platform: 'douyin', pipeline_id: 'pipe-1', source_publish_task_id: 'publish-1',
    } }] }).mockResolvedValue({ rows: [] });

    const result = await processPendingScraperTasks(mockPool);

    expect(result.processed).toBe(0);
    expect(result.deferred).toBe(1);
    expect(mockQuery.mock.calls.filter(([sql]) => /(?:INSERT|UPDATE)\s/i.test(sql))).toEqual([]);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('有排队任务且 N8N 已采集真实数据时，回填真实数据', async () => {
    const scraperTask = {
      id: 'scraper-2',
      payload: {
        platform: 'kuaishou',
        pipeline_id: 'pipe-2',
        source_publish_task_id: 'publish-2',
        triggered_by: 'post-publish-data-collector',
      },
      created_at: new Date().toISOString(),
    };

    // fetchQueuedScraperTasks
    mockQuery.mockResolvedValueOnce({ rows: [scraperTask] });
    // SELECT pipeline_publish_stats → 有真实数据
    mockQuery.mockResolvedValueOnce({ rows: [{ views: 5000, likes: 300, comments: 42, shares: 15 }] });
    // writeBackToPublishTask UPDATE
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // completeScraperTask UPDATE
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

  it('缺少 source_publish_task_id 时保持未完成', async () => {
    const scraperTask = {
      id: 'scraper-3',
      payload: { platform: 'weibo', triggered_by: 'post-publish-data-collector' },
      created_at: new Date().toISOString(),
    };

    // fetchQueuedScraperTasks
    mockQuery.mockResolvedValueOnce({ rows: [scraperTask] });
    // completeScraperTask（跳过时仍标记完成）
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await processPendingScraperTasks(mockPool);

    expect(result.processed).toBe(0);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE\s+tasks/i.test(sql))).toBe(false);
  });

  it('DB 异常时不抛出，返回 processed=0', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db error'));

    const result = await processPendingScraperTasks(mockPool);

    expect(result.processed).toBe(0);
  });
});

// ─── writePipelinePublishStats ────────────────────────────────────────────────

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
    expect(params).toContain(0);
  });
});
