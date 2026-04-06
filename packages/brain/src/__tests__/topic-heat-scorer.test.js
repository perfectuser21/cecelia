import { describe, it, expect } from 'vitest';
import {
  calcRawHeatScore,
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
