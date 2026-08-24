import { describe, expect, it } from 'vitest';

// 冻结合同 CI 常驻回归副本（RED 先行）——真 import 被改文件，禁 mock 被改的边。
// 与 sprints/08241515-kernel-r68-validation-clock/tests/validation-clock-fix-extension.test.ts 同契约。
import { resolveValidationClock } from '../../../packages/brain/src/orchestrator/validation-clock.js';

// 默认 timeout（PRD 硬约束：不改 5400s 默认值）。90 分钟窗口。
const TIMEOUT = 5400;

// 初始 generator origin 时间（t0）与旧逻辑 deadline（t0 + 90min）。
const T0 = '2026-08-24T00:00:00.000Z';
const OLD_DEADLINE = '2026-08-24T01:30:00.000Z';

// 构造 decision_log 行的小工具（只写纯函数需要的 hop/action/created_at/detail）。
function row(hop, action, createdAt, detail = undefined) {
  return { hop, action, created_at: createdAt, ...(detail !== undefined ? { detail } : {}) };
}

// r50 场景常见的“旧 buggy 持久化 detail”：每个 fix 行的 detail 都指向 t0（初始 origin），
// 用来证明新逻辑按 created_at 时序顺延、忽略被污染的 detail（纯可重放）。
const BUGGY_T0_DETAIL = { pipeline_started_at: T0, deadline_at: OLD_DEADLINE };

describe('resolveValidationClock — fix 轮自动顺延（有界）[BEHAVIOR]', () => {
  it('B-01 顺延：downstream 角色采纳最近一次 generator-fix 原点（复刻 r50 存活）', () => {
    // G0 @ t0，随后两轮健康 fix：F1 @ 00:40、F2 @ 01:20（均 ≤ 6 轮）。
    const decisionLog = [
      row(10, 'spawn:generator', T0, BUGGY_T0_DETAIL),
      row(20, 'spawn:generator-fix', '2026-08-24T00:40:00.000Z', BUGGY_T0_DETAIL),
      row(30, 'spawn:generator-fix', '2026-08-24T01:20:00.000Z', BUGGY_T0_DETAIL),
    ];
    // evaluator 复核 deadline 时，原点应顺延到最近的 F2（01:20），deadline = 01:20 + 90min。
    expect(resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog,
      intentAt: '2026-08-24T01:25:00.000Z',
      timeoutSeconds: TIMEOUT,
    })).toEqual({
      pipeline_started_at: '2026-08-24T01:20:00.000Z',
      deadline_at: '2026-08-24T02:50:00.000Z',
    });
  });

  it('B-02 有界：fix 轮 > 6 时原点冻结在第 6 次 fix，deadline 不再增长（超限照常判死）', () => {
    // G0 + 8 轮 fix（00:10 … 01:20）。第 6 次 fix 在 01:00。
    const fixes = [
      '2026-08-24T00:10:00.000Z', '2026-08-24T00:20:00.000Z', '2026-08-24T00:30:00.000Z',
      '2026-08-24T00:40:00.000Z', '2026-08-24T00:50:00.000Z', '2026-08-24T01:00:00.000Z',
      '2026-08-24T01:10:00.000Z', '2026-08-24T01:20:00.000Z',
    ];
    const decisionLog = [
      row(10, 'spawn:generator', T0, BUGGY_T0_DETAIL),
      ...fixes.map((t, i) => row(20 + i * 10, 'spawn:generator-fix', t, BUGGY_T0_DETAIL)),
    ];
    const clock = resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog,
      intentAt: '2026-08-24T01:25:00.000Z',
      timeoutSeconds: TIMEOUT,
    });
    // 原点冻结在第 6 次 fix（01:00），deadline = 01:00 + 90min = 02:30，而非最近的 F8（01:20 → 02:50）。
    expect(clock).toEqual({
      pipeline_started_at: '2026-08-24T01:00:00.000Z',
      deadline_at: '2026-08-24T02:30:00.000Z',
    });
    expect(clock.deadline_at).not.toBe('2026-08-24T02:50:00.000Z');
  });

  it('B-03 语义不变：无 fix 轮时 deadline 与旧逻辑逐字节一致', () => {
    // 只有初始 generator origin（0 次 fix）→ 顺延次数为 0 → 结果 = 旧逻辑。
    const decisionLog = [row(10, 'spawn:generator', T0, BUGGY_T0_DETAIL)];
    expect(resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog,
      intentAt: '2026-08-24T00:30:00.000Z',
      timeoutSeconds: TIMEOUT,
    })).toEqual({
      pipeline_started_at: T0,
      deadline_at: OLD_DEADLINE,
    });
  });

  it('B-04 Invariant：existing-PR evaluator origin 复用路径不受 fix 顺延影响', () => {
    // verified_existing_pr 的 evaluator 原点（最低 hop）胜出；即便日志里混入 generator-fix 行，
    // 也必须复用 evaluator 持久化时钟、不顺延（existing-PR-clock 铁律）。
    const decisionLog = [
      row(10, 'spawn:evaluator', T0, {
        validation_origin: 'verified_existing_pr',
        pipeline_started_at: T0,
        deadline_at: OLD_DEADLINE,
      }),
      row(20, 'spawn:generator-fix', '2026-08-24T01:20:00.000Z', BUGGY_T0_DETAIL),
    ];
    expect(resolveValidationClock({
      action: 'spawn:judge',
      decisionLog,
      intentAt: '2026-08-24T01:25:00.000Z',
      timeoutSeconds: TIMEOUT,
    })).toEqual({
      pipeline_started_at: T0,
      deadline_at: OLD_DEADLINE,
    });
  });

  it('B-05 恰好 6 轮 fix：原点采纳第 6 次 fix（边界，未超限）', () => {
    const fixes = [
      '2026-08-24T00:10:00.000Z', '2026-08-24T00:20:00.000Z', '2026-08-24T00:30:00.000Z',
      '2026-08-24T00:40:00.000Z', '2026-08-24T00:50:00.000Z', '2026-08-24T01:00:00.000Z',
    ];
    const decisionLog = [
      row(10, 'spawn:generator', T0, BUGGY_T0_DETAIL),
      ...fixes.map((t, i) => row(20 + i * 10, 'spawn:generator-fix', t, BUGGY_T0_DETAIL)),
    ];
    expect(resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog,
      intentAt: '2026-08-24T01:05:00.000Z',
      timeoutSeconds: TIMEOUT,
    })).toEqual({
      pipeline_started_at: '2026-08-24T01:00:00.000Z',
      deadline_at: '2026-08-24T02:30:00.000Z',
    });
  });
});
