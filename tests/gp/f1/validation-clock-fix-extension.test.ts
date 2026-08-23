import { describe, expect, it } from 'vitest';
import { resolveValidationClock } from '../../../packages/brain/src/orchestrator/validation-clock.js';

const row = (hop: number, action: string, created_at: string) => ({ hop, action, created_at, detail: {} });

describe('F1 validation clock fix 有界顺延 [BEHAVIOR]', () => {
  it('r50 场景在成功 generator-fix 后以 fix 行为新原点存活', () => {
    expect(resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog: [
        row(1, 'spawn:generator', '2026-08-23T00:00:00.000Z'),
        row(8, 'spawn:generator-fix', '2026-08-23T01:20:00.000Z'),
      ],
      intentAt: '2026-08-23T01:30:00.000Z',
      timeoutSeconds: 5_400,
    })).toEqual({
      pipeline_started_at: '2026-08-23T01:20:00.000Z',
      deadline_at: '2026-08-23T02:50:00.000Z',
    });
  });

  it('第 7 次 generator-fix 不再顺延且无 fix 语义不变', () => {
    const fixes = Array.from({ length: 7 }, (_, index) =>
      row(index + 2, 'spawn:generator-fix', `2026-08-23T0${index + 1}:00:00.000Z`));
    const capped = resolveValidationClock({
      action: 'spawn:judge',
      decisionLog: [row(1, 'spawn:generator', '2026-08-23T00:00:00.000Z'), ...fixes],
      intentAt: '2026-08-23T07:01:00.000Z',
      timeoutSeconds: 5_400,
    });
    expect(capped.pipeline_started_at).toBe('2026-08-23T06:00:00.000Z');
    expect(resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog: [row(1, 'spawn:generator', '2026-08-23T00:00:00.000Z')],
      intentAt: '2026-08-23T00:10:00.000Z',
      timeoutSeconds: 5_400,
    }).pipeline_started_at).toBe('2026-08-23T00:00:00.000Z');
  });
});
