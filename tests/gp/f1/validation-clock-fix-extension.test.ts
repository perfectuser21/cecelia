import { describe, expect, it } from 'vitest';

import { resolveValidationClock } from '../../../packages/brain/src/orchestrator/validation-clock.js';

describe('F1 validation clock fix extension regression', () => {
  it('成功派发的 generator-fix 最多六次重置 validation clock', () => {
    const origin = '2026-08-01T00:00:00.000Z';
    const decisionLog: Array<Record<string, unknown>> = [{
      hop: 1,
      action: 'spawn:generator',
      created_at: origin,
      detail: { pipeline_started_at: origin, deadline_at: '2026-08-01T00:01:40.000Z' },
    }];
    for (let index = 1; index <= 7; index += 1) {
      const dispatchHop = index * 2;
      decisionLog.push(
        { hop: dispatchHop, action: 'spawn:generator-fix', created_at: `2026-08-01T00:0${index}:00.000Z`, detail: {} },
        { hop: dispatchHop + 1, action: 'attempt:launched', detail: { dispatch_hop: dispatchHop, dispatch_action: 'spawn:generator-fix' } },
      );
    }
    expect(resolveValidationClock({
      action: 'spawn:judge', decisionLog, intentAt: origin, timeoutSeconds: 100,
    })).toEqual({
      pipeline_started_at: '2026-08-01T00:06:00.000Z',
      deadline_at: '2026-08-01T00:07:40.000Z',
    });
  });
});
