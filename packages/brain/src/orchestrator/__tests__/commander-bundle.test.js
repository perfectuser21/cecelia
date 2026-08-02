import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { buildCommanderBundle } from '../commander-bundle.js';

const runA = randomUUID();
const runB = randomUUID();
const commanderAttemptId = randomUUID();

const event = (cursor, runId = runA) => ({
  run_id: runId,
  cursor,
  event_type: 'attempt.running',
  source_type: 'harness_attempt',
  source_id: randomUUID(),
  source_version: cursor,
  payload: { status: 'running' },
});

const fixture = {
  runId: runA,
  commanderAttemptId,
  state: { run_id: runA, event_cursor: 7 },
  runProfile: { phase: 'planning' },
  objective: { summary: 'Finish the approved task.' },
  observed: { phase: 'planning' },
  historySummary: {},
  newEvents: [event(8), event(9)],
  actorMessages: [],
  activeRisks: [],
  budgets: { safety_max_hops: 4096 },
  allowedActions: ['continue_default', 'dispatch_role'],
};

describe('CommanderBundle builder', () => {
  it('builds only the requested Run and advances to the newest observed cursor', () => {
    const bundle = buildCommanderBundle(fixture);
    expect(bundle.run_id).toBe(runA);
    expect(bundle.event_cursor).toBe(9);
    expect(bundle.new_events.map(({ cursor }) => cursor)).toEqual([8, 9]);
    expect(JSON.stringify(bundle)).not.toContain(runB);
  });

  it('rejects cross-Run events and Actor messages rather than filtering them', () => {
    expect(() => buildCommanderBundle({
      ...fixture,
      newEvents: [{ ...fixture.newEvents[0], run_id: runB }],
    })).toThrow('commander_bundle_run_mismatch');
    expect(() => buildCommanderBundle({
      ...fixture,
      actorMessages: [{
        schema: 'harness-actor-message/v1',
        message_id: randomUUID(),
        run_id: runB,
        sender_role: 'planner',
        recipient_role: 'commander',
        thread_id: randomUUID(),
        correlation_id: randomUUID(),
        source_attempt_id: randomUUID(),
        event_cursor: 8,
        message_type: 'answer',
        payload: {},
        evidence_refs: ['event:8'],
        dedupe_key: 'planner:commander:1',
      }],
    })).toThrow('commander_bundle_run_mismatch');
  });

  it('rejects stale, non-monotonic, and secret-bearing inputs', () => {
    expect(() => buildCommanderBundle({
      ...fixture,
      newEvents: [event(7)],
    })).toThrow('commander_bundle_stale_event');
    expect(() => buildCommanderBundle({
      ...fixture,
      newEvents: [event(9), event(8)],
    })).toThrow('commander_bundle_non_monotonic_events');
    expect(() => buildCommanderBundle({
      ...fixture,
      objective: { access_token: 'secret' },
    })).toThrow('secret_material_forbidden');
  });

  it('accepts the non-secret auth_failed status while still rejecting auth material', () => {
    expect(() => buildCommanderBundle({
      ...fixture,
      observed: { lastAgentExit: { code: null, auth_failed: false } },
    })).not.toThrow();

    expect(() => buildCommanderBundle({
      ...fixture,
      observed: { authorization: 'Bearer must-not-enter-commander' },
    })).toThrow('secret_material_forbidden');
    expect(() => buildCommanderBundle({
      ...fixture,
      observed: { lastAgentExit: { auth_failed: 'not-a-status' } },
    })).toThrow('secret_material_forbidden');
  });

  it('projects an Inbox persistence row back to the strict ActorMessage contract', () => {
    const message = {
      schema: 'harness-actor-message/v1',
      message_cursor: 3,
      message_id: randomUUID(),
      run_id: runA,
      sender_role: 'planner',
      recipient_role: 'commander',
      thread_id: randomUUID(),
      correlation_id: randomUUID(),
      source_attempt_id: randomUUID(),
      event_cursor: 8,
      message_type: 'answer',
      payload: { answer: 'The contract is ready.' },
      evidence_refs: ['event:8'],
      dedupe_key: 'planner:commander:3',
      token_estimate: 8,
      delivery_status: 'delivered',
      delivered_at: new Date('2026-07-28T00:00:00.000Z'),
    };

    const bundle = buildCommanderBundle({ ...fixture, actorMessages: [message] });
    expect(bundle.actor_messages).toHaveLength(1);
    expect(bundle.actor_messages[0]).toMatchObject({
      message_id: message.message_id,
      payload: message.payload,
    });
    expect(bundle.actor_messages[0]).not.toHaveProperty('delivery_status');
    expect(bundle.actor_messages[0]).not.toHaveProperty('token_estimate');
  });
});
