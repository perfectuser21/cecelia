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
  classifyHarnessRelayAction,
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

  it('final 为空对象（无 verdict 无 error 无 report_path）→ ok=null (B48: graph interrupted/waiting)', () => {
    // B48 改变了语义：空 final 代表 graph 还在 interrupt 等待（planner callback 未回），
    // 不应标 completed，留 in_progress 等 reportNode 回写。
    expect(computeHarnessInitiativeOk({})).toBeNull();
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

  it('PASS verdict → 返 undefined（无 error，保持 r.error undefined 跟 integration 一致）', () => {
    expect(computeHarnessInitiativeError({ final_e2e_verdict: 'PASS' })).toBeUndefined();
  });

  it('PASS_WITH_OVERRIDE → 返 undefined', () => {
    expect(computeHarnessInitiativeError({ final_e2e_verdict: 'PASS_WITH_OVERRIDE' })).toBeUndefined();
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

describe('computeHarnessInitiativeOk — B48 interrupt detection', () => {
  it('B48: returns null when no report_path (graph interrupted/waiting for callback)', () => {
    // planner spawned detached, graph hit interrupt — final has prep state but no report_path
    const interrupted = { worktreePath: '/wt', githubToken: 'tok', initiativeId: 'init-1' };
    expect(computeHarnessInitiativeOk(interrupted)).toBeNull();
  });

  it('B48: returns true only when report_path is set (reportNode actually ran)', () => {
    const completed = { report_path: 'sprints/test/report.json', worktreePath: '/wt' };
    expect(computeHarnessInitiativeOk(completed)).toBe(true);
  });

  it('B48: returns false when error set (even with report_path)', () => {
    const errored = { report_path: 'sprints/test/report.json', error: { node: 'planner', message: 'fail' } };
    expect(computeHarnessInitiativeOk(errored)).toBe(false);
  });
});

describe('classifyHarnessRelayAction — P1 bug 39b97ade：deferred 结果之前落在最终 else 被误标 failed', () => {
  it('ok=null → waiting（graph interrupt，留 in_progress）', () => {
    expect(classifyHarnessRelayAction({ ok: null })).toBe('waiting');
  });

  it('ok=true + mode=skill-relay → relay_spawned（留 in_progress，等 harness-report 回写）', () => {
    expect(classifyHarnessRelayAction({ ok: true, mode: 'skill-relay', containerId: 'c1' })).toBe('relay_spawned');
  });

  it('P0: ok=true + mode=kernel-v1 → relay_spawned（kernel 刚启动，任务不得秒标 completed）', () => {
    expect(
      classifyHarnessRelayAction({
        ok: true,
        mode: 'kernel-v1',
        runId: '11111111-1111-4111-8111-111111111111',
      }),
    ).toBe('relay_spawned');
  });

  it('deferred=true（codex_concurrent_limit）→ deferred，不是 failed', () => {
    expect(classifyHarnessRelayAction({ ok: false, deferred: true, reason: 'codex_concurrent_limit' })).toBe('deferred');
  });

  it('deferred=true（live_container_guard，本次新增）→ deferred，不是 failed（回归修复核心）', () => {
    expect(classifyHarnessRelayAction({ ok: false, mode: 'skill-relay', deferred: true, reason: 'live_container_guard' })).toBe('deferred');
  });

  it('ok=true 非 skill-relay 模式 → completed', () => {
    expect(classifyHarnessRelayAction({ ok: true })).toBe('completed');
  });

  it('雷8（headed 变体·2856dada R4 实证）：ok=true + mode=skill-relay-codex-headed → relay_spawned，不是 completed', () => {
    expect(
      classifyHarnessRelayAction({ ok: true, mode: 'skill-relay-codex-headed', tmuxSession: 'codex-relay-abc' })
    ).toBe('relay_spawned');
  });

  it('ok=false 且非 deferred → failed', () => {
    expect(classifyHarnessRelayAction({ ok: false, error: 'boom' })).toBe('failed');
  });

  it('Kernel 已由 run authority 终态化 → terminalized，不允许 executor task-only 回写', () => {
    expect(classifyHarnessRelayAction({
      ok: false,
      mode: 'kernel-v1',
      terminalized: true,
      error: 'spawn EACCES',
    })).toBe('terminalized');
  });

  it('result 为 undefined → failed（防御，不抛异常）', () => {
    expect(classifyHarnessRelayAction(undefined)).toBe('failed');
  });
});
