import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { createCommanderCoordinator } from '../commander-coordinator.js';

const runId = randomUUID();
const commanderAttemptId = randomUUID();

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

function state(overrides = {}) {
  return {
    run_id: runId,
    event_cursor: 5,
    strategy_summary: { approach: 'Preserve Kernel truth.' },
    active_risks: [{ code: 'ci_pending' }],
    latest_guidance: { text: 'Prefer bounded evidence.' },
    provider: 'codex',
    account_id: 'team4',
    model: 'GPT-5.5',
    provider_session_id: 'old-session',
    ...overrides,
  };
}

function context(overrides = {}) {
  return {
    run: { id: runId, commander_mode: 'hybrid', phase: 'planning' },
    commanderMode: 'hybrid',
    runProfile: {
      commander: {
        primary: {
          role: 'commander',
          provider: 'codex',
          account: 'team4',
          model: 'GPT-5.5',
          machine: 'us-mac-m4',
        },
        fallbacks: [],
      },
    },
    objective: { summary: 'Finish this Run.' },
    observed: { phase: 'planning', run: { id: runId } },
    defaultDecision: {
      phase: 'planning',
      action: 'spawn:planner',
      reason: 'no_prd',
    },
    historySummary: {},
    budgets: { remaining_attempts: 2, safety_max_hops: 4096 },
    allowedActions: ['continue_default', 'dispatch_role'],
    ...overrides,
  };
}

function dependencies(overrides = {}) {
  return {
    commanderStore: {
      ensureRun: vi.fn().mockResolvedValue(state()),
      get: vi.fn().mockResolvedValue(state()),
      updateMemory: vi.fn().mockResolvedValue(state()),
      advanceCursor: vi.fn().mockImplementation(
        async (_runId, { nextCursor }) => state({ event_cursor: nextCursor }),
      ),
    },
    eventStore: {
      list: vi.fn().mockResolvedValue([event(6, 'run.created')]),
      latestCursor: vi.fn().mockResolvedValue(6),
    },
    actorInbox: {
      list: vi.fn().mockResolvedValue([]),
    },
    attemptStore: {
      getLatestCommanderAttempt: vi.fn().mockResolvedValue(null),
      listCommanderFailoverLineage: vi.fn().mockResolvedValue([]),
    },
    appendDecision: vi.fn().mockResolvedValue(undefined),
    nextHop: vi.fn().mockResolvedValue(12),
    now: () => new Date('2026-07-28T02:00:00.000Z'),
    ...overrides,
  };
}

