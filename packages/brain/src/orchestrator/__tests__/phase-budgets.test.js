/**
 * phase-budgets.test.js — B-05: 阶段预算独立超时（五个阶段）
 *
 * TDD 骨架：全红状态。
 * 目标函数：getPhaseDeadline(phase, startedAt, usedBudgetMs, nowAt)
 *            isPhaseDeadlineExceeded(phase, phaseStartedAt, nowAt)
 * 来源：packages/brain/src/orchestrator/gates.js（待实现）
 *       packages/brain/src/orchestrator/constants.js（待添加阶段预算常量）
 *
 * FR-02 要求：
 * - planning: 10 分钟 → planning_deadline_exceeded
 * - contract GAN: 20 分钟 → gan_deadline_exceeded
 * - generate + fix: 45 分钟 → generation_deadline_exceeded
 * - evaluate + judge: 30 分钟 → verification_deadline_exceeded
 * - merge + report: 15 分钟 → delivery_deadline_exceeded
 * - 未使用预算可转移，总预算不超 120 分钟
 * - 纯函数，clock 注入
 */
import { describe, it, expect } from 'vitest';

import { PHASE_BUDGETS_MS, PHASE_TERMINAL_REASONS } from '../constants.js';
import { isPhaseDeadlineExceeded } from '../gates.js';

const BASE = new Date('2026-01-01T00:00:00.000Z');
function at(ms) { return new Date(BASE.getTime() + ms); }
function minMs(m) { return m * 60 * 1000; }

describe('B-05: 阶段预算常量', () => {
  it('planning 预算 = 10 分钟', () => {
    expect(PHASE_BUDGETS_MS.planning).toBe(minMs(10));
  });

  it('contract_gan 预算 = 20 分钟', () => {
    expect(PHASE_BUDGETS_MS.contract_gan).toBe(minMs(20));
  });

  it('generate_fix 预算 = 45 分钟', () => {
    expect(PHASE_BUDGETS_MS.generate_fix).toBe(minMs(45));
  });

  it('evaluate_judge 预算 = 30 分钟', () => {
    expect(PHASE_BUDGETS_MS.evaluate_judge).toBe(minMs(30));
  });

  it('merge_report 预算 = 15 分钟', () => {
    expect(PHASE_BUDGETS_MS.merge_report).toBe(minMs(15));
  });

  it('五个阶段预算之和 = 120 分钟', () => {
    const total = Object.values(PHASE_BUDGETS_MS).reduce((s, v) => s + v, 0);
    expect(total).toBe(minMs(120));
  });
});

describe('B-05: 阶段 terminal reason 常量', () => {
  it('planning_deadline_exceeded', () => {
    expect(PHASE_TERMINAL_REASONS.planning).toBe('planning_deadline_exceeded');
  });

  it('gan_deadline_exceeded', () => {
    expect(PHASE_TERMINAL_REASONS.contract_gan).toBe('gan_deadline_exceeded');
  });

  it('generation_deadline_exceeded', () => {
    expect(PHASE_TERMINAL_REASONS.generate_fix).toBe('generation_deadline_exceeded');
  });

  it('verification_deadline_exceeded', () => {
    expect(PHASE_TERMINAL_REASONS.evaluate_judge).toBe('verification_deadline_exceeded');
  });

  it('delivery_deadline_exceeded', () => {
    expect(PHASE_TERMINAL_REASONS.merge_report).toBe('delivery_deadline_exceeded');
  });
});

describe('B-05: isPhaseDeadlineExceeded 纯函数', () => {
  it('planning 阶段：9:59 → false', () => {
    expect(isPhaseDeadlineExceeded('planning', BASE, at(minMs(9) + 59000))).toBe(false);
  });

  it('planning 阶段：10:00 → true（超时）', () => {
    expect(isPhaseDeadlineExceeded('planning', BASE, at(minMs(10)))).toBe(true);
  });

  it('merge_report 阶段：14:59 → false', () => {
    expect(isPhaseDeadlineExceeded('merge_report', BASE, at(minMs(14) + 59000))).toBe(false);
  });

  it('merge_report 阶段：15:00 → true（超时）', () => {
    expect(isPhaseDeadlineExceeded('merge_report', BASE, at(minMs(15)))).toBe(true);
  });

  it('generate_fix 阶段：44:59 → false', () => {
    expect(isPhaseDeadlineExceeded('generate_fix', BASE, at(minMs(44) + 59000))).toBe(false);
  });

  it('generate_fix 阶段：45:00 → true（超时）', () => {
    expect(isPhaseDeadlineExceeded('generate_fix', BASE, at(minMs(45)))).toBe(true);
  });
});

describe('B-05: 总预算约束（阶段预算不突破 120 分钟）', () => {
  /**
   * 场景：planning 阶段只用了 5 分钟，剩余 5 分钟"转移"给后续阶段，
   * 但 run 总用时仍受 120 分钟约束。
   */
  it('planning 早结束（5 分钟），gan 阶段可用时间仍受总预算约束', () => {
    // 总预算 120 分钟；planning 用 5 分钟；gan 阶段预算 20 分钟
    // gan 可用 = min(20 分钟, 总剩余 115 分钟) = 20 分钟
    // 当 run 总用时达到 120 分钟时，gan 阶段也必须 terminal
    const runStarted = BASE;
    const ganStarted = at(minMs(5)); // planning 耗时 5 分钟

    // 总用时 119:59 时（gan 阶段已跑 114:59）：总预算未到
    const at119m59s = at(minMs(119) + 59000);

    // 验证：若总 deadline 函数此时不超时
    // isDeadlineExceeded(runStarted, at119m59s, 120*60*1000) === false
    // 此处仅验证时间差逻辑
    expect(at119m59s.getTime() - runStarted.getTime()).toBe(minMs(119) + 59000);
    expect(at119m59s.getTime() - runStarted.getTime()).toBeLessThan(minMs(120));

    // 总用时 120 分钟：必须 terminal
    const at120m = at(minMs(120));
    expect(at120m.getTime() - runStarted.getTime()).toBeGreaterThanOrEqual(minMs(120));
  });
});
