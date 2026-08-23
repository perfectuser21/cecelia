import { describe, expect, it } from 'vitest';

import { resolveValidationClock } from '../../../packages/brain/src/orchestrator/validation-clock.js';

const timeoutSeconds = 100;
const row = (hop: number, action: string, created_at: string) => ({
  hop,
  action,
  created_at,
  detail: {},
});

describe('validation clock bounded generator-fix extension [BEHAVIOR]', () => {
  it('r50 两轮 fix 后原窗口耗尽但最近 fix 窗口内仍存活', () => {
    const clock = resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog: [
        row(10, 'spawn:generator', '2026-08-23T00:00:00.000Z'),
        row(20, 'spawn:generator-fix', '2026-08-23T00:01:00.000Z'),
        row(30, 'spawn:generator-fix', '2026-08-23T00:02:00.000Z'),
      ],
      intentAt: '2026-08-23T00:02:30.000Z',
      timeoutSeconds,
    });

    expect(clock).toEqual({
      pipeline_started_at: '2026-08-23T00:02:00.000Z',
      deadline_at: '2026-08-23T00:03:40.000Z',
    });
    expect(Date.parse(clock.deadline_at)).toBeGreaterThan(Date.parse('2026-08-23T00:02:30.000Z'));
  });

  it('前六次 fix 各自按 hop 顺序成为新原点且输入可重放', () => {
    const decisionLog = [
      row(10, 'spawn:generator', '2026-08-23T00:00:00.000Z'),
      ...Array.from({ length: 6 }, (_, index) => row(
        20 + index,
        'spawn:generator-fix',
        `2026-08-23T00:0${index + 1}:00.000Z`,
      )),
    ].reverse();
    const input = {
      action: 'spawn:judge',
      decisionLog,
      intentAt: '2026-08-23T00:06:30.000Z',
      timeoutSeconds,
    };

    expect(resolveValidationClock(input)).toEqual(resolveValidationClock(input));
    expect(resolveValidationClock(input)).toEqual({
      pipeline_started_at: '2026-08-23T00:06:00.000Z',
      deadline_at: '2026-08-23T00:07:40.000Z',
    });
  });

  it('第七次 fix 不再顺延并保留第六次原点使超时照常判死', () => {
    const decisionLog = [
      row(10, 'spawn:generator', '2026-08-23T00:00:00.000Z'),
      ...Array.from({ length: 7 }, (_, index) => row(
        20 + index,
        'spawn:generator-fix',
        `2026-08-23T00:0${index + 1}:00.000Z`,
      )),
    ];
    const clock = resolveValidationClock({
      action: 'spawn:judge',
      decisionLog,
      intentAt: '2026-08-23T00:08:00.000Z',
      timeoutSeconds,
    });

    expect(clock).toEqual({
      pipeline_started_at: '2026-08-23T00:06:00.000Z',
      deadline_at: '2026-08-23T00:07:40.000Z',
    });
    expect(Date.parse(clock.deadline_at)).toBeLessThan(Date.parse('2026-08-23T00:08:00.000Z'));
  });

  it('无 fix 轮时继续以首次 generator 为原点', () => {
    expect(resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog: [row(10, 'spawn:generator', '2026-08-23T00:00:00.000Z')],
      intentAt: '2026-08-23T00:00:30.000Z',
      timeoutSeconds,
    })).toEqual({
      pipeline_started_at: '2026-08-23T00:00:00.000Z',
      deadline_at: '2026-08-23T00:01:40.000Z',
    });
  });
});
