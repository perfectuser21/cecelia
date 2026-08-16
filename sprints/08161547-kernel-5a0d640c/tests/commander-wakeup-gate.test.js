import { describe, it, expect } from 'vitest';

// classifyCommanderWakeup 已存在，但尚未消费 recentGateVerdicts（连续无进展）——本轮新增。
import { classifyCommanderWakeup } from '../../../packages/brain/src/orchestrator/commander-wakeup.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';

function evt(cursor, event_type, extra = {}) {
  return {
    run_id: RUN_ID,
    cursor,
    event_type,
    source_type: 'initiative_run',
    source_id: 'run',
    source_version: 0,
    payload: {},
    ...extra,
  };
}

describe('classifyCommanderWakeup [BEHAVIOR]', () => {
  it('wakes on run created material event (Run 启动 起手召唤)', () => {
    const out = classifyCommanderWakeup({
      runId: RUN_ID,
      stateCursor: 0,
      events: [evt(1, 'run.created')],
      defaultDecision: { action: 'derive' },
    });
    expect(out.wake).toBe(true);
    expect(out.reasons).toContain('run_created');
  });

  it('wakes when the same gate verdict repeats for 3 consecutive hops (连续无进展)', () => {
    const out = classifyCommanderWakeup({
      runId: RUN_ID,
      stateCursor: 5,
      events: [],
      defaultDecision: { action: 'wait:capacity' },
      recentGateVerdicts: [
        'deny:impact_unclaimed',
        'deny:impact_unclaimed',
        'deny:impact_unclaimed',
      ],
    });
    expect(out.wake).toBe(true);
    expect(out.reasons).toContain('kernel_no_progress');
  });

  it('does not wake on a single transient capacity_contended', () => {
    const out = classifyCommanderWakeup({
      runId: RUN_ID,
      stateCursor: 5,
      events: [],
      defaultDecision: { action: 'wait:capacity' },
      recentGateVerdicts: ['capacity_contended'],
    });
    expect(out.wake).toBe(false);
    expect(out.reasons).not.toContain('kernel_no_progress');
  });
});
