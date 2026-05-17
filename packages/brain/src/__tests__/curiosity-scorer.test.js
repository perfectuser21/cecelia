/**
 * Curiosity Scorer 单元测试
 * 测试三维评分逻辑：探索多样性、发现质量、行动转化
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn() }
}));

import pool from '../db.js';
import { calculateCuriosityScore, getCachedScore } from '../curiosity-scorer.js';

beforeEach(() => {
  vi.clearAllMocks();
});

// 构造 mockDB：依次返回多个 query 结果
function mockDbSequence(pool, results) {
  let i = 0;
  pool.query.mockImplementation(() => Promise.resolve(results[i++]));
}

describe('calculateCuriosityScore', () => {
  it('有数据时正确计算三维分数', async () => {
    mockDbSequence(pool, [
      // 维度1：探索多样性 - 3个不同领域，10个任务
      { rows: [{ unique_domains: '3', total_tasks: '10', domains: ['agent_ops', 'dev', 'research'] }] },
      // 维度2：发现质量 - 5条洞察
      { rows: [{ insight_count: '5' }] },
      // 维度3：行动转化 - 8/10 完成
      { rows: [{ total: '10', completed: '8' }] },
      // 缓存写入
      { rows: [] },
    ]);

    const result = await calculateCuriosityScore(pool);

    expect(result.total_score).toBeGreaterThanOrEqual(0);
    expect(result.total_score).toBeLessThanOrEqual(100);
    expect(result.dimensions).toHaveProperty('diversity');
    expect(result.dimensions).toHaveProperty('quality');
    expect(result.dimensions).toHaveProperty('conversion');
    expect(result.dimensions.diversity.score).toBe(60);  // 3/5 * 100
    expect(result.dimensions.quality.score).toBe(50);    // 5/10 * 100
    expect(result.dimensions.conversion.score).toBe(100); // 8/10 / 0.8 = 1.0
    expect(result.calculated_at).toBeTruthy();

    // 加权总分：60*0.4 + 50*0.4 + 100*0.2 = 24 + 20 + 20 = 64
    expect(result.total_score).toBe(64);
  });

  it('无任何数据时返回 0 分', async () => {
    mockDbSequence(pool, [
      { rows: [{ unique_domains: '0', total_tasks: '0', domains: [] }] },
      { rows: [{ insight_count: '0' }] },
      { rows: [{ total: '0', completed: '0' }] },
      { rows: [] },
    ]);

    const result = await calculateCuriosityScore(pool);

    expect(result.total_score).toBe(0);
    expect(result.dimensions.diversity.score).toBe(0);
    expect(result.dimensions.quality.score).toBe(0);
    expect(result.dimensions.conversion.score).toBe(0);
  });

  it('满分场景：5+ 领域、10+ 洞察、80%+ 完成率', async () => {
    mockDbSequence(pool, [
      { rows: [{ unique_domains: '5', total_tasks: '20', domains: ['a','b','c','d','e'] }] },
      { rows: [{ insight_count: '12' }] },
      { rows: [{ total: '20', completed: '18' }] },
      { rows: [] },
    ]);

    const result = await calculateCuriosityScore(pool);

    expect(result.total_score).toBe(100);
    expect(result.dimensions.diversity.score).toBe(100);
    expect(result.dimensions.quality.score).toBe(100);
    expect(result.dimensions.conversion.score).toBe(100);
  });

  it('DB 查询失败时回退读取缓存', async () => {
    pool.query
      .mockRejectedValueOnce(new Error('DB down'))
      // 缓存读取返回 null（无缓存）
      .mockResolvedValueOnce({ rows: [] });

    const result = await calculateCuriosityScore(pool);
    expect(result).toBeNull();
  });

  it('分数被 clamp 到 0-100 范围', async () => {
    mockDbSequence(pool, [
      { rows: [{ unique_domains: '999', total_tasks: '999', domains: Array(999).fill('x') }] },
      { rows: [{ insight_count: '999' }] },
      { rows: [{ total: '1', completed: '1' }] },
      { rows: [] },
    ]);

    const result = await calculateCuriosityScore(pool);
    expect(result.total_score).toBeLessThanOrEqual(100);
    expect(result.total_score).toBeGreaterThanOrEqual(0);
  });
});

describe('getCachedScore', () => {
  it('有缓存时返回解析后的对象', async () => {
    const cached = {
      total_score: 75,
      dimensions: { diversity: { score: 80 }, quality: { score: 70 }, conversion: { score: 75 } },
      calculated_at: '2026-03-11T10:00:00Z',
    };
    pool.query.mockResolvedValueOnce({
      rows: [{ value_json: JSON.stringify(cached), updated_at: '2026-03-11T10:00:00Z' }]
    });

    const result = await getCachedScore(pool);
    expect(result.total_score).toBe(75);
    expect(result.cached_at).toBeTruthy();
  });

  it('无缓存时返回 null', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await getCachedScore(pool);
    expect(result).toBeNull();
  });

  it('DB 错误时返回 null', async () => {
    pool.query.mockRejectedValueOnce(new Error('DB error'));

    const result = await getCachedScore(pool);
    expect(result).toBeNull();
  });
});
