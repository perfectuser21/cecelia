/**
 * S3 联动清单单元测试（MJ5 刀3）
 *
 * DoD 行为验证：
 * [BEHAVIOR] B1 — tests/ 路径断言 isRunnable 返回 true
 * [BEHAVIOR] B2 — manual: 前缀断言 isRunnable 返回 true
 * [BEHAVIOR] B3 — null assertion_ref isRunnable 返回 false
 * [BEHAVIOR] B4 — 其他路径（非 tests/ 非 manual:）isRunnable 返回 false
 * [BEHAVIOR] B5 — buildCascadeReport 混合格子输出正确分类和计数
 * [BEHAVIOR] B6 — buildCascadeReport 全可跑格子输出正确 runnable_count
 * [BEHAVIOR] B7 — buildCascadeReport 全 nightly 格子输出正确 nightly_pending_count
 * [BEHAVIOR] B8 — buildCascadeReport report_text 含正确数字
 * [BEHAVIOR] B9 — buildCascadeReport 空格子列表输出零计数
 */

import { describe, it, expect } from 'vitest';
import { isRunnable, buildCascadeReport } from '../cascade-list.js';

describe('S3 cascade-list — isRunnable', () => {
  it('[B1] tests/ 路径 → true', () => {
    expect(isRunnable('tests/brain/anchor-check.test.js')).toBe(true);
  });

  it('[B2] manual: 前缀 → true', () => {
    expect(isRunnable('manual:curl localhost:5221/api/brain/ping')).toBe(true);
  });

  it('[B3] null → false', () => {
    expect(isRunnable(null)).toBe(false);
  });

  it('[B4] 其他路径前缀 → false', () => {
    expect(isRunnable('L3:real-machine-test')).toBe(false);
  });
});

describe('S3 cascade-list — buildCascadeReport', () => {
  it('[B5] 混合格子：分类计数正确', () => {
    const cells = [
      { assertion_ref: 'tests/brain/foo.test.js', na_reason: null },
      { assertion_ref: 'manual:curl localhost:5221/ping', na_reason: null },
      { assertion_ref: 'L3:real-device', na_reason: null },
      { assertion_ref: null, na_reason: null },
      { assertion_ref: null, na_reason: 'not-applicable' },
    ];
    const result = buildCascadeReport(cells);
    expect(result.total).toBe(5);
    expect(result.runnable_count).toBe(2);
    expect(result.nightly_pending_count).toBe(1);
    expect(result.unregistered_count).toBe(1);
    expect(result.runnable_cells).toHaveLength(2);
    expect(result.nightly_pending_cells).toHaveLength(1);
  });

  it('[B6] 全可跑格子 → runnable_count = total', () => {
    const cells = [
      { assertion_ref: 'tests/a.test.js', na_reason: null },
      { assertion_ref: 'tests/b.test.js', na_reason: null },
    ];
    const result = buildCascadeReport(cells);
    expect(result.runnable_count).toBe(2);
    expect(result.nightly_pending_count).toBe(0);
    expect(result.unregistered_count).toBe(0);
  });

  it('[B7] 全 nightly 格子 → nightly_pending_count = total', () => {
    const cells = [
      { assertion_ref: 'L3:real-machine-step-1', na_reason: null },
      { assertion_ref: 'L3:real-machine-step-2', na_reason: null },
    ];
    const result = buildCascadeReport(cells);
    expect(result.nightly_pending_count).toBe(2);
    expect(result.runnable_count).toBe(0);
  });

  it('[B8] report_text 含正确数字', () => {
    const cells = [
      { assertion_ref: 'tests/a.test.js', na_reason: null },
      { assertion_ref: 'L3:real-machine', na_reason: null },
    ];
    const result = buildCascadeReport(cells);
    expect(result.report_text).toContain('2');
    expect(result.report_text).toContain('1');
  });

  it('[B9] 空格子列表 → 全零', () => {
    const result = buildCascadeReport([]);
    expect(result.total).toBe(0);
    expect(result.runnable_count).toBe(0);
    expect(result.nightly_pending_count).toBe(0);
    expect(result.unregistered_count).toBe(0);
    expect(result.report_text).toContain('0');
  });
});
