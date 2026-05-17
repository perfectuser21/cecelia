/**
 * capacity.js 单元测试
 * DoD: D1, D2, D3
 */

import { describe, it, expect } from 'vitest';
import { computeCapacity, isAtCapacity, MAX_ACTIVE_PROJECTS, getMaxStreams } from '../capacity.js';

describe('computeCapacity - project max 聚焦执行', () => {
  it('D1: SLOTS=9 → project.max = 2（不超过 MAX_ACTIVE_PROJECTS）', () => {
    const cap = computeCapacity(9);
    expect(cap.project.max).toBe(2);
  });

  it('D2: SLOTS=1 → project.max = 1（min(2, ceil(1/2))=1）', () => {
    const cap = computeCapacity(1);
    expect(cap.project.max).toBe(1);
  });

  it('D3: MAX_ACTIVE_PROJECTS 常量导出值为 2', () => {
    expect(MAX_ACTIVE_PROJECTS).toBe(2);
  });

  it('SLOTS=4 → project.max = 2（min(2, ceil(4/2))=2）', () => {
    const cap = computeCapacity(4);
    expect(cap.project.max).toBe(2);
  });

  it('SLOTS=20 → project.max = 2（不管 SLOTS 多大都不超过 2）', () => {
    const cap = computeCapacity(20);
    expect(cap.project.max).toBe(2);
  });

  it('SLOTS=3 → project.max = 2（min(2, ceil(3/2))=2）', () => {
    const cap = computeCapacity(3);
    expect(cap.project.max).toBe(2);
  });
});

describe('computeCapacity - 其他层级不变', () => {
  it('SLOTS=9 返回正确的 initiative 和 task cap', () => {
    const cap = computeCapacity(9);

    expect(cap.slots).toBe(9);

    // Project: min(2, ceil(9/2)) = 2
    expect(cap.project.max).toBe(2);
    expect(cap.project.softMin).toBe(1);
    expect(cap.project.cooldownMs).toBe(180_000);

    // Initiative: max = 9, softMin = ceil(9/3) = 3（不变）
    expect(cap.initiative.max).toBe(9);
    expect(cap.initiative.softMin).toBe(3);
    expect(cap.initiative.cooldownMs).toBe(120_000);

    // Task: queuedCap = 27, softMin = 9（不变）
    expect(cap.task.queuedCap).toBe(27);
    expect(cap.task.softMin).toBe(9);
    expect(cap.task.cooldownMs).toBe(60_000);
  });

  it('SLOTS=0 或负数安全处理（至少 1）', () => {
    const cap0 = computeCapacity(0);
    expect(cap0.slots).toBe(1);
    expect(cap0.project.max).toBe(1);
    expect(cap0.initiative.max).toBe(1);
    expect(cap0.task.queuedCap).toBe(3);

    const capNeg = computeCapacity(-5);
    expect(capNeg.slots).toBe(1);
  });

  it('SLOTS 小数向下取整', () => {
    const cap = computeCapacity(9.7);
    expect(cap.slots).toBe(9);
  });
});

describe('getMaxStreams - 动态资源计算', () => {
  it('should return a positive integer', () => {
    const streams = getMaxStreams();
    expect(streams).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(streams)).toBe(true);
  });

  it('computeCapacity() without argument uses getMaxStreams()', () => {
    const cap = computeCapacity();
    expect(cap.slots).toBeGreaterThanOrEqual(1);
    expect(cap.project.max).toBeGreaterThanOrEqual(1);
  });
});

describe('isAtCapacity', () => {
  it('达到上限返回 true', () => {
    expect(isAtCapacity(5, 5)).toBe(true);
    expect(isAtCapacity(6, 5)).toBe(true);
  });

  it('未达上限返回 false', () => {
    expect(isAtCapacity(3, 5)).toBe(false);
    expect(isAtCapacity(0, 5)).toBe(false);
  });
});
