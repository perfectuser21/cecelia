/**
 * Bug 3 Regression Test — final_e2e_verdict=FAIL 必须导致 ok=false（task=failed）
 *
 * 历史 bug：runHarnessInitiativeRouter 返回 `ok: !final?.error`，
 * 不看 final_e2e_verdict。当 final_evaluate 节点返 verdict=FAIL 但没设
 * error 字段时，ok=true → updateTaskStatus(completed)，导致用户/系统
 * 拿到 misleading 的"工厂开工证书"。
 *
 * W20 实证：task b56c4e82 final_evaluate verdict=FAIL，task.status=completed（错）
 *
 * 修复后：使用 computeHarnessInitiativeOk(final) 纯函数判定，
 * verdict=FAIL → ok=false → task=failed
 *
 * DoD 映射：
 * - SC-001: final_e2e_verdict='FAIL' → ok=false（不论 error 字段）
 * - SC-002: final_e2e_verdict='PASS_WITH_OVERRIDE' → ok=true（operator override）
 * - SC-003: final 为 falsy → ok=false（防御）
 * - SC-004: error 字段非空 → ok=false
 * - SC-005: computeHarnessInitiativeError 在 FAIL 时返 meaningful message（含 failed_scenarios names）
 */

import { describe, it, expect } from 'vitest';
import {
  computeHarnessInitiativeOk,
  computeHarnessInitiativeError,
} from '../executor.js';

describe('computeHarnessInitiativeOk', () => {
  it('final_e2e_verdict=PASS → ok=true', () => {
    expect(computeHarnessInitiativeOk({ final_e2e_verdict: 'PASS' })).toBe(true);
  });

  it('final_e2e_verdict=FAIL → ok=false (Bug 3 regression)', () => {
    expect(computeHarnessInitiativeOk({ final_e2e_verdict: 'FAIL' })).toBe(false);
  });

  it('final_e2e_verdict=FAIL + failed_scenarios → ok=false', () => {
    expect(
      computeHarnessInitiativeOk({
        final_e2e_verdict: 'FAIL',
        final_e2e_failed_scenarios: [{ name: 'multiply schema' }],
      })
    ).toBe(false);
  });

  it('final_e2e_verdict=PASS_WITH_OVERRIDE → ok=true (operator override)', () => {
    expect(computeHarnessInitiativeOk({ final_e2e_verdict: 'PASS_WITH_OVERRIDE' })).toBe(true);
  });

  it('error 字段非空 → ok=false', () => {
    expect(
      computeHarnessInitiativeOk({
        error: { node: 'final_evaluate', message: 'aborted' },
      })
    ).toBe(false);
  });

  it('error + FAIL 同时设置 → ok=false', () => {
    expect(
      computeHarnessInitiativeOk({
        error: { node: 'final_evaluate' },
        final_e2e_verdict: 'FAIL',
      })
    ).toBe(false);
  });

  it('final 为 null → ok=false (防御)', () => {
    expect(computeHarnessInitiativeOk(null)).toBe(false);
  });

  it('final 为 undefined → ok=false (防御)', () => {
    expect(computeHarnessInitiativeOk(undefined)).toBe(false);
  });

  it('final 为空对象（无 verdict 无 error）→ ok=true (向后兼容)', () => {
    // 这是历史行为：graph 跑完没设 error 也没设 verdict 时仍标 completed
    // 不在本 PR 范围内改这个语义（避免引入新 regression）
    expect(computeHarnessInitiativeOk({})).toBe(true);
  });
});

describe('computeHarnessInitiativeError', () => {
  it('FAIL verdict + failed_scenarios → 含 scenario names', () => {
    const err = computeHarnessInitiativeError({
      final_e2e_verdict: 'FAIL',
      final_e2e_failed_scenarios: [
        { name: 'multiply schema' },
        { name: 'sum regression' },
      ],
    });
    expect(err).toContain('FAIL');
    expect(err).toContain('multiply schema');
    expect(err).toContain('sum regression');
  });

  it('FAIL verdict 无 failed_scenarios → 仍含 FAIL 标记', () => {
    const err = computeHarnessInitiativeError({ final_e2e_verdict: 'FAIL' });
    expect(err).toContain('FAIL');
  });

  it('FAIL verdict 用 failed_step 作 fallback name', () => {
    const err = computeHarnessInitiativeError({
      final_e2e_verdict: 'FAIL',
      final_e2e_failed_scenarios: [{ failed_step: '阶段 A · multiply' }],
    });
    expect(err).toContain('阶段 A');
  });

  it('error 是 string → 直接返回', () => {
    expect(computeHarnessInitiativeError({ error: 'watchdog deadline' })).toBe('watchdog deadline');
  });

  it('error 是对象含 message → 返回 message', () => {
    expect(
      computeHarnessInitiativeError({ error: { node: 'planner', message: 'planner failed' } })
    ).toBe('planner failed');
  });

  it('PASS verdict → 返 null（无 error）', () => {
    expect(computeHarnessInitiativeError({ final_e2e_verdict: 'PASS' })).toBeNull();
  });

  it('PASS_WITH_OVERRIDE → 返 null', () => {
    expect(computeHarnessInitiativeError({ final_e2e_verdict: 'PASS_WITH_OVERRIDE' })).toBeNull();
  });

  it('final 为 null → 返默认信息', () => {
    expect(computeHarnessInitiativeError(null)).toMatch(/no state|null/i);
  });

  it('error_message ≤ 500 字符（截断保护）', () => {
    const longScenarios = Array.from({ length: 50 }, (_, i) => ({
      name: `scenario-${i}-${'x'.repeat(20)}`,
    }));
    const err = computeHarnessInitiativeError({
      final_e2e_verdict: 'FAIL',
      final_e2e_failed_scenarios: longScenarios,
    });
    expect(err.length).toBeLessThanOrEqual(500);
  });
});
