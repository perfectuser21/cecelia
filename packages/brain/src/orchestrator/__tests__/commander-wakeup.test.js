import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  classifyCommanderWakeup,
  materialEventsAfter,
} from '../commander-wakeup.js';

const runA = randomUUID();
const runB = randomUUID();
const commanderAttemptId = randomUUID();

function event(cursor, eventType, overrides = {}) {
  return {
    run_id: runA,
    cursor,
    event_type: eventType,
    source_type: 'initiative_run',
    source_id: runA,
    source_version: cursor,
    payload: {},
    ...overrides,
  };
}

describe('Commander material wakeup classifier', () => {
  it.each([
    ['run.created', 'run_created'],
    ['attempt.completed', 'attempt_terminal'],
    ['attempt.failed', 'attempt_terminal'],
    ['run.phase_changed', 'phase_changed'],
    ['run.failed', 'run_terminal'],
    ['actor.message', 'actor_message'],
  ])('wakes on %s with bounded reason %s', (eventType, reason) => {
    const candidate = event(8, eventType, eventType.startsWith('attempt.')
      ? {
          source_type: 'harness_attempt',
          source_id: randomUUID(),
          payload: { role: 'planner' },
        }
      : {});
    const result = classifyCommanderWakeup({
      runId: runA,
      stateCursor: 7,
      events: [candidate],
      defaultDecision: { phase: 'planning', action: 'spawn:planner' },
    });

    expect(result).toEqual({
      wake: true,
      reasons: [reason],
      events: [candidate],
    });
  });

  it.each([
    ['merge_pr', 'kernel_pre_merge'],
    ['mark_failed', 'kernel_pre_terminal'],
    ['report', 'kernel_pre_terminal'],
    ['exit', 'kernel_pre_terminal'],
  ])('wakes before Kernel action %s', (action, reason) => {
    expect(classifyCommanderWakeup({
      runId: runA,
      stateCursor: 7,
      events: [],
      defaultDecision: { phase: 'merge', action },
    })).toEqual({ wake: true, reasons: [reason], events: [] });
  });

  it.each([
    event(8, 'attempt.heartbeat', {
      source_type: 'harness_attempt',
      source_id: commanderAttemptId,
      payload: { role: 'commander' },
    }),
    event(8, 'ci.poll', { payload: { status: 'pending' } }),
    event(8, 'commander.directive_accepted', {
      source_type: 'orchestrator_decision',
      source_id: '21',
    }),
    event(8, 'commander.directive_rejected', {
      source_type: 'orchestrator_decision',
      source_id: '22',
    }),
    event(8, 'attempt.completed', {
      source_type: 'harness_attempt',
      source_id: commanderAttemptId,
      payload: { role: 'commander' },
    }),
  ])('does not wake on control noise $event_type', (candidate) => {
    expect(classifyCommanderWakeup({
      runId: runA,
      stateCursor: 7,
      events: [candidate],
      defaultDecision: { phase: 'generate', action: 'wait:poll_ci' },
    })).toEqual({ wake: false, reasons: [], events: [] });
  });

  it('sorts exact evidence deterministically and never crosses Run boundaries', () => {
    const event8 = event(8, 'run.phase_changed');
    const event9 = event(9, 'attempt.failed', {
      source_type: 'harness_attempt',
      source_id: randomUUID(),
      payload: { role: 'reviewer', failure_class: 'unknown' },
    });
    const foreign = event(10, 'run.failed', { run_id: runB, source_id: runB });
    const result = classifyCommanderWakeup({
      runId: runA,
      stateCursor: 7,
      events: [foreign, event9, event8],
      defaultDecision: { phase: 'generate', action: 'wait:running' },
    });

    expect(result.events).toEqual([event8, event9]);
    expect(result.reasons).toEqual(['phase_changed', 'attempt_terminal']);
    expect(JSON.stringify(result)).not.toContain(runB);
  });
});

describe('Commander Directive staleness', () => {
  it('treats a later material event from another source as stale', () => {
    const concurrent = event(12, 'attempt.completed', {
      source_type: 'harness_attempt',
      source_id: randomUUID(),
      payload: { role: 'reviewer' },
    });
    expect(materialEventsAfter({
      runId: runA,
      bundleCursor: 10,
      events: [concurrent],
      commanderAttemptId,
    })).toEqual([concurrent]);
  });

  it('ignores only the current Commander Attempt lifecycle while preserving later evidence', () => {
    const ownLifecycle = [
      event(11, 'attempt.running', {
        source_type: 'harness_attempt',
        source_id: commanderAttemptId,
        payload: { role: 'commander' },
      }),
      event(12, 'attempt.completed', {
        source_type: 'harness_attempt',
        source_id: commanderAttemptId,
        payload: { role: 'commander' },
      }),
    ];
    const anotherCommander = event(13, 'attempt.failed', {
      source_type: 'harness_attempt',
      source_id: randomUUID(),
      payload: { role: 'commander', failure_class: 'provider' },
    });

    expect(materialEventsAfter({
      runId: runA,
      bundleCursor: 10,
      events: [...ownLifecycle, anotherCommander],
      commanderAttemptId,
    })).toEqual([anotherCommander]);
  });
});
