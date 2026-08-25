// F1 gp-anchor 闸产物 —— kernel validation clock 按 fix 轮自动顺延（有界）[r71]。
// 与 sprints/08250940-kernel-r71-validation-clock/tests/validation-clock-fix-round-extend.test.ts
// 是同一改动的两个 CI 闸产物：本文件满足 F1 gp-anchor 闸（跑 tests/gp/f1/**），
// 那份满足封印闸 + finalizer HEAD 树校验。两者都真 import 被改文件，禁 mock 被改的边。
import { describe, it, expect } from 'vitest';
import { resolveValidationClock } from '../../../packages/brain/src/orchestrator/validation-clock.js';

const TIMEOUT = 5400; // 1.5h
const GEN = '2026-08-25T00:00:00.000Z';
const GEN_DEADLINE = '2026-08-25T01:30:00.000Z';

const genRow = () => ({
  hop: 10,
  action: 'spawn:generator',
  created_at: GEN,
  detail: { pipeline_started_at: GEN, deadline_at: GEN_DEADLINE, reason: 'contract_approved' },
});
const fixRow = (hop, createdAt) => ({
  hop,
  action: 'spawn:generator-fix',
  created_at: createdAt,
  detail: { reason: 'red_fix' },
});

const threeFixes = () => [
  fixRow(20, '2026-08-25T01:20:00.000Z'),
  fixRow(30, '2026-08-25T02:40:00.000Z'),
  fixRow(40, '2026-08-25T04:00:00.000Z'),
];
const LAST3 = '2026-08-25T04:00:00.000Z';
const LAST3_DEADLINE = '2026-08-25T05:30:00.000Z';

const sevenFixes = () => [
  fixRow(20, '2026-08-25T01:00:00.000Z'),
  fixRow(30, '2026-08-25T02:00:00.000Z'),
  fixRow(40, '2026-08-25T03:00:00.000Z'),
  fixRow(50, '2026-08-25T04:00:00.000Z'),
  fixRow(60, '2026-08-25T05:00:00.000Z'),
  fixRow(70, '2026-08-25T06:00:00.000Z'), // 第 6 次 fix（有界原点）
  fixRow(80, '2026-08-25T07:00:00.000Z'), // 第 7 次 fix（越界，不成为原点）
];
const SIXTH = '2026-08-25T06:00:00.000Z';
const SIXTH_DEADLINE = '2026-08-25T07:30:00.000Z';

describe('resolveValidationClock fix 轮顺延 F1 gp-anchor [r71]', () => {
  it('复刻r50场景 多次fix后 spawn:evaluator 原点顺延到最后fix存活', () => {
    const clock = resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog: [genRow(), ...threeFixes()],
      intentAt: '2026-08-25T04:05:00.000Z',
      timeoutSeconds: TIMEOUT,
    });
    expect(clock).toEqual({ pipeline_started_at: LAST3, deadline_at: LAST3_DEADLINE });
  });

  it('下游 spawn:judge 复用顺延后的最后fix原点', () => {
    const clock = resolveValidationClock({
      action: 'spawn:judge',
      decisionLog: [genRow(), ...threeFixes()],
      intentAt: '2026-08-25T04:05:00.000Z',
      timeoutSeconds: TIMEOUT,
    });
    expect(clock).toEqual({ pipeline_started_at: LAST3, deadline_at: LAST3_DEADLINE });
  });

  it('新 fix 派发 spawn:generator-fix 也取最后fix原点', () => {
    const clock = resolveValidationClock({
      action: 'spawn:generator-fix',
      decisionLog: [genRow(), ...threeFixes()],
      intentAt: '2026-08-25T04:05:00.000Z',
      timeoutSeconds: TIMEOUT,
    });
    expect(clock).toEqual({ pipeline_started_at: LAST3, deadline_at: LAST3_DEADLINE });
  });

  it('有界 顺延满6次后照常判死 第7次不再顺延', () => {
    const clock = resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog: [genRow(), ...sevenFixes()],
      intentAt: '2026-08-25T07:05:00.000Z',
      timeoutSeconds: TIMEOUT,
    });
    expect(clock).toEqual({ pipeline_started_at: SIXTH, deadline_at: SIXTH_DEADLINE });
  });

  it('恰好6次fix仍顺延 原点为第6次fix', () => {
    const clock = resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog: [genRow(), ...sevenFixes().slice(0, 6)],
      intentAt: '2026-08-25T06:05:00.000Z',
      timeoutSeconds: TIMEOUT,
    });
    expect(clock).toEqual({ pipeline_started_at: SIXTH, deadline_at: SIXTH_DEADLINE });
  });

  it('纯函数可重放 fix行乱序数组同结果', () => {
    const shuffled = [
      fixRow(40, '2026-08-25T04:00:00.000Z'),
      genRow(),
      fixRow(20, '2026-08-25T01:20:00.000Z'),
      fixRow(30, '2026-08-25T02:40:00.000Z'),
    ];
    const clock = resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog: shuffled,
      intentAt: '2026-08-25T04:05:00.000Z',
      timeoutSeconds: TIMEOUT,
    });
    expect(clock).toEqual({ pipeline_started_at: LAST3, deadline_at: LAST3_DEADLINE });
  });

  it('回归 无fix轮语义不变 原点为首个generator', () => {
    const clock = resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog: [genRow()],
      intentAt: '2026-08-25T00:30:00.000Z',
      timeoutSeconds: TIMEOUT,
    });
    expect(clock).toEqual({ pipeline_started_at: GEN, deadline_at: GEN_DEADLINE });
  });

  it('回归 无fix轮下游无clock仍fail-closed', () => {
    expect(() => resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog: [],
      intentAt: GEN,
      timeoutSeconds: TIMEOUT,
    })).toThrow('validation_clock_required');
  });
});
