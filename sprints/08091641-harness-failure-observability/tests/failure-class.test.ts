import { describe, it, expect } from 'vitest';
// 受控枚举单一来源模块（本 sprint 新增，红阶段 import 失败）
import {
  FAILURE_CLASSES,
  isValidFailureClass,
  assertFailureClass,
  buildFailureResultPatch,
  computeFailureStats,
} from '../../../packages/brain/src/orchestrator/failure-class.js';

describe('failure-class controlled enum [BEHAVIOR]', () => {
  it('FAILURE_CLASSES is frozen', () => {
    expect(Object.isFrozen(FAILURE_CLASSES)).toBe(true);
    expect(FAILURE_CLASSES).toContain('timeout');
    expect(FAILURE_CLASSES).toContain('runtime_crash');
    expect(FAILURE_CLASSES).toContain('unknown');
  });

  it('isValidFailureClass accepts enum member and rejects others', () => {
    expect(isValidFailureClass('timeout')).toBe(true);
    expect(isValidFailureClass('free_text_bogus')).toBe(false);
  });

  it('assertFailureClass rejects free text', () => {
    expect(() => assertFailureClass('free_text_bogus')).toThrow(/invalid failure_class/i);
    expect(() => assertFailureClass('timeout')).not.toThrow();
  });

  it('buildFailureResultPatch returns failure_class and failure_detail', () => {
    const patch = buildFailureResultPatch('timeout', 'synthetic detail');
    expect(patch).toEqual({ failure_class: 'timeout', failure_detail: 'synthetic detail' });
    // 非法枚举必须抛错，不得静默落库自由文本
    expect(() => buildFailureResultPatch('nope', 'x')).toThrow(/invalid failure_class/i);
  });

  it('computeFailureStats returns failure_rate and by_class', () => {
    const rows = [
      { failure_class: 'timeout', is_terminal_failed: true },
      { failure_class: 'timeout', is_terminal_failed: true },
      { failure_class: 'runtime_crash', is_terminal_failed: true },
      { failure_class: null, is_terminal_failed: false }, // terminal done（分母的一部分）
    ];
    const stats = computeFailureStats(rows);
    expect(stats.by_class).toEqual({ timeout: 2, runtime_crash: 1 });
    expect(stats.total_terminal_failed).toBe(3);
    expect(stats.total_terminal_done).toBe(1);
    // 滚动失败率 = 3 / (3 + 1) = 0.75
    expect(stats.failure_rate).toBeCloseTo(0.75, 2);
  });

  it('computeFailureStats returns failure_rate 0 when denominator is zero', () => {
    const stats = computeFailureStats([]);
    expect(stats.failure_rate).toBe(0);
    expect(stats.by_class).toEqual({});
  });
});
