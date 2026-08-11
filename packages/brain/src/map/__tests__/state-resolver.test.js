/**
 * 刀3: state-resolver.js 纯函数测试（无需 DB）
 * 覆盖：aggregateCapabilityState 规则、computeSnapshotFreshness 时间计算
 */
import { describe, it, expect, vi } from 'vitest';
import { aggregateCapabilityState, computeSnapshotFreshness } from '../state-resolver.js';

describe('aggregateCapabilityState', () => {
  it('全绿 → green', () => {
    expect(aggregateCapabilityState(['green', 'green', 'green'])).toBe('green');
  });

  it('任一 red → red', () => {
    expect(aggregateCapabilityState(['green', 'red', 'green'])).toBe('red');
  });

  it('red 优先于 unknown', () => {
    expect(aggregateCapabilityState(['unknown', 'red'])).toBe('red');
  });

  it('任一 unknown（无 red）→ unknown', () => {
    expect(aggregateCapabilityState(['green', 'unknown'])).toBe('unknown');
  });

  it('全 gray → gray', () => {
    expect(aggregateCapabilityState(['gray', 'gray'])).toBe('gray');
  });

  it('空数组 → gray', () => {
    expect(aggregateCapabilityState([])).toBe('gray');
  });
});

describe('computeSnapshotFreshness', () => {
  it('null → not fresh', () => {
    const { fresh } = computeSnapshotFreshness(null);
    expect(fresh).toBe(false);
  });

  it('刚扫描 → fresh', () => {
    const now = new Date(Date.now() - 60_000); // 1 分钟前
    const { fresh } = computeSnapshotFreshness(now);
    expect(fresh).toBe(true);
  });

  it('超过 10 分钟 → not fresh', () => {
    const old = new Date(Date.now() - 20 * 60 * 1000); // 20 分钟前
    const { fresh } = computeSnapshotFreshness(old);
    expect(fresh).toBe(false);
  });

  it('10 分钟整仍 fresh，超过 1 秒立即 stale', () => {
    const now = Date.parse('2026-08-11T10:00:00.000Z');
    vi.spyOn(Date, 'now').mockReturnValue(now);

    expect(computeSnapshotFreshness(new Date(now - 600_000)).fresh).toBe(true);
    expect(computeSnapshotFreshness(new Date(now - 601_000)).fresh).toBe(false);

    vi.restoreAllMocks();
  });
});
