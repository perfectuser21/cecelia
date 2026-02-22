/**
 * activation-scorer.js 单元测试
 * DoD: D4, D5, D6 (deadline urgency) + 原有测试
 */

import { describe, it, expect } from 'vitest';
import {
  computeActivationScore,
  PRIORITY_WEIGHTS,
  AGING_MAX,
  USER_PIN_BONUS,
  PROGRESS_BONUS,
  DEPENDENCY_BONUS,
  DEADLINE_URGENCY_MAX,
  DEADLINE_WINDOW_DAYS,
} from '../activation-scorer.js';

const now = new Date('2026-02-22T12:00:00Z');
const COOLDOWN_MS = 120_000; // 2 min

function makeEntity(overrides = {}) {
  return {
    priority: 'P1',
    created_at: new Date('2026-02-20T12:00:00Z'), // 2 days ago
    updated_at: new Date('2026-02-22T11:50:00Z'),  // 10 min ago (past cooldown)
    progress: 0,
    dependency_count: 0,
    user_pinned: false,
    ...overrides,
  };
}

describe('computeActivationScore - priority', () => {
  it('P0 分数高于 P1', () => {
    const p0 = computeActivationScore(makeEntity({ priority: 'P0' }), COOLDOWN_MS, now);
    const p1 = computeActivationScore(makeEntity({ priority: 'P1' }), COOLDOWN_MS, now);
    expect(p0).toBeGreaterThan(p1);
    expect(p0 - p1).toBe(PRIORITY_WEIGHTS.P0 - PRIORITY_WEIGHTS.P1);
  });

  it('P1 分数高于 P2', () => {
    const p1 = computeActivationScore(makeEntity({ priority: 'P1' }), COOLDOWN_MS, now);
    const p2 = computeActivationScore(makeEntity({ priority: 'P2' }), COOLDOWN_MS, now);
    expect(p1).toBeGreaterThan(p2);
  });

  it('无 priority 得 0 分', () => {
    const base = computeActivationScore(makeEntity({ priority: null }), COOLDOWN_MS, now);
    const withP2 = computeActivationScore(makeEntity({ priority: 'P2' }), COOLDOWN_MS, now);
    expect(withP2 - base).toBe(PRIORITY_WEIGHTS.P2);
  });
});

describe('computeActivationScore - aging', () => {
  it('pending 2 天得 4 分 aging', () => {
    const score = computeActivationScore(makeEntity(), COOLDOWN_MS, now);
    // P1(200) + aging(2 days * 2 = 4) = 204
    expect(score).toBe(204);
  });

  it('pending 100+ 天最多 200 分', () => {
    const old = makeEntity({
      created_at: new Date('2025-01-01T00:00:00Z'),
      updated_at: new Date('2026-02-22T11:00:00Z'),
    });
    const score = computeActivationScore(old, COOLDOWN_MS, now);
    // P1(200) + aging(max 200) = 400
    expect(score).toBe(200 + AGING_MAX);
  });
});

describe('computeActivationScore - cooldown', () => {
  it('刚更新不到 2 分钟返回 -Infinity', () => {
    const recent = makeEntity({
      updated_at: new Date('2026-02-22T11:59:00Z'), // 1 min ago
    });
    const score = computeActivationScore(recent, COOLDOWN_MS, now);
    expect(score).toBe(-Infinity);
  });

  it('更新超过 2 分钟正常计分', () => {
    const old = makeEntity({
      updated_at: new Date('2026-02-22T11:50:00Z'), // 10 min ago
    });
    const score = computeActivationScore(old, COOLDOWN_MS, now);
    expect(score).toBeGreaterThan(0);
  });
});

describe('computeActivationScore - user_pinned', () => {
  it('pinned 加 999 分（压倒性优先）', () => {
    const normal = computeActivationScore(makeEntity(), COOLDOWN_MS, now);
    const pinned = computeActivationScore(makeEntity({ user_pinned: true }), COOLDOWN_MS, now);
    expect(pinned - normal).toBe(USER_PIN_BONUS);
    expect(pinned).toBeGreaterThan(500); // 足够压倒一切
  });
});

