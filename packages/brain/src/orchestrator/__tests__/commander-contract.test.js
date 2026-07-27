import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  ACTOR_KEYS,
  COMMANDER_ACTIONS,
  parseActorMessage,
  parseCommanderBundle,
  parseCommanderDirective,
  parseCommanderMode,
} from '../commander-contract.js';

const runId = randomUUID();
const attemptId = randomUUID();

const validDirective = {
  schema: 'commander-directive/v1',
  run_id: runId,
  event_cursor: 42,
  action: 'retry_attempt',
  target_role: 'reviewer',
  reason: 'The reviewer failed before producing a verdict.',
  guidance: 'Keep the approved contract unchanged.',
  route: {
    machine: 'us-mac-m4',
    provider: 'codex',
    account: 'team4',
    model: 'GPT-5.5',
  },
  evidence_refs: [`attempt:${attemptId}`, 'event:41'],
};

const validMessage = {
  schema: 'harness-actor-message/v1',
  message_id: randomUUID(),
  run_id: runId,
  sender_role: 'commander',
  recipient_role: 'planner',
  thread_id: randomUUID(),
  correlation_id: randomUUID(),
  source_attempt_id: null,
  event_cursor: 42,
  message_type: 'question',
  payload: { question: 'Which constraint blocks the proposal?' },
  evidence_refs: ['event:41'],
  dedupe_key: 'thread:commander:1',
};

describe('Commander Phase 1 contracts', () => {
  it('accepts only the explicit mode and action enums', () => {
    expect(parseCommanderMode('hybrid')).toBe('hybrid');
    expect(() => parseCommanderMode('auto')).toThrow();
    expect(COMMANDER_ACTIONS).toContain('continue_default');
    expect(COMMANDER_ACTIONS).not.toContain('merge_pr');
    expect(ACTOR_KEYS).toEqual([
      'commander',
      'planner',
      'proposer',
      'reviewer',
      'generator',
      'evaluator',
      'judge',
    ]);
  });

  it('parses a provider-neutral Directive and rejects side-effect actions and route escape hatches', () => {
    expect(parseCommanderDirective(validDirective)).toMatchObject({
      schema: 'commander-directive/v1',
      action: 'retry_attempt',
    });
    expect(() => parseCommanderDirective({
      ...validDirective,
      action: 'merge_pr',
    })).toThrow();
    expect(() => parseCommanderDirective({
      ...validDirective,
      route: { ...validDirective.route, cwd: '/tmp/repo' },
    })).toThrow();
  });

  it('recursively rejects secret material and unbounded free text', () => {
    expect(() => parseActorMessage({
      ...validMessage,
      payload: { nested: { access_token: 'secret' } },
    })).toThrow('secret_material_forbidden');
    expect(() => parseCommanderDirective({
      ...validDirective,
      guidance: 'x'.repeat(4001),
    })).toThrow();
  });

  it('keeps Actor messages informational and their envelope strict', () => {
    expect(parseActorMessage(validMessage)).toMatchObject({
      sender_role: 'commander',
      recipient_role: 'planner',
    });
    expect(() => parseActorMessage({
      ...validMessage,
      payload: { action: 'dispatch_role', target_role: 'generator' },
    })).toThrow('actor_side_effect_forbidden');
    expect(() => parseActorMessage({ ...validMessage, provider_session_id: 'session-1' })).toThrow();
  });

  it('accepts a strict CommanderBundle and rejects unknown top-level fields', () => {
    const bundle = {
      schema: 'commander-bundle/v1',
      run_id: runId,
      commander_attempt_id: attemptId,
      event_cursor: 42,
      run_profile: {},
      objective: {},
      observed: { phase: 'planning' },
      history_summary: {},
      new_events: [],
      actor_messages: [],
      active_risks: [],
      budgets: { safety_max_hops: 4096 },
      allowed_actions: ['continue_default'],
      output_schema: 'commander-directive/v1',
    };
    expect(parseCommanderBundle(bundle)).toEqual(bundle);
    expect(() => parseCommanderBundle({ ...bundle, prompt: 'hidden' })).toThrow();
  });
});
