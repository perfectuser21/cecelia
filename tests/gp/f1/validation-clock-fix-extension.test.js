import { describe, expect, it } from 'vitest';

import { resolveValidationClock } from '../../../packages/brain/src/orchestrator/validation-clock.js';
import '../../../sprints/08240010-kernel-r59-validation-clock/tests/validation-clock-fix-extension.test.js';

describe('F1 validation clock 失败 fix 派发回归', () => {
  it('非成功 fix 派发没有 launched effect 时不得顺延', () => {
    const clock = resolveValidationClock({
      action: 'spawn:evaluator',
      timeoutSeconds: 5400,
      intentAt: '2026-08-20T03:00:00.000Z',
      decisionLog: [
        {
          hop: 10,
          action: 'spawn:generator',
          created_at: '2026-08-20T00:00:00.000Z',
          detail: { reason: 'dispatched' },
        },
        {
          hop: 30,
          action: 'spawn:generator-fix',
          created_at: '2026-08-20T01:20:00.000Z',
          detail: { reason: 'dispatched' },
        },
        {
          hop: 31,
          action: 'result:dispatch',
          created_at: '2026-08-20T01:20:01.000Z',
          detail: {
            dispatch_hop: 30,
            dispatch_action: 'spawn:generator-fix',
            status: 'BLOCKED',
          },
        },
      ],
    });

    expect(clock).toEqual({
      pipeline_started_at: '2026-08-20T00:00:00.000Z',
      deadline_at: '2026-08-20T01:30:00.000Z',
    });
  });
});
