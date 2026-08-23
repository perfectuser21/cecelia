import { describe, expect, it } from 'vitest';

import { resolveValidationClock } from '../../../packages/brain/src/orchestrator/validation-clock.js';

const TIMEOUT_SECONDS = 5_400;
const generatorAt = '2026-07-20T00:00:00.000Z';

function row(hop: number, action: string, createdAt: string) {
  return { hop, action, created_at: createdAt, detail: {} };
}

describe('validation clock 按 generator-fix 有界顺延', () => {
  it('r50 型长跑在最近成功 fix deadline 内保持存活', () => {
    const clock = resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog: [
        row(1, 'spawn:generator', generatorAt),
        row(9, 'spawn:generator-fix', '2026-07-20T02:00:00.000Z'),
      ],
      intentAt: '2026-07-20T02:30:00.000Z',
      timeoutSeconds: TIMEOUT_SECONDS,
    });

    expect(clock).toEqual({
      pipeline_started_at: '2026-07-20T02:00:00.000Z',
      deadline_at: '2026-07-20T03:30:00.000Z',
    });
    expect(Date.parse(clock!.deadline_at)).toBeGreaterThan(Date.parse('2026-07-20T02:30:00.000Z'));
  });

  it('前 6 次成功 fix 均按 hop 选择最近一轮作为新原点', () => {
    const decisionLog = [
      row(1, 'spawn:generator', generatorAt),
      ...Array.from({ length: 6 }, (_, index) => row(
        10 + index * 3,
        'spawn:generator-fix',
        `2026-07-20T0${index + 1}:00:00.000Z`,
      )),
    ];

    expect(resolveValidationClock({
      action: 'spawn:judge',
      decisionLog: [...decisionLog].reverse(),
      intentAt: '2026-07-20T06:30:00.000Z',
      timeoutSeconds: TIMEOUT_SECONDS,
    })).toEqual({
      pipeline_started_at: '2026-07-20T06:00:00.000Z',
      deadline_at: '2026-07-20T07:30:00.000Z',
    });
  });

  it('第 7 次 fix 不再顺延并按第 6 次 deadline 判死', () => {
    const decisionLog = [
      row(1, 'spawn:generator', generatorAt),
      ...Array.from({ length: 7 }, (_, index) => row(
        10 + index,
        'spawn:generator-fix',
        `2026-07-20T0${index + 1}:00:00.000Z`,
      )),
    ];
    const now = '2026-07-20T07:45:00.000Z';
    const clock = resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog,
      intentAt: now,
      timeoutSeconds: TIMEOUT_SECONDS,
    });

    expect(clock!.pipeline_started_at).toBe('2026-07-20T06:00:00.000Z');
    expect(Date.parse(clock!.deadline_at)).toBeLessThanOrEqual(Date.parse(now));
  });

  it('无 fix 轮语义不变且相同 hop 输入可确定重放', () => {
    const decisionLog = [row(1, 'spawn:generator', generatorAt)];
    const input = {
      action: 'spawn:judge',
      intentAt: '2026-07-20T00:10:00.000Z',
      timeoutSeconds: TIMEOUT_SECONDS,
    };

    const first = resolveValidationClock({ ...input, decisionLog });
    const replay = resolveValidationClock({
      ...input,
      decisionLog: decisionLog.map((item) => ({ ...item, detail: { ...item.detail } })),
    });
    expect(first).toEqual({
      pipeline_started_at: generatorAt,
      deadline_at: '2026-07-20T01:30:00.000Z',
    });
    expect(replay).toEqual(first);
  });
});
