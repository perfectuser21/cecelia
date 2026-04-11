/**
 * collection-dashboard.test.js
 *
 * 测试 GET /api/brain/analytics/collection-dashboard 端点：
 * - 正常返回结构
 * - normality_rate 计算逻辑
 * - 空数据时正常率为 0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => {
  const mockPool = { query: vi.fn() };
  return { default: mockPool };
});

// 依赖 social-media-sync（被 analytics.js import）
vi.mock('../social-media-sync.js', () => ({
  syncSocialMediaData: vi.fn().mockResolvedValue({ synced: 0, skipped: 0, source_count: 0 }),
  getCollectionCoverage: vi.fn().mockResolvedValue([]),
  KNOWN_PLATFORMS: [],
}));
vi.mock('../stats.js', () => ({
  getMonthlyPRCount: vi.fn(),
  getMonthlyPRsByKR: vi.fn(),
  getPRSuccessRate: vi.fn(),
  getPRTrend: vi.fn(),
}));
vi.mock('../cortex.js', () => ({ searchRelevantAnalyses: vi.fn() }));
vi.mock('../cortex-quality.js', () => ({
  evaluateQualityInitial: vi.fn(),
  checkShouldCreateRCA: vi.fn(),
  getQualityStats: vi.fn(),
}));
vi.mock('../decomposition-checker.js', () => ({ runDecompositionChecks: vi.fn() }));
vi.mock('./shared.js', () => ({ getActiveExecutionPaths: vi.fn(), INVENTORY_CONFIG: {} }));
vi.mock('../content-analytics.js', () => ({
  writeContentAnalytics: vi.fn(),
  bulkWriteContentAnalytics: vi.fn(),
  queryWeeklyROI: vi.fn(),
  getTopContentByPlatform: vi.fn(),
  upsertPipelinePublishStats: vi.fn(),
}));
vi.mock('../daily-scrape-scheduler.js', () => ({ scheduleDailyScrape: vi.fn() }));
vi.mock('../account-usage.js', () => ({ getAccountUsage: vi.fn() }));

import pool from '../db.js';
import analyticsRouter from '../routes/analytics.js';

function getHandler(path) {
  const layers = analyticsRouter.stack.filter(
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
    status(code) { this._status = code; return this; },
    json(data) { this._data = data; return this; },
  };
  return { req, res };
}

describe('GET /analytics/collection-dashboard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('有数据时返回正确结构', async () => {
    // 使用相对日期（基于 Asia/Shanghai 时区），确保测试与日期无关
    const tzNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
    const daysAgo = (n) => {
      const d = new Date(tzNow);
      d.setDate(d.getDate() - n);
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    };
    // 模拟 3 次 pool.query 调用：daily_counts / task_stats / last_collected
    pool.query
      .mockResolvedValueOnce({ rows: [
        { platform: 'douyin', day: daysAgo(2), count: 10 },
        { platform: 'douyin', day: daysAgo(1), count: 8 },
        { platform: 'weibo',  day: daysAgo(1), count: 3 },
      ]})
      .mockResolvedValueOnce({ rows: [
        { platform: 'douyin', total_tasks: 2, failed_tasks: 0, completed_tasks: 2, avg_latency_min: 5.2 },
        { platform: 'weibo',  total_tasks: 1, failed_tasks: 0, completed_tasks: 1, avg_latency_min: 8.0 },
      ]})
      .mockResolvedValueOnce({ rows: [
        { platform: 'douyin', last_collected_at: new Date('2026-04-06') },
        { platform: 'weibo',  last_collected_at: new Date('2026-04-06') },
      ]});

    const handler = getHandler('/analytics/collection-dashboard');
    const { req, res } = mockReqRes({ days: '7' });
    await handler(req, res);

    expect(res._status).toBe(200);
    const data = res._data;
    expect(data).toHaveProperty('normality_rate');
    expect(data).toHaveProperty('platforms');
    expect(data).toHaveProperty('summary');
    expect(Array.isArray(data.platforms)).toBe(true);

    const douyin = data.platforms.find(p => p.platform === 'douyin');
    expect(douyin).toBeDefined();
    expect(douyin.total_count).toBe(18);
    expect(douyin.avg_latency_min).toBe(5.2);
    expect(douyin.failure_rate).toBe(0);
    expect(douyin.is_healthy).toBe(true);
  });

  it('无数据时 normality_rate 为 0', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const handler = getHandler('/analytics/collection-dashboard');
    const { req, res } = mockReqRes({ days: '7' });
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._data.normality_rate).toBe(0);
    expect(res._data.summary.total_data_points).toBe(0);
    expect(res._data.summary.platforms_missing.length).toBeGreaterThan(0);
  });

  it('DB 出错时返回 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('connection refused'));

    const handler = getHandler('/analytics/collection-dashboard');
    const { req, res } = mockReqRes({});
    await handler(req, res);

    expect(res._status).toBe(500);
    expect(res._data).toHaveProperty('error');
  });
});