describe('Commander coordinator', () => {
  it.each(['kernel-only', 'legacy-session'])(
    'is an exact no-I/O bypass for %s',
    async (commanderMode) => {
      const deps = dependencies();
      const coordinator = createCommanderCoordinator(deps);

      await expect(coordinator.reconcile(context({ commanderMode }))).resolves.toEqual({
        kind: 'bypass',
      });
      expect(deps.commanderStore.ensureRun).not.toHaveBeenCalled();
      expect(deps.attemptStore.getLatestCommanderAttempt).not.toHaveBeenCalled();
    },
  );

  it('builds one isolated bundle and dispatch context at a material boundary', async () => {
    const deps = dependencies();
    const coordinator = createCommanderCoordinator(deps);

    const outcome = await coordinator.reconcile(context());

    expect(outcome).toMatchObject({
      kind: 'dispatch',
      action: 'spawn:commander',
      context: {
        target: {
          role: 'commander',
          provider: 'codex',
          account: 'team4',
          model: 'GPT-5.5',
          machine: 'us-mac-m4',
        },
        bundle: {
          schema: 'commander-bundle/v1',
          run_id: runId,
          event_cursor: 6,
          history_summary: {
            strategy_summary: { approach: 'Preserve Kernel truth.' },
            latest_guidance: { text: 'Prefer bounded evidence.' },
          },
        },
      },
    });
    expect(deps.eventStore.list).toHaveBeenCalledWith(runId, {
      afterCursor: 5,
      limit: 200,
    });
    expect(deps.actorInbox.list).toHaveBeenCalledWith({
      runId,
      actorKey: 'commander',
      afterCursor: 0,
      limit: 200,
    });
    expect(JSON.stringify(outcome)).not.toMatch(
      /callback_secret|raw_prompt|raw_provider_output|old-session/,
    );
  });

  it('waits for the one in-flight Commander Attempt instead of duplicating it', async () => {
    const deps = dependencies();
    deps.attemptStore.getLatestCommanderAttempt.mockResolvedValue({
      id: commanderAttemptId,
      run_id: runId,
      role: 'commander',
      status: 'running',
    });

    await expect(
      createCommanderCoordinator(deps).reconcile(context()),
    ).resolves.toEqual({
      kind: 'wait',
      reason: 'commander_attempt_inflight',
      attempt_id: commanderAttemptId,
    });
    expect(deps.eventStore.list).not.toHaveBeenCalled();
  });

  it('consumes a fresh completed Directive once and advances over own lifecycle noise', async () => {
    const ownEvents = [
      event(6, 'attempt.running', {
        source_type: 'harness_attempt',
        source_id: commanderAttemptId,
        payload: { role: 'commander' },
      }),
      event(7, 'attempt.completed', {
        source_type: 'harness_attempt',
        source_id: commanderAttemptId,
        payload: { role: 'commander' },
      }),
    ];
    const directive = {
      schema: 'commander-directive/v1',
      run_id: runId,
      event_cursor: 5,
      action: 'continue_default',
      reason: 'Continue the fresh Kernel decision.',
      evidence_refs: ['event:5'],
    };
    const attempt = {
      id: commanderAttemptId,
      run_id: runId,
      role: 'commander',
      status: 'completed',
      provider: 'codex',
      account_id: 'team4',
      provider_session_id: 'new-session',
      task_bundle: {
        inputs: { commander_bundle: { event_cursor: 5 } },
      },
      result: { status: 'completed', decision: directive },
    };
    const deps = dependencies();
    deps.attemptStore.getLatestCommanderAttempt.mockResolvedValue(attempt);
    deps.eventStore.list
      .mockResolvedValueOnce(ownEvents)
      .mockResolvedValueOnce([]);
    deps.commanderStore.get
      .mockResolvedValueOnce(state())
      .mockResolvedValueOnce(state({ event_cursor: 7 }));

    const coordinator = createCommanderCoordinator(deps);
    await expect(coordinator.reconcile(context())).resolves.toMatchObject({
      kind: 'control',
      decision: directive,
    });
    await expect(coordinator.reconcile(context())).resolves.toEqual({
      kind: 'continue',
      decision: context().defaultDecision,
    });
    expect(deps.appendDecision).toHaveBeenCalledTimes(1);
    expect(deps.appendDecision).toHaveBeenCalledWith(expect.objectContaining({
      action: 'commander.directive_accepted',
      detail: expect.objectContaining({ attempt_id: commanderAttemptId }),
    }));
    expect(deps.commanderStore.advanceCursor).toHaveBeenCalledWith(runId, {
      expectedCursor: 5,
      nextCursor: 7,
    });
  });

  it('rejects stale output and immediately schedules a fresh observation', async () => {
    const concurrent = event(8, 'attempt.failed', {
      source_type: 'harness_attempt',
      source_id: randomUUID(),
      payload: { role: 'reviewer', failure_class: 'unknown' },
    });
    const deps = dependencies();
    deps.attemptStore.getLatestCommanderAttempt.mockResolvedValue({
      id: commanderAttemptId,
      run_id: runId,
      role: 'commander',
      status: 'completed',
      task_bundle: {
        inputs: { commander_bundle: { event_cursor: 5 } },
      },
      result: {
        status: 'completed',
        decision: {
          schema: 'commander-directive/v1',
          run_id: runId,
          event_cursor: 5,
          action: 'continue_default',
          reason: 'Now stale.',
          evidence_refs: ['event:5'],
        },
      },
    });
    deps.eventStore.list.mockResolvedValue([
      event(6, 'attempt.completed', {
        source_type: 'harness_attempt',
        source_id: commanderAttemptId,
        payload: { role: 'commander' },
      }),
      concurrent,
    ]);

    const outcome = await createCommanderCoordinator(deps).reconcile(context());

    expect(outcome).toMatchObject({
      kind: 'dispatch',
      action: 'spawn:commander',
      context: {
        bundle: {
          event_cursor: 8,
          new_events: expect.arrayContaining([concurrent]),
        },
      },
    });
    expect(deps.appendDecision).toHaveBeenCalledWith(expect.objectContaining({
      action: 'commander.directive_rejected',
      detail: expect.objectContaining({
        attempt_id: commanderAttemptId,
        reason_code: 'stale_event_cursor',
      }),
    }));
  });
});
