import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';

import { classifyCommanderWakeup } from '../../../packages/brain/src/orchestrator/commander-wakeup.js';

const runId = randomUUID();

function event(cursor, eventType, overrides = {}) {
  return {
    run_id: runId,
    cursor,
    event_type: eventType,
    source_type: 'initiative_run',
    source_id: runId,
    source_version: cursor,
    payload: {},
    ...overrides,
  };
}

describe('Commander 起手召唤 + FR-2 必唤醒节点', () => {
  // Guard (green): 首跳 run.created 是材料事件 → 唤醒（起手召唤先于 Planner 的前提）。
  it('first hop wakes commander on run.created (起手召唤)', () => {
    const out = classifyCommanderWakeup({
      runId,
      stateCursor: 0,
      events: [event(1, 'run.created')],
      defaultDecision: { phase: 'planning', action: 'spawn:planner', reason: 'no_prd' },
    });
    expect(out.wake).toBe(true);
  });

  // Guard (green): 单次瞬时 capacity_contended（非材料事件）不唤醒。
  it('single capacity_contended does not wake', () => {
    const out = classifyCommanderWakeup({
      runId,
      stateCursor: 0,
      events: [event(1, 'gate.capacity_contended')],
      defaultDecision: { phase: 'gan', action: 'wait:capacity', reason: 'capacity_contended' },
      recentGateVerdicts: ['contend:capacity'],
    });
    expect(out.wake).toBe(false);
  });

  // RED: 同一 gate_verdict 连续 ≥3 跳（无材料进展）→ 连续无进展唤醒。
  it('same gate_verdict for three consecutive hops wakes (连续无进展)', () => {
    const out = classifyCommanderWakeup({
      runId,
      stateCursor: 5,
      events: [],
      defaultDecision: { phase: 'gan', action: 'wait:impact_gate', reason: 'unclaimed_files' },
      recentGateVerdicts: [
        'deny:impact_unclaimed_files',
        'deny:impact_unclaimed_files',
        'deny:impact_unclaimed_files',
      ],
    });
    expect(out.wake).toBe(true);
    expect(out.reasons).toContain('no_progress_stall');
  });

  // Guard: gate_verdict 抖动（非连续 3 同）不唤醒。
  it('non-consecutive gate_verdicts do not wake', () => {
    const out = classifyCommanderWakeup({
      runId,
      stateCursor: 5,
      events: [],
      defaultDecision: { phase: 'gan', action: 'wait:impact_gate', reason: 'x' },
      recentGateVerdicts: ['deny:a', 'allow', 'deny:a'],
    });
    expect(out.wake).toBe(false);
  });
});
