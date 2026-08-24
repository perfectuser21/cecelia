import { describe, expect, it } from 'vitest';
import { resolveValidationClock } from '../../../packages/brain/src/orchestrator/validation-clock.js';

describe('validation clock 冻结合同', () => {
  it('r50 类场景由最新成功派发的 fix 重置时钟', () => {
    const clock = resolveValidationClock({
      action: 'spawn:evaluator',
      timeoutSeconds: 5400,
      intentAt: '2026-08-23T20:00:00.000Z',
      decisionLog: [
        { hop: 10, action: 'spawn:generator', created_at: '2026-08-23T00:00:00.000Z' },
        { hop: 20, action: 'spawn:generator-fix', created_at: '2026-08-23T03:00:00.000Z' },
        {
          hop: 21,
          action: 'effect:attempt_launched',
          detail: { dispatch_hop: 20, dispatch_action: 'spawn:generator-fix', attempt_id: 'attempt-20' },
        },
      ],
    });
    expect(clock.pipeline_started_at).toBe('2026-08-23T03:00:00.000Z');
    expect(clock.deadline_at).toBe('2026-08-23T04:30:00.000Z');
  });

  it('同 hop 重复 fix 行只消耗一次顺延额度', () => {
    const rows: Array<Record<string, unknown>> = [
      { hop: 10, action: 'spawn:generator', created_at: '2026-08-23T00:00:00.000Z' },
    ];
    for (let index = 0; index < 6; index += 1) {
      const hop = 20 + index * 2;
      rows.push(
        { hop, action: 'spawn:generator-fix', created_at: `2026-08-23T0${index + 1}:00:00.000Z` },
        { hop: hop + 1, action: 'effect:attempt_launched', detail: { dispatch_hop: hop, dispatch_action: 'spawn:generator-fix' } },
      );
    }
    rows.splice(1, 0, { ...rows[1] });
    const clock = resolveValidationClock({
      action: 'spawn:evaluator', timeoutSeconds: 5400,
      intentAt: '2026-08-23T20:00:00.000Z', decisionLog: rows,
    });
    expect(clock.pipeline_started_at).toBe('2026-08-23T06:00:00.000Z');
  });
});
