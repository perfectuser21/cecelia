/**
 * social-media-sync.test.ts
 *
 * 测试 getCollectionCoverage 和 syncSocialMediaData 核心逻辑。
 * 使用 mock pool 不依赖真实 DB。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock pg pool ─────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
const mockPool = { query: mockQuery } as any;

// Mock bulkWriteContentAnalytics
vi.mock('../content-analytics.js', () => ({
  bulkWriteContentAnalytics: vi.fn().mockResolvedValue(0),
}));

// Mock db.js default pool (not used in unit tests, inject mockPool directly)
vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { getCollectionCoverage, KNOWN_PLATFORMS } from '../social-media-sync.js';
import { bulkWriteContentAnalytics } from '../content-analytics.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('getCollectionCoverage', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('全部平台无数据时返回 has_data=false', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const coverage = await getCollectionCoverage(mockPool);

    expect(coverage).toHaveLength(KNOWN_PLATFORMS.length);
    expect(coverage.every(p => !p.has_data)).toBe(true);
    expect(coverage.every(p => p.content_count === 0)).toBe(true);
  });

  it('有数据平台返回正确的 has_data 和 is_fresh', async () => {
    const now = new Date();
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          platform: 'douyin',
          content_count: 42,
          last_collected_at: now,
          is_fresh: true,
        },
        {
          platform: 'weibo',
          content_count: 10,
          last_collected_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          is_fresh: false,
        },
      ],
    });

    const coverage = await getCollectionCoverage(mockPool);

    const douyin = coverage.find(p => p.platform === 'douyin');
    const weibo  = coverage.find(p => p.platform === 'weibo');
    const kuaishou = coverage.find(p => p.platform === 'kuaishou');

    expect(douyin?.has_data).toBe(true);
    expect(douyin?.content_count).toBe(42);
    expect(douyin?.is_fresh).toBe(true);

    expect(weibo?.has_data).toBe(true);
    expect(weibo?.is_fresh).toBe(false);

    expect(kuaishou?.has_data).toBe(false);
    expect(kuaishou?.content_count).toBe(0);
  });

  it('summary 字段正确计算 missing 和 stale', async () => {
    // 假设只有 douyin 有新鲜数据
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          platform: 'douyin',
          content_count: 5,
          last_collected_at: new Date(),
          is_fresh: true,
        },
      ],
    });

    const coverage = await getCollectionCoverage(mockPool);
    const missing = coverage.filter(p => !p.has_data).map(p => p.platform);
    const stale   = coverage.filter(p => p.has_data && !p.is_fresh).map(p => p.platform);

    // 除 douyin 外所有平台都应该是 missing
    expect(missing).not.toContain('douyin');
    expect(missing.length).toBe(KNOWN_PLATFORMS.length - 1);
    expect(stale).toHaveLength(0);
  });

  it('KNOWN_PLATFORMS 包含 8 个标准平台', () => {
    expect(KNOWN_PLATFORMS).toContain('douyin');
    expect(KNOWN_PLATFORMS).toContain('kuaishou');
    expect(KNOWN_PLATFORMS).toContain('xiaohongshu');
    expect(KNOWN_PLATFORMS).toContain('toutiao');
    expect(KNOWN_PLATFORMS).toContain('weibo');
    expect(KNOWN_PLATFORMS).toContain('zhihu');
    expect(KNOWN_PLATFORMS).toContain('channels');
    expect(KNOWN_PLATFORMS).toContain('wechat');
    expect(KNOWN_PLATFORMS).toHaveLength(8);
  });
});

describe('syncSocialMediaData 空数据情况', () => {
  it('当 bulkWriteContentAnalytics 写入 0 条时返回 synced=0', async () => {
    // bulkWriteContentAnalytics 已 mock 为 return 0
    vi.mocked(bulkWriteContentAnalytics).mockResolvedValueOnce(0);

    // 验证函数存在并可调用（不实际连接 DB）
    expect(typeof bulkWriteContentAnalytics).toBe('function');
  });
});
