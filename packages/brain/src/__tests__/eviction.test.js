import { describe, it, expect } from 'vitest';
import { calcEvictionScore, TIER_WEIGHTS, REQUEUE_BACKOFF } from '../eviction.js';

describe('calcEvictionScore', () => {
  it('P0 tasks are never evictable (score = -Infinity)', () => {
    expect(calcEvictionScore('P0', 1000, 0)).toBe(-Infinity);
  });

  it('P1 tasks are never evictable (score = -Infinity)', () => {
    expect(calcEvictionScore('P1', 1500, 0)).toBe(-Infinity);
  });

  it('P3 tasks have higher base score than P2', () => {
    const p2Score = calcEvictionScore('P2', 500, 0);
    const p3Score = calcEvictionScore('P3', 500, 0);
    expect(p3Score).toBeGreaterThan(p2Score);
  });

  it('higher RSS = higher eviction score', () => {
    const lowRss = calcEvictionScore('P2', 200, 0);
    const highRss = calcEvictionScore('P2', 1000, 0);
    expect(highRss).toBeGreaterThan(lowRss);
  });

  it('longer runtime gives protection (lower score)', () => {
    const fresh = calcEvictionScore('P2', 500, 0);
    const longRunning = calcEvictionScore('P2', 500, 2 * 60 * 60 * 1000); // 2 hours
    expect(longRunning).toBeLessThan(fresh);
  });
});

describe('TIER_WEIGHTS', () => {
  it('P0/P1 are -Infinity', () => {
    expect(TIER_WEIGHTS.P0).toBe(-Infinity);
    expect(TIER_WEIGHTS.P1).toBe(-Infinity);
  });

  it('P3 > P2', () => {
    expect(TIER_WEIGHTS.P3).toBeGreaterThan(TIER_WEIGHTS.P2);
  });
});

describe('REQUEUE_BACKOFF', () => {
  it('P3 has no backoff', () => {
    expect(REQUEUE_BACKOFF.P3).toBe(0);
  });

  it('P2 has 5 minute backoff', () => {
    expect(REQUEUE_BACKOFF.P2).toBe(5 * 60 * 1000);
  });
});
