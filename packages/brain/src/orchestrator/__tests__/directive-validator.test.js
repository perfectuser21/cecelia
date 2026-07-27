import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { validateCommanderDirective } from '../directive-validator.js';

const runId = randomUUID();
const baseDirective = {
  schema: 'commander-directive/v1',
  run_id: runId,
  event_cursor: 9,
  action: 'continue_default',
  reason: 'Continue with the deterministic Kernel transition.',
  evidence_refs: ['event:9'],
};

const baseContext = {
  runId,
  eventCursor: 9,
  phase: 'planning',
  allowedActions: ['continue_default', 'dispatch_role'],
  nextHop: 2,
  maxHops: 100,
  duplicateHop: false,
  spentUsd: 1,
  maxUsd: 10,
  deadlineAt: '2026-07-28T01:00:00.000Z',
  now: '2026-07-28T00:00:00.000Z',
  strictMachine: null,
  capabilityAllowed: true,
  evidenceOwned: true,
};

function reason(directivePatch = {}, contextPatch = {}) {
  return validateCommanderDirective(
    { ...baseDirective, ...directivePatch },
    { ...baseContext, ...contextPatch },
  ).reason_code;
}

describe('deterministic CommanderDirective validator', () => {
  it('returns bounded rejection codes in the specified validation order', () => {
    expect(reason({ run_id: randomUUID() })).toBe('run_id_mismatch');
    expect(reason({ event_cursor: 8 })).toBe('stale_event_cursor');
    expect(reason({}, { allowedActions: ['dispatch_role'] })).toBe('action_not_allowed');
    expect(reason({}, { phase: 'done' })).toBe('invalid_phase');
    expect(reason({}, { duplicateHop: true })).toBe('duplicate_hop');
    expect(reason({}, { nextHop: 101 })).toBe('hop_budget_exceeded');
    expect(reason({}, { spentUsd: 10 })).toBe('cost_budget_exceeded');
    expect(reason({}, { now: '2026-07-28T02:00:00.000Z' })).toBe('deadline_exceeded');
    expect(reason({
      action: 'dispatch_role',
      target_role: 'planner',
      route: { machine: 'us-mac-m4' },
    }, {
      strictMachine: 'xian-mac-m4',
    })).toBe('strict_affinity_violation');
    expect(reason({}, { capabilityAllowed: false })).toBe('capability_not_allowed');
    expect(reason({}, { evidenceOwned: false })).toBe('evidence_not_owned');
  });

  it('accepts valid default and strict-affinity dispatch Directives', () => {
    expect(validateCommanderDirective(baseDirective, baseContext)).toEqual({
      accepted: true,
      reason_code: null,
      directive: baseDirective,
    });
    const dispatch = {
      ...baseDirective,
      action: 'dispatch_role',
      target_role: 'planner',
      route: { machine: 'xian-mac-m4', provider: 'codex' },
    };
    expect(validateCommanderDirective(dispatch, {
      ...baseContext,
      strictMachine: 'xian-mac-m4',
    })).toEqual({
      accepted: true,
      reason_code: null,
      directive: dispatch,
    });
  });

  it('does not mutate the Directive or execute contextual callbacks', () => {
    const directive = structuredClone(baseDirective);
    const capabilityAllowed = () => {
      throw new Error('must_not_execute');
    };
    const result = validateCommanderDirective(directive, {
      ...baseContext,
      capabilityAllowed,
    });
    expect(result).toMatchObject({ accepted: false, reason_code: 'capability_not_allowed' });
    expect(directive).toEqual(baseDirective);
  });
});
