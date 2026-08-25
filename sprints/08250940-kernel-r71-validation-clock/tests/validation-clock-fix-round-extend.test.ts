// 冻结合同测试（seal gate / runner finalizer 认这一份）—— kernel validation clock
// 按 fix 轮自动顺延（有界）[r71]。与 tests/gp/f1/step3-validation-clock-fix-round-extend.test.js
// 是同一改动的两个 CI 闸产物：本文件满足封印闸「sprints/<sprint_dir>/tests/ 至少一行冻结测试」+
// finalizer HEAD 树校验；gp/f1 那份满足 F1 gp-anchor 闸。两者都真 import 被改文件，禁 mock 被改的边。
import { describe, it, expect } from 'vitest';
import { resolveValidationClock } from '../../../packages/brain/src/orchestrator/validation-clock.js';

const TIMEOUT = 5400;
const GEN = '2026-08-25T00:00:00.000Z';
const GEN_DEADLINE = '2026-08-25T01:30:00.000Z';
const FIX3 = '2026-08-25T04:00:00.000Z';
const NEW_DEADLINE = '2026-08-25T05:30:00.000Z';

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

describe('resolveValidationClock fix 轮顺延冻结合同 [r71]', () => {
  it('复刻r50场景 多次fix后新原点顺延存活', () => {
    const clock = resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog: [
        genRow(),
        fixRow(20, '2026-08-25T01:20:00.000Z'),
        fixRow(30, '2026-08-25T02:40:00.000Z'),
        fixRow(40, FIX3),
      ],
      intentAt: '2026-08-25T04:05:00.000Z',
      timeoutSeconds: TIMEOUT,
    });
    expect(clock).toEqual({ pipeline_started_at: FIX3, deadline_at: NEW_DEADLINE });
  });

  it('顺延有界 满6次后第7次不再顺延照常判死', () => {
    const fixes = [
      fixRow(20, '2026-08-25T01:00:00.000Z'),
      fixRow(30, '2026-08-25T02:00:00.000Z'),
      fixRow(40, '2026-08-25T03:00:00.000Z'),
      fixRow(50, '2026-08-25T04:00:00.000Z'),
      fixRow(60, '2026-08-25T05:00:00.000Z'),
      fixRow(70, '2026-08-25T06:00:00.000Z'),
      fixRow(80, '2026-08-25T07:00:00.000Z'),
    ];
    const clock = resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog: [genRow(), ...fixes],
      intentAt: '2026-08-25T07:05:00.000Z',
      timeoutSeconds: TIMEOUT,
    });
    expect(clock).toEqual({
      pipeline_started_at: '2026-08-25T06:00:00.000Z',
      deadline_at: '2026-08-25T07:30:00.000Z',
    });
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
});
