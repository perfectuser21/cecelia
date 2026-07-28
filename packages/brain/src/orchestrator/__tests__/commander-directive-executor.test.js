import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { createCommanderDirectiveExecutor } from '../commander-directive-executor.js';

const runId = randomUUID();
const attemptId = randomUUID();

const defaultDecision = Object.freeze({
  phase: 'planning',
  action: 'spawn:planner',
  reason: 'no_prd',
});

function directive(overrides = {}) {
  return {
    schema: 'commander-directive/v1',
    run_id: runId,
    event_cursor: 9,
    action: 'continue_default',
    reason: 'Use the current Kernel transition.',
    evidence_refs: ['event:9'],
    ...overrides,
  };
}

function validation(overrides = {}) {
  return {
    runId,
    eventCursor: 9,
    phase: 'planning',
    allowedActions: [
      'continue_default',
      'dispatch_role',
      'retry_attempt',
      'revise_guidance',
      'switch_provider',
      'switch_machine',
      'pause_run',
      'request_human',
      'abort_run',
    ],
    nextHop: 12,
    maxHops: 4096,
    duplicateHop: false,
    spentUsd: 1,
    maxUsd: 10,
    deadlineAt: '2026-07-29T00:00:00.000Z',
    now: '2026-07-28T00:00:00.000Z',
    strictMachine: null,
    capabilityAllowed: true,
    evidenceOwned: true,
    remainingRetryBudget: 2,
    ...overrides,
  };
}

function dependencies() {
  return {
    eventStore: { assertEvidenceRefs: vi.fn().mockResolvedValue(true) },
    attemptStore: {
      getById: vi.fn().mockResolvedValue({
        id: attemptId,
        run_id: runId,
        role: 'reviewer',
        status: 'failed',
        logical_cycle_id: 'intent:review',
      }),
    },
    commanderStore: {
      get: vi.fn().mockResolvedValue({ run_id: runId, event_cursor: 9 }),
      updateMemory: vi.fn().mockResolvedValue({ run_id: runId, event_cursor: 9 }),
    },
  };
}

describe('Commander L0 Directive executor', () => {
  it('returns the fresh derive decision unchanged for continue_default', async () => {
    const result = await createCommanderDirectiveExecutor(dependencies()).execute({
      directive: directive(),
      defaultDecision,
      validation: validation(),
    });
    expect(result).toMatchObject({ accepted: true, effect: 'continue_default' });
    expect(result.decision).toBe(defaultDecision);
  });

  it('allows only the role legal at the current Kernel boundary', async () => {
    const executor = createCommanderDirectiveExecutor(dependencies());
    await expect(executor.execute({
      directive: directive({ action: 'dispatch_role', target_role: 'planner' }),
      defaultDecision,
      validation: validation(),
    })).resolves.toMatchObject({
      accepted: true,
      decision: defaultDecision,
      effect: 'dispatch_role',
    });
    await expect(executor.execute({
      directive: directive({ action: 'dispatch_role', target_role: 'generator' }),
      defaultDecision,
      validation: validation(),
    })).resolves.toMatchObject({
      accepted: false,
      reason_code: 'illegal_role_at_kernel_boundary',
    });
  });

  it('retries only an owned terminal Attempt with evidence and preserved lineage', async () => {
    const deps = dependencies();
    const result = await createCommanderDirectiveExecutor(deps).execute({
      directive: directive({
        action: 'retry_attempt',
        target_attempt_id: attemptId,
        evidence_refs: [`attempt:${attemptId}`],
      }),
      defaultDecision,
      validation: validation(),
    });

    expect(result).toMatchObject({
      accepted: true,
      effect: 'retry_attempt',
      decision: { action: 'spawn:reviewer' },
      dispatch_context: {
        retry_of_attempt_id: attemptId,
        logical_cycle_id: 'intent:review',
      },
    });
    deps.attemptStore.getById.mockResolvedValueOnce({
      id: attemptId,
      run_id: runId,
      role: 'reviewer',
      status: 'running',
      logical_cycle_id: 'intent:review',
    });
    await expect(createCommanderDirectiveExecutor(deps).execute({
      directive: directive({
        action: 'retry_attempt',
        target_attempt_id: attemptId,
        evidence_refs: [`attempt:${attemptId}`],
      }),
      defaultDecision,
      validation: validation(),
    })).resolves.toMatchObject({
      accepted: false,
      reason_code: 'retry_source_not_terminal',
    });
  });

  it('changes only Commander memory for revise_guidance', async () => {
    const deps = dependencies();
    const result = await createCommanderDirectiveExecutor(deps).execute({
      directive: directive({
        action: 'revise_guidance',
        guidance: 'Require the planner to cite event evidence.',
      }),
      defaultDecision,
      validation: validation(),
    });

    expect(result).toMatchObject({
      accepted: true,
      effect: 'revise_guidance',
      decision: defaultDecision,
    });
    expect(deps.commanderStore.updateMemory).toHaveBeenCalledWith(runId, {
      expectedCursor: 9,
      latestGuidance: { text: 'Require the planner to cite event evidence.' },
      status: 'ready',
    });
  });

  it.each([
    ['pause_run', 'pause_run'],
    ['request_human', 'wait:human_review'],
    ['abort_run', 'mark_failed'],
  ])('maps %s to bounded Kernel control %s', async (action, expectedAction) => {
    await expect(createCommanderDirectiveExecutor(dependencies()).execute({
      directive: directive({ action }),
      defaultDecision,
      validation: validation(),
    })).resolves.toMatchObject({
      accepted: true,
      decision: { action: expectedAction },
    });
  });

  it.each(['switch_provider', 'switch_machine'])(
    'defers Phase 3 route mutation %s',
    async (action) => {
      await expect(createCommanderDirectiveExecutor(dependencies()).execute({
        directive: directive({
          action,
          route: { provider: 'claude', machine: 'xian-mac-m4' },
        }),
        defaultDecision,
        validation: validation(),
      })).resolves.toMatchObject({
        accepted: false,
        reason_code: 'phase2_route_mutation_deferred',
      });
    },
  );

  it('preserves validator fences before action semantics', async () => {
    await expect(createCommanderDirectiveExecutor(dependencies()).execute({
      directive: directive({ event_cursor: 8 }),
      defaultDecision,
      validation: validation(),
    })).resolves.toMatchObject({
      accepted: false,
      reason_code: 'stale_event_cursor',
    });
    await expect(createCommanderDirectiveExecutor(dependencies()).execute({
      directive: directive(),
      defaultDecision,
      validation: validation({ evidenceOwned: false }),
    })).resolves.toMatchObject({
      accepted: false,
      reason_code: 'evidence_not_owned',
    });
  });
});
