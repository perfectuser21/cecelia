import { describe, expect, it } from 'vitest';
import { resolveValidationClock } from '../../../packages/brain/src/orchestrator/validation-clock.js';

const TIMEOUT_SECONDS = 5400;
const isoAtHour = (hour) => `2026-08-20T${String(hour).padStart(2, '0')}:00:00.000Z`;
const row = (hop, action, hour) => ({ hop, action, created_at: isoAtHour(hour), detail: {} });

describe('validation clock 按 generator-fix 轮有界顺延', () => {
  it('r50 长跑在第 6 次 fix 后 extends from latest eligible generator-fix and remains alive', () => {
    const decisionLog = [
      row(1, 'spawn:generator', 0),
      ...Array.from({ length: 6 }, (_, index) => row(index + 2, 'spawn:generator-fix', index + 1)),
    ];
    expect(resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog,
      intentAt: isoAtHour(7),
      timeoutSeconds: TIMEOUT_SECONDS,
    })).toEqual({
      pipeline_started_at: isoAtHour(6),
      deadline_at: '2026-08-20T07:30:00.000Z',
    });
  });

  it('第 7 次 fix does not extend beyond the sixth fix', () => {
    const decisionLog = [
      row(1, 'spawn:generator', 0),
      ...Array.from({ length: 7 }, (_, index) => row(index + 2, 'spawn:generator-fix', index + 1)),
    ];
    expect(resolveValidationClock({
      action: 'spawn:judge',
      decisionLog,
      intentAt: isoAtHour(8),
      timeoutSeconds: TIMEOUT_SECONDS,
    })).toEqual({
      pipeline_started_at: isoAtHour(6),
      deadline_at: '2026-08-20T07:30:00.000Z',
    });
  });

  it('无 fix 轮 preserves the initial generator clock', () => {
    expect(resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog: [row(1, 'spawn:generator', 0)],
      intentAt: isoAtHour(1),
      timeoutSeconds: TIMEOUT_SECONDS,
    })).toEqual({
      pipeline_started_at: isoAtHour(0),
      deadline_at: '2026-08-20T01:30:00.000Z',
    });
  });

  it('相同 hop 日志 replay returns an identical clock', () => {
    const input = {
      action: 'spawn:evaluator',
      decisionLog: [row(1, 'spawn:generator', 0), row(4, 'spawn:generator-fix', 2)],
      intentAt: isoAtHour(3),
      timeoutSeconds: TIMEOUT_SECONDS,
    };
    expect(resolveValidationClock(input)).toEqual(resolveValidationClock(input));
    expect(resolveValidationClock(input).pipeline_started_at).toBe(isoAtHour(2));
  });
});
