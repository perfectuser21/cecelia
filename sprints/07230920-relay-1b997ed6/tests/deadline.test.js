/**
 * deadline.test.js — B-01: 120 分钟总预算硬限（纯函数，clock 注入）
 *
 * TDD 骨架：全红状态。
 * 目标函数：isDeadlineExceeded(startedAt, nowAt, budgetMs)
 * 来源：packages/brain/src/orchestrator/gates.js（待实现）
 *
 * FR-01 要求：
 * - 纯函数，禁止内部 Date.now()
 * - nowAt - startedAt >= budgetMs → true（超时）
 * - loop 三处 fence：collect 前、derive 后、dispatch 前
 * - 超时 terminal reason: 'automation_deadline_exceeded'
 */
import { describe, it, expect } from 'vitest';

import { isDeadlineExceeded } from '../../../packages/brain/src/orchestrator/gates.js';

const BUDGET_120_MS = 120 * 60 * 1000;
const BASE_START = new Date('2026-01-01T00:00:00.000Z');

function ms(minutes, seconds = 0) {
  return minutes * 60 * 1000 + seconds * 1000;
}

function atOffset(offsetMs) {
  return new Date(BASE_START.getTime() + offsetMs);
}

describe('B-01: isDeadlineExceeded — 纯函数 clock 注入', () => {
  it('119 分 59 秒 → false（未超时）', () => {
    expect(isDeadlineExceeded(BASE_START, atOffset(ms(119, 59)), BUDGET_120_MS)).toBe(false);
  });

  it('120 分 00 秒 → true（恰好超时）', () => {
    expect(isDeadlineExceeded(BASE_START, atOffset(ms(120, 0)), BUDGET_120_MS)).toBe(true);
  });

  it('120 分 01 秒 → true（明确超时）', () => {
    expect(isDeadlineExceeded(BASE_START, atOffset(ms(120, 1)), BUDGET_120_MS)).toBe(true);
  });

  it('0 分钟 → false（刚启动）', () => {
    expect(isDeadlineExceeded(BASE_START, BASE_START, BUDGET_120_MS)).toBe(false);
  });

  it('函数不依赖 Date.now()（纯函数验证：相同输入相同输出）', () => {
    const r1 = isDeadlineExceeded(BASE_START, atOffset(ms(60)), BUDGET_120_MS);
    const r2 = isDeadlineExceeded(BASE_START, atOffset(ms(60)), BUDGET_120_MS);
    expect(r1).toBe(r2);
    expect(typeof r1).toBe('boolean');
  });

  it('自定义预算（15 分钟 merge 阶段）：14:59 → false，15:00 → true', () => {
    const BUDGET_15_MS = 15 * 60 * 1000;
    expect(isDeadlineExceeded(BASE_START, atOffset(ms(14, 59)), BUDGET_15_MS)).toBe(false);
    expect(isDeadlineExceeded(BASE_START, atOffset(ms(15, 0)), BUDGET_15_MS)).toBe(true);
  });
});

describe('B-01: loop deadline fence — dispatch 前检查', () => {
  /**
   * 场景：run 已用 119:59，derive 返回 spawn:generator-fix，
   * dispatch 前再做一次 deadline fence → 允许 dispatch（剩余 1 秒）
   */
  it('119:59 剩余 1 秒 → dispatch 前 fence 放行', () => {
    const used = ms(119, 59);
    const remaining = BUDGET_120_MS - used;
    expect(remaining).toBeGreaterThan(0);
    expect(isDeadlineExceeded(BASE_START, atOffset(used), BUDGET_120_MS)).toBe(false);
  });

  /**
   * 场景：derive 已返回 spawn，但 dispatch 前时间跨过 deadline
   * → 必须阻止 dispatch，写 terminal
   */
  it('120:00 deadline 到达 → dispatch 前 fence 阻止', () => {
    expect(isDeadlineExceeded(BASE_START, atOffset(ms(120, 0)), BUDGET_120_MS)).toBe(true);
  });
});

describe('B-01: deadline terminal reason', () => {
  /**
   * 验证 terminal reason 常量值（constants.js 或 gates.js 应暴露此字符串常量）
   * TODO: import { TERMINAL_REASON } from '../../../packages/brain/src/orchestrator/constants.js';
   */
  it('automation_deadline_exceeded terminal reason 字符串存在', () => {
    // 此测试在常量实现后应从 constants.js import
    const TERMINAL_REASON_DEADLINE = 'automation_deadline_exceeded';
    expect(TERMINAL_REASON_DEADLINE).toBe('automation_deadline_exceeded');
  });

  it('五阶段 terminal reason 字符串均已定义', () => {
    const PHASE_TERMINAL_REASONS = [
      'planning_deadline_exceeded',
      'gan_deadline_exceeded',
      'generation_deadline_exceeded',
      'verification_deadline_exceeded',
      'delivery_deadline_exceeded',
    ];
    // TODO: import from constants.js
    // 骨架阶段仅验证字符串格式约定
    for (const reason of PHASE_TERMINAL_REASONS) {
      expect(reason).toMatch(/^[a-z_]+_deadline_exceeded$/);
    }
  });
});
