import { describe, expect, it } from 'vitest';
import { resolveValidationClock } from '../../../packages/brain/src/orchestrator/validation-clock.js';

const timeoutSeconds = 5_400;
const row = (hop: number, action: string, created_at: string, detail: Record<string, unknown> = {}) =>
  ({ hop, action, created_at, detail });
const successfulFix = (intentHop: number, launchedHop: number, createdAt: string) => [
  row(intentHop, 'spawn:generator-fix', createdAt),
  row(launchedHop, 'effect:attempt_launched', createdAt, {
    dispatch_hop: intentHop,
    dispatch_action: 'spawn:generator-fix',
    attempt_id: `attempt-${intentHop}`,
  }),
];

describe('validation clock fix 有界顺延 [BEHAVIOR]', () => {
  it('r50 场景在成功 generator-fix 后以 fix 行为新原点存活', () => {
    const clock = resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog: [
        row(1, 'spawn:generator', '2026-08-23T00:00:00.000Z'),
        ...successfulFix(8, 9, '2026-08-23T01:20:00.000Z'),
      ],
      intentAt: '2026-08-23T01:30:00.000Z',
      timeoutSeconds,
    });
    expect(clock).toEqual({
      pipeline_started_at: '2026-08-23T01:20:00.000Z',
      deadline_at: '2026-08-23T02:50:00.000Z',
    });
    expect(Date.parse(clock.deadline_at)).toBeGreaterThan(Date.parse('2026-08-23T01:30:00.000Z'));
  });

  it('generator-fix 只有 intent 而派发失败或被阻断时不顺延', () => {
    const original = row(1, 'spawn:generator', '2026-08-23T00:00:00.000Z');
    const failedIntent = row(8, 'spawn:generator-fix', '2026-08-23T01:20:00.000Z');
    const blockedResult = row(9, 'effect:dispatch_result', '2026-08-23T01:20:01.000Z', {
      dispatch_hop: 8,
      dispatch_action: 'spawn:generator-fix',
      status: 'BLOCKED',
    });
    expect(resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog: [original, failedIntent, blockedResult],
      intentAt: '2026-08-23T01:30:00.000Z',
      timeoutSeconds,
    })).toEqual({
      pipeline_started_at: '2026-08-23T00:00:00.000Z',
      deadline_at: '2026-08-23T01:30:00.000Z',
    });
  });

  it('第 7 次 generator-fix 不再顺延且仍以第 6 次 fix 为原点', () => {
    const fixes = Array.from({ length: 7 }, (_, index) =>
      successfulFix(index * 2 + 2, index * 2 + 3, `2026-08-23T0${index + 1}:00:00.000Z`)).flat();
    expect(resolveValidationClock({
      action: 'spawn:judge',
      decisionLog: [row(1, 'spawn:generator', '2026-08-23T00:00:00.000Z'), ...fixes],
      intentAt: '2026-08-23T07:01:00.000Z',
      timeoutSeconds,
    })).toEqual({
      pipeline_started_at: '2026-08-23T06:00:00.000Z',
      deadline_at: '2026-08-23T07:30:00.000Z',
    });
  });

  it('无 generator-fix 时保持首个 generator 原点语义', () => {
    expect(resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog: [row(1, 'spawn:generator', '2026-08-23T00:00:00.000Z')],
      intentAt: '2026-08-23T00:10:00.000Z',
      timeoutSeconds,
    })).toEqual({
      pipeline_started_at: '2026-08-23T00:00:00.000Z',
      deadline_at: '2026-08-23T01:30:00.000Z',
    });
  });

  it('相同乱序日志按 hop 重放得到相同 clock', () => {
    const rows = [
      row(9, 'spawn:evaluator', '2026-08-23T01:21:00.000Z'),
      ...successfulFix(7, 8, '2026-08-23T01:20:00.000Z'),
      row(1, 'spawn:generator', '2026-08-23T00:00:00.000Z'),
    ];
    const args = { action: 'spawn:judge', intentAt: '2026-08-23T01:30:00.000Z', timeoutSeconds };
    expect(resolveValidationClock({ ...args, decisionLog: rows }))
      .toEqual(resolveValidationClock({ ...args, decisionLog: [...rows].reverse() }));
  });
});
