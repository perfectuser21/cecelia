import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import { createCommanderCoordinator } from '../../../packages/brain/src/orchestrator/commander-coordinator.js';
import { buildCommanderBundle } from '../../../packages/brain/src/orchestrator/commander-bundle.js';

const runId = randomUUID();

const commanderTargets = Object.freeze([
  { role: 'commander', provider: 'codex', account: 'team2', machine: 'us-mac-m4' },
  { role: 'commander', provider: 'claude', account: 'account2', machine: 'us-mac-m4' },
]);

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
    active_risks: [],
    latest_guidance: null,
    provider: 'codex',
    account_id: 'team2',
    provider_session_id: 'old-session',
    ...overrides,
  };
}

function observedWithGates() {
  return {
    phase: 'gan',
    run: { id: runId },
    impact_gate: {
      reason: 'deny:impact_unclaimed_files',
      retryable: false,
      detail: { unclaimed_files: ['packages/brain/src/x.js'] },
    },
    admission: { signature: 'sig-abc-123', admission_reasons: ['capacity_floor_reserved'] },
    latest_attempt: { error_code: 'http_503', failure_class: 'infrastructure_blocked' },
  };
}

function coordinatorDeps() {
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
    actorInbox: { list: vi.fn().mockResolvedValue([]) },
    attemptStore: {
      getLatestCommanderAttempt: vi.fn().mockResolvedValue(null),
      listCommanderFailoverLineage: vi.fn().mockResolvedValue([]),
    },
    appendDecision: vi.fn().mockResolvedValue(undefined),
    nextHop: vi.fn().mockResolvedValue(12),
    now: () => new Date('2026-08-16T02:00:00.000Z'),
  };
}

function context() {
  return {
    run: { id: runId, commander_mode: 'hybrid', phase: 'gan' },
    commanderMode: 'hybrid',
    runProfile: { commander: { primary: commanderTargets[0], fallbacks: commanderTargets.slice(1) } },
    objective: { summary: 'Finish this Run.' },
    observed: observedWithGates(),
    defaultDecision: { phase: 'gan', action: 'wait:impact_gate', reason: 'unclaimed_files' },
    historySummary: {},
    budgets: { remaining_attempts: 2, safety_max_hops: 4096 },
    allowedActions: ['continue_default', 'dispatch_role', 'retry_attempt'],
  };
}

describe('commander-bundle 看得见闸真实结论 + 跨 run 隔离', () => {
  // RED: dispatch bundle 的 active_risks 必须携带 impact_gate/admission/attempt 真实闸结论。
  it('active_risks carries impact_gate reason/retryable, admission_reasons and attempt error_code', async () => {
    const coordinator = createCommanderCoordinator(coordinatorDeps());
    const out = await coordinator.reconcile(context());

    expect(out.kind).toBe('dispatch');
    const risks = JSON.stringify(out.context.bundle.active_risks);
    expect(risks).toContain('deny:impact_unclaimed_files');
    expect(risks).toContain('capacity_floor_reserved');
    expect(risks).toContain('sig-abc-123');
    expect(risks).toContain('http_503');
    expect(risks).toContain('infrastructure_blocked');
  });

  // Guard (green): 他 run 的事件混入 → buildCommanderBundle 抛 run_mismatch（FR-1 隔离铁闸）。
  it('rejects a cross-run event mixed into this run bundle', () => {
    const otherRunId = randomUUID();
    expect(() => buildCommanderBundle({
      runId,
      commanderAttemptId: randomUUID(),
      state: state(),
      runProfile: { commander: { primary: commanderTargets[0], fallbacks: [] } },
      objective: { summary: 'x' },
      observed: { run: { id: runId } },
      historySummary: { strategy_summary: {}, latest_guidance: null },
      newEvents: [{ ...event(6, 'run.created'), run_id: otherRunId }],
      actorMessages: [],
      activeRisks: [],
      budgets: {},
      allowedActions: ['continue_default'],
    })).toThrow(/commander_bundle_run_mismatch/);
  });
});