describe('computeActivationScore - progress bonus', () => {
  it('进度 50% 加 40 分', () => {
    const withProgress = computeActivationScore(
      makeEntity({ progress: 0.5 }),
      COOLDOWN_MS,
      now
    );
    const without = computeActivationScore(makeEntity(), COOLDOWN_MS, now);
    expect(withProgress - without).toBe(PROGRESS_BONUS);
  });

  it('进度 10% 不加分（低于 30%）', () => {
    const low = computeActivationScore(
      makeEntity({ progress: 0.1 }),
      COOLDOWN_MS,
      now
    );
    const none = computeActivationScore(makeEntity(), COOLDOWN_MS, now);
    expect(low).toBe(none);
  });

  it('进度 90% 不加分（高于 70%）', () => {
    const high = computeActivationScore(
      makeEntity({ progress: 0.9 }),
      COOLDOWN_MS,
      now
    );
    const none = computeActivationScore(makeEntity(), COOLDOWN_MS, now);
    expect(high).toBe(none);
  });
});

describe('computeActivationScore - dependency bonus', () => {
  it('有依赖加 80 分', () => {
    const dep = computeActivationScore(
      makeEntity({ dependency_count: 2 }),
      COOLDOWN_MS,
      now
    );
    const noDep = computeActivationScore(makeEntity(), COOLDOWN_MS, now);
    expect(dep - noDep).toBe(DEPENDENCY_BONUS);
  });
});

describe('computeActivationScore - deadline urgency', () => {
  it('D4: deadline 3.5天后 → 线性加分（约 75）', () => {
    // 3.5 days = half of 7-day window → ~50% of 150 = 75
    const deadline = new Date(now.getTime() + 3.5 * 24 * 60 * 60 * 1000);
    const withDeadline = computeActivationScore(
      makeEntity({ deadline: deadline.toISOString() }),
      COOLDOWN_MS,
      now
    );
    const without = computeActivationScore(makeEntity(), COOLDOWN_MS, now);
    const bonus = withDeadline - without;
    expect(bonus).toBe(75); // round(150 * (1 - 3.5/7)) = round(75) = 75
  });

  it('D4: deadline 1天后 → 接近满分', () => {
    const deadline = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);
    const withDeadline = computeActivationScore(
      makeEntity({ deadline: deadline.toISOString() }),
      COOLDOWN_MS,
      now
    );
    const without = computeActivationScore(makeEntity(), COOLDOWN_MS, now);
    const bonus = withDeadline - without;
    // round(150 * (1 - 1/7)) = round(150 * 6/7) = round(128.57) = 129
    expect(bonus).toBe(129);
  });

  it('D5: deadline 已过期 → +DEADLINE_URGENCY_MAX (150)', () => {
    const deadline = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000); // 2天前
    const withDeadline = computeActivationScore(
      makeEntity({ deadline: deadline.toISOString() }),
      COOLDOWN_MS,
      now
    );
    const without = computeActivationScore(makeEntity(), COOLDOWN_MS, now);
    expect(withDeadline - without).toBe(DEADLINE_URGENCY_MAX);
  });

  it('D6: 无 deadline → 不加分', () => {
    const without = computeActivationScore(makeEntity(), COOLDOWN_MS, now);
    const alsoWithout = computeActivationScore(
      makeEntity({ deadline: null }),
      COOLDOWN_MS,
      now
    );
    expect(without).toBe(alsoWithout);
  });

  it('deadline 刚好 7 天后 → 不加分（窗口外）', () => {
    const deadline = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const withDeadline = computeActivationScore(
      makeEntity({ deadline: deadline.toISOString() }),
      COOLDOWN_MS,
      now
    );
    const without = computeActivationScore(makeEntity(), COOLDOWN_MS, now);
    expect(withDeadline - without).toBe(0);
  });

  it('deadline 30 天后 → 不加分（远期）', () => {
    const deadline = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const withDeadline = computeActivationScore(
      makeEntity({ deadline: deadline.toISOString() }),
      COOLDOWN_MS,
      now
    );
    const without = computeActivationScore(makeEntity(), COOLDOWN_MS, now);
    expect(withDeadline - without).toBe(0);
  });

  it('常量值正确', () => {
    expect(DEADLINE_URGENCY_MAX).toBe(150);
    expect(DEADLINE_WINDOW_DAYS).toBe(7);
  });
});
