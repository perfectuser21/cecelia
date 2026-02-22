/**
 * capacity.js 单元测试
 * DoD: D1
 */

import { describe, it, expect } from 'vitest';
import { computeCapacity, isAtCapacity } from '../capacity.js';

describe('computeCapacity', () => {
  it('SLOTS=9 返回正确的各层 cap', () => {
    const cap = computeCapacity(9);

    expect(cap.slots).toBe(9);

    // Project: ceil(9/2) = 5, softMin = 1
    expect(cap.project.max).toBe(5);
    expect(cap.project.softMin).toBe(1);
    expect(cap.project.cooldownMs).toBe(180_000);

    // Initiative: max = 9, softMin = ceil(9/3) = 3
    expect(cap.initiative.max).toBe(9);
    expect(cap.initiative.softMin).toBe(3);
    expect(cap.initiative.cooldownMs).toBe(120_000);

    // Task: queuedCap = 27, softMin = 9
    expect(cap.task.queuedCap).toBe(27);
    expect(cap.task.softMin).toBe(9);
    expect(cap.task.cooldownMs).toBe(60_000);
  });

  it('SLOTS=4 缩小（设备降级场景）', () => {
    const cap = computeCapacity(4);

    expect(cap.slots).toBe(4);
    expect(cap.project.max).toBe(2);       // ceil(4/2) = 2
    expect(cap.project.softMin).toBe(1);
    expect(cap.initiative.max).toBe(4);
    expect(cap.initiative.softMin).toBe(2); // ceil(4/3) = 2
    expect(cap.task.queuedCap).toBe(12);
    expect(cap.task.softMin).toBe(4);
  });

  it('SLOTS=20 放大（设备升级场景）', () => {
    const cap = computeCapacity(20);

    expect(cap.slots).toBe(20);
    expect(cap.project.max).toBe(10);       // ceil(20/2) = 10
    expect(cap.project.softMin).toBe(1);
    expect(cap.initiative.max).toBe(20);
    expect(cap.initiative.softMin).toBe(7); // ceil(20/3) = 7
    expect(cap.task.queuedCap).toBe(60);
    expect(cap.task.softMin).toBe(20);
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
