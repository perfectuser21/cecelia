import { describe, expect, it } from 'vitest';
import { resolveValidationClock } from '../../../packages/brain/src/orchestrator/validation-clock.js';

describe('validation clock 冻结合同', () => {
  it('r50 类场景由最新成功 fix 重置时钟', () => {
    const clock = resolveValidationClock({
      action: 'spawn:evaluator',
      timeoutSeconds: 5400,
      intentAt: '2026-08-23T20:00:00.000Z',
      decisionLog: [
        { hop: 10, action: 'spawn:generator', created_at: '2026-08-23T00:00:00.000Z' },
        { hop: 20, action: 'spawn:generator-fix', created_at: '2026-08-23T03:00:00.000Z' },
      ],
    });
    expect(clock.pipeline_started_at).toBe('2026-08-23T03:00:00.000Z');
    expect(clock.deadline_at).toBe('2026-08-23T04:30:00.000Z');
  });
});
