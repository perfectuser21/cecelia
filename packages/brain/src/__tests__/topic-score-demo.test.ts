/**
 * 选题热度评分 Demo 单元测试
 *
 * 验证 topic-score-demo.js 的核心评分逻辑：
 *   - calcRawHeatScore：原始热度分计算
 *   - normalizeHeatScore：归一化
 *   - scoreTopicEngagement：综合评分 + 高热判断
 *   - rankTopics：多话题排名
 */

import { describe, it, expect } from 'vitest';
import {
  calcRawHeatScore,
  normalizeHeatScore,
  scoreTopicEngagement,
  rankTopics,
  HEAT_WEIGHTS,
} from '../scripts/topic-score-demo.js';

describe('calcRawHeatScore', () => {
  it('应按权重计算原始热度分', () => {
    const raw = calcRawHeatScore({ views: 1000, likes: 0, comments: 0, shares: 0 });
    expect(raw).toBe(1000 * HEAT_WEIGHTS.views);
  });

  it('likes/comments/shares 权重高于 views', () => {
    const rawViews = calcRawHeatScore({ views: 100, likes: 0, comments: 0, shares: 0 });
    const rawLikes = calcRawHeatScore({ views: 0, likes: 10, comments: 0, shares: 0 });
    // 10 likes raw = 30, 100 views raw = 10
    expect(rawLikes).toBeGreaterThan(rawViews);
  });

  it('缺省值为0时不报错', () => {
    expect(() => calcRawHeatScore({})).not.toThrow();
    expect(calcRawHeatScore({})).toBe(0);
  });

  it('shares 权重最高', () => {
    const one = { views: 0, likes: 0, comments: 0, shares: 0 };
    const withShare = { ...one, shares: 1 };
    const withComment = { ...one, comments: 1 };
    const withLike = { ...one, likes: 1 };
    expect(calcRawHeatScore(withShare)).toBeGreaterThan(calcRawHeatScore(withComment));
    expect(calcRawHeatScore(withComment)).toBeGreaterThan(calcRawHeatScore(withLike));
  });
});

describe('normalizeHeatScore', () => {
  it('raw=0 → score=0', () => {
    expect(normalizeHeatScore(0)).toBe(0);
  });

  it('raw=1000(MAX) → score=100', () => {
    expect(normalizeHeatScore(1000)).toBe(100);
  });

  it('超出上限时不超过100', () => {
    expect(normalizeHeatScore(9999)).toBe(100);
  });

  it('raw=500 → score=50', () => {
    expect(normalizeHeatScore(500)).toBe(50);
  });
});

describe('scoreTopicEngagement', () => {
  it('高热话题 score >= 60 时 isHot=true', () => {
    // raw=660 → score=66
    const result = scoreTopicEngagement({ views: 1900, likes: 68, comments: 28, shares: 18 });
    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.isHot).toBe(true);
  });

  it('低热话题 score < 60 时 isHot=false', () => {
    // raw≈172 → score≈17
    const result = scoreTopicEngagement({ views: 600, likes: 18, comments: 6, shares: 4 });
    expect(result.score).toBeLessThan(60);
    expect(result.isHot).toBe(false);
  });

  it('返回 raw/score/isHot 三个字段', () => {
    const result = scoreTopicEngagement({ views: 100, likes: 10, comments: 5, shares: 3 });
    expect(result).toHaveProperty('raw');
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('isHot');
  });
});

describe('rankTopics', () => {
  const testTopics = [
    { keyword: '话题A', metrics: { views: 600, likes: 18, comments: 6, shares: 4 } },
    { keyword: '话题B', metrics: { views: 2800, likes: 96, comments: 42, shares: 28 } },
    { keyword: '话题C', metrics: { views: 1300, likes: 44, comments: 18, shares: 11 } },
  ];

  it('应按热度分降序排列', () => {
    const ranked = rankTopics(testTopics);
    expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);
    expect(ranked[1].score).toBeGreaterThanOrEqual(ranked[2].score);
  });

  it('最高分话题 rank=1', () => {
    const ranked = rankTopics(testTopics);
    expect(ranked[0].rank).toBe(1);
    expect(ranked[0].keyword).toBe('话题B');
  });

  it('rank 字段连续从1开始', () => {
    const ranked = rankTopics(testTopics);
    ranked.forEach((t, i) => {
      expect(t.rank).toBe(i + 1);
    });
  });

  it('空数组不报错', () => {
    expect(() => rankTopics([])).not.toThrow();
    expect(rankTopics([])).toEqual([]);
  });
});
