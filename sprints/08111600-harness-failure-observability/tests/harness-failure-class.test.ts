import { describe, it, expect } from 'vitest';
// TDD Red: 模块尚不存在 → import 失败 → 全部 red，直到 generator 实现
// @ts-ignore
import { FAILURE_CLASSES, normalizeFailureClass } from '../../../packages/brain/src/harness-failure-class.js';

describe('harness-failure-class 枚举与规范化 [BEHAVIOR]', () => {
  it('FAILURE_CLASSES 冻结', () => {
    expect(Object.isFrozen(FAILURE_CLASSES)).toBe(true);
    expect(FAILURE_CLASSES).toContain('unclassified');
  });

  it('normalizeFailureClass 非枚举归 unclassified', () => {
    expect(normalizeFailureClass('watchdog_deadline')).toBe('watchdog_deadline');
    expect(normalizeFailureClass('free text xyz')).toBe('unclassified');
    expect(normalizeFailureClass(null)).toBe('unclassified');
    expect(normalizeFailureClass(undefined)).toBe('unclassified');
  });
});
