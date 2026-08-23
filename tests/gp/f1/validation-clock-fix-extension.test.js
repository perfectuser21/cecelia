// F1「工厂 · 开发闭环」：validation clock 只按 decision-log hop 中前 6 次 fix 有界顺延。
import { describe, expect, it } from 'vitest';
import { resolveValidationClock } from '../../../packages/brain/src/orchestrator/validation-clock.js';

const timeoutSeconds = 5400;
const at = (hour) => `2026-08-20T${String(hour).padStart(2, '0')}:00:00.000Z`;
const event = (hop, action, hour) => ({ hop, action, created_at: at(hour), detail: {} });

describe('F1 validation clock fix extension', () => {
  it('r50 long run extends from latest eligible generator-fix and remains alive', () => {
    const decisionLog = [event(1, 'spawn:generator', 0), ...Array.from(
      { length: 6 },
      (_, i) => event(i + 2, 'spawn:generator-fix', i + 1),
    )];
    expect(resolveValidationClock({ action: 'spawn:evaluator', decisionLog, intentAt: at(7), timeoutSeconds }))
      .toEqual({ pipeline_started_at: at(6), deadline_at: '2026-08-20T07:30:00.000Z' });
  });

  it('seventh generator-fix does not extend beyond the sixth fix', () => {
    const decisionLog = [event(1, 'spawn:generator', 0), ...Array.from(
      { length: 7 },
      (_, i) => event(i + 2, 'spawn:generator-fix', i + 1),
    )];
    expect(resolveValidationClock({ action: 'spawn:judge', decisionLog, intentAt: at(8), timeoutSeconds }))
      .toEqual({ pipeline_started_at: at(6), deadline_at: '2026-08-20T07:30:00.000Z' });
  });

  it('no fix preserves the initial generator clock', () => {
    expect(resolveValidationClock({
      action: 'spawn:evaluator', decisionLog: [event(1, 'spawn:generator', 0)], intentAt: at(1), timeoutSeconds,
    })).toEqual({ pipeline_started_at: at(0), deadline_at: '2026-08-20T01:30:00.000Z' });
  });

  it('same decision-log replay returns an identical clock', () => {
    const input = {
      action: 'spawn:evaluator',
      decisionLog: [event(1, 'spawn:generator', 0), event(4, 'spawn:generator-fix', 2)],
      intentAt: at(3),
      timeoutSeconds,
    };
    expect(resolveValidationClock(input)).toEqual(resolveValidationClock(input));
    expect(resolveValidationClock(input).pipeline_started_at).toBe(at(2));
  });
});
