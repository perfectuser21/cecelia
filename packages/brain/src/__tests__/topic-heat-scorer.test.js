import { describe, it, expect, vi } from 'vitest';
import { upsertPipelinePublishStats } from '../content-analytics.js';
import {
  calcRawHeatScore,
  computeTopicHeatScores,
  normalizeHeatScore,
  HEAT_WEIGHTS,
  HIGH_HEAT_THRESHOLD,
} from '../topic-heat-scorer.js';

// ─── calcRawHeatScore ─────────────────────────────────────────────────────────

describe('calcRawHeatScore()', () => {
  it('按权重公式计算原始分', () => {
    // views*0.1 + likes*3 + comments*5 + shares*7
    const result = calcRawHeatScore({ views: 1000, likes: 50, comments: 20, shares: 10 });
    const expected =
      1000 * HEAT_WEIGHTS.views +
      50 * HEAT_WEIGHTS.likes +
      20 * HEAT_WEIGHTS.comments +
      10 * HEAT_WEIGHTS.shares;
    expect(result).toBeCloseTo(expected);
  });

  it('全零输入返回 0', () => {
    expect(calcRawHeatScore({ views: 0, likes: 0, comments: 0, shares: 0 })).toBe(0);
  });

  it('缺省字段视为 0', () => {
    const result = calcRawHeatScore({ likes: 10 });
    expect(result).toBe(10 * HEAT_WEIGHTS.likes);
  });

  it('评论权重大于点赞权重', () => {
    const likesOnly = calcRawHeatScore({ likes: 1 });
    const commentsOnly = calcRawHeatScore({ comments: 1 });
    expect(commentsOnly).toBeGreaterThan(likesOnly);
  });

  it('转发权重最高', () => {
    const sharesOnly = calcRawHeatScore({ shares: 1 });
    const commentsOnly = calcRawHeatScore({ comments: 1 });
    const likesOnly = calcRawHeatScore({ likes: 1 });
    expect(sharesOnly).toBeGreaterThan(commentsOnly);
    expect(commentsOnly).toBeGreaterThan(likesOnly);
  });
});

// ─── normalizeHeatScore ───────────────────────────────────────────────────────

describe('normalizeHeatScore()', () => {
  it('raw=0 → score=0', () => {
    expect(normalizeHeatScore(0)).toBe(0);
  });

  it('raw=MAX_RAW(1000) → score=100', () => {
    expect(normalizeHeatScore(1000)).toBe(100);
  });

  it('超出 MAX_RAW 时不超过 100', () => {
    expect(normalizeHeatScore(99999)).toBe(100);
  });

  it('raw=500 → score=50', () => {
    expect(normalizeHeatScore(500)).toBe(50);
  });

  it('结果在 0-100 之间', () => {
    for (const raw of [0, 100, 500, 1000, 2000]) {
      const score = normalizeHeatScore(raw);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });
});

// ─── 常量合理性检查 ───────────────────────────────────────────────────────────

describe('HEAT_WEIGHTS 常量', () => {
  it('views 权重最低（被动指标）', () => {
    const weights = Object.values(HEAT_WEIGHTS);
    expect(HEAT_WEIGHTS.views).toBe(Math.min(...weights));
  });

  it('shares 权重最高（主动传播）', () => {
    const weights = Object.values(HEAT_WEIGHTS);
    expect(HEAT_WEIGHTS.shares).toBe(Math.max(...weights));
  });
});

describe('HIGH_HEAT_THRESHOLD', () => {
  it('阈值在合理范围内（50-80）', () => {
    expect(HIGH_HEAT_THRESHOLD).toBeGreaterThanOrEqual(50);
    expect(HIGH_HEAT_THRESHOLD).toBeLessThanOrEqual(80);
  });
});

// Record-only DB protocol seam: call the actual writer, then the actual aggregate mapper
// and score consumer. This fixture does not execute or reimplement SQL aggregation.
describe('实际指标writer到话题热度consumer的字段合同', () => {
  const start = new Date('2026-11-01T00:00:00Z');
  const end = new Date('2026-11-02T00:00:00Z');
  it.each([
    [{ views: 1000, likes: 50, comments: 20, shares: 10 }, 42],
    [{ views: 100 }, 1],
    [{ likes: 100 }, 30],
    [{ views: 1, comments: 100 }, 50.01],
    [{ views: 1, shares: 100 }, 70.01],
  ])('写入指标 %j 经total_*查询映射得到热度%s', async (metrics, expected) => {
    let written;
    const pool = { query: vi.fn(async (sql, params) => {
      if (sql.startsWith('INSERT INTO pipeline_publish_stats')) {
        written = params;
        return { rows: [] };
      }
      expect(sql).toContain('FROM pipeline_publish_stats pps');
      expect(sql).toContain('AS total_views'); expect(sql).toContain('AS total_likes');
      expect(sql).toContain('AS total_comments'); expect(sql).toContain('AS total_shares');
      expect(params.slice(0, 2)).toEqual([start, end]);
      expect(written).toBeDefined();
      return { rows: [{ topic_keyword: 'owned-topic', publish_count: 1,
        total_views: String(written[3]), total_likes: String(written[4]),
        total_comments: String(written[5]), total_shares: String(written[6]) }] };
    }) };
    await upsertPipelinePublishStats(pool, {
      publishTaskId: '11111111-1111-4111-8111-111111111111',
      pipelineId: '22222222-2222-4222-8222-222222222222', platform: 'owned-platform', metrics,
    });
    const result = await computeTopicHeatScores(pool, start, end);
    expect(result).toEqual([{ topic_keyword: 'owned-topic', publish_count: 1,
      total_views: metrics.views ?? 0, total_likes: metrics.likes ?? 0,
      total_comments: metrics.comments ?? 0, total_shares: metrics.shares ?? 0, heat_score: expected }]);
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it('真实评分排序并保持上限100和total_*读者形状', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [
      { topic_keyword: 'cold', publish_count: 1, total_views: '100', total_likes: '0', total_comments: '0', total_shares: '0' },
      { topic_keyword: 'capped', publish_count: 2, total_views: '20000', total_likes: '0', total_comments: '0', total_shares: '0' },
      { topic_keyword: 'warm', publish_count: 1, total_views: '0', total_likes: '100', total_comments: '0', total_shares: '0' },
    ] })) };
    const result = await computeTopicHeatScores(pool, start, end);
    expect(result.map(row => [row.topic_keyword, row.heat_score])).toEqual([
      ['capped', 100], ['warm', 30], ['cold', 1],
    ]);
    expect(result[0]).toMatchObject({ total_views: 20000, publish_count: 2 });
    expect(result[0]).not.toHaveProperty('views');
  });

  it('合法空数据仍返回空列表', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [] })) };
    expect(await computeTopicHeatScores(pool, start, end)).toEqual([]);
    expect(pool.query).toHaveBeenCalledOnce();
  });

  it('查询失败仍拒绝，不将错误伪造为零热度', async () => {
    const pool = { query: vi.fn(async () => { throw Error('owned stats query failed'); }) };
    await expect(computeTopicHeatScores(pool, start, end)).rejects.toThrow('owned stats query failed');
    expect(pool.query).toHaveBeenCalledOnce();
  });
});
