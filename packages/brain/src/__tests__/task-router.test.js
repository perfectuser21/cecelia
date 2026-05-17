/**
 * task-router.test.js — exact-name pairing stub for lint-test-pairing
 *
 * 真实测试在 task-router-code-review.test.js 等 prefix 文件。此文件仅满足 lint 同名要求。
 * 顺手验证：harness_planner 已从 VALID_TASK_TYPES 移除（本 PR 范围）。
 */
import { describe, it, expect } from 'vitest';

describe('task-router module (pairing stub)', () => {
  it('VALID_TASK_TYPES 已移除 harness_planner（retire 验证）', async () => {
    const { isValidTaskType } = await import('../task-router.js');
    expect(isValidTaskType('harness_planner')).toBe(false);
    expect(isValidTaskType('harness_initiative')).toBe(true);
  });
});
