import { describe, it, expect } from 'vitest';
import { computeProgress } from '../advancement-progress.js';

describe('computeProgress', () => {
  it('空账本 pct=0', () => {
    expect(computeProgress({ done: 0, doing: 0, todo: 0 }))
      .toEqual({ done: 0, doing: 0, todo: 0, total: 0, pct: 0 });
  });
  it('1/3 完成 pct=33（四舍五入）', () => {
    expect(computeProgress({ done: 1, doing: 0, todo: 2 }))
      .toEqual({ done: 1, doing: 0, todo: 2, total: 3, pct: 33 });
  });
  it('全完成 pct=100', () => {
    expect(computeProgress({ done: 2, doing: 0, todo: 0 }))
      .toEqual({ done: 2, doing: 0, todo: 0, total: 2, pct: 100 });
  });
  it('缺字段按 0 处理', () => {
    expect(computeProgress({ done: 1 })).toEqual({ done: 1, doing: 0, todo: 0, total: 1, pct: 100 });
  });
});
