/**
 * decomposition-checker.js capacity gate 测试
 * DoD: D5
 */

import { describe, it, expect } from 'vitest';
import { computeCapacity, isAtCapacity } from '../capacity.js';

describe('Capacity gate logic', () => {
  it('projects at capacity → skips checks 1-4', () => {
    const cap = computeCapacity(9);
    // 5 active projects = at capacity (max=5)
    expect(isAtCapacity(5, cap.project.max)).toBe(true);
    expect(isAtCapacity(6, cap.project.max)).toBe(true);
  });

  it('projects below capacity → allows checks 1-4', () => {
    const cap = computeCapacity(9);
    expect(isAtCapacity(3, cap.project.max)).toBe(false);
    expect(isAtCapacity(0, cap.project.max)).toBe(false);
  });

  it('initiatives at capacity → skips check 5', () => {
    const cap = computeCapacity(9);
    // 9 active initiatives = at capacity (max=9)
    expect(isAtCapacity(9, cap.initiative.max)).toBe(true);
    expect(isAtCapacity(10, cap.initiative.max)).toBe(true);
  });

  it('initiatives below capacity → allows check 5', () => {
    const cap = computeCapacity(9);
    expect(isAtCapacity(5, cap.initiative.max)).toBe(false);
  });

  it('tasks at capacity → skips inventory + checks 6-7', () => {
    const cap = computeCapacity(9);
    // 27 queued tasks = at capacity (queuedCap=27)
    expect(isAtCapacity(27, cap.task.queuedCap)).toBe(true);
    expect(isAtCapacity(30, cap.task.queuedCap)).toBe(true);
  });

  it('tasks below capacity → allows inventory + checks 6-7', () => {
    const cap = computeCapacity(9);
    expect(isAtCapacity(10, cap.task.queuedCap)).toBe(false);
  });

  it('SLOTS=4 tightens all caps', () => {
    const cap = computeCapacity(4);
    // Project max=2, Initiative max=4, Task queuedCap=12
    expect(isAtCapacity(2, cap.project.max)).toBe(true);
    expect(isAtCapacity(4, cap.initiative.max)).toBe(true);
    expect(isAtCapacity(12, cap.task.queuedCap)).toBe(true);

    // Below cap
    expect(isAtCapacity(1, cap.project.max)).toBe(false);
    expect(isAtCapacity(3, cap.initiative.max)).toBe(false);
    expect(isAtCapacity(10, cap.task.queuedCap)).toBe(false);
  });
});
