import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDispatcher } from '../dispatcher.js';
import { createCapabilityGate } from './capability-gate.js';
import { CREDENTIAL_FRESHNESS_REASONS } from './credential-freshness.js';

const taskId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const runId = '11111111-1111-4111-8111-111111111111';
const attemptId = '22222222-2222-4222-8222-222222222222';

// Real dispatch target is a Claude account — the incident subject.
const claudeAssignment = Object.freeze({
  provider: 'claude',
  account: 'account1',
  machine: 'us-mac-m4',
  strict_affinity: true,
  fallback_targets: [],
});

const observed = {
  task: {
    id: taskId,
    title: 'Credential freshness preflight',
    description: 'dispatch guarded by credential freshness',
    payload: {
      executor: 'auto',
      sprint_dir: 'sprints/credential-freshness',
      worktree_path: '/tmp/worktree',
      role_assignments: { generator: claudeAssignment },
    },
  },
  run: { id: runId },
  contract: { approved: false, row: { propose_branch: 'cp-propose-r1' } },
  pr: null,
  prdExists: true,
  proposeBranchRn: 1,
  proposeBranch: 'cp-cred-fresh-r1',
  proposeBranchSha: 'a'.repeat(40),
  callbackResult: { transcript: 'x' },
};

function fakeSkill(name) {
  return Object.freeze({
    name, version: '1.0.0', digest: `sha256:${'a'.repeat(64)}`, content: `${name} instructions`,
  });
}

function makeDeps() {
  const leaseOwner = 'dispatcher-test:4242';
  const adapter = {
    name: 'claude',
    start: vi.fn(() => ({ provider: 'claude', command: 'claude', args: [], stdin: '{}' })),
  };
  return {
    attemptStore: {
      createAttempt: vi.fn(async (input) => ({ id: input.id, ...input, task_bundle: input.bundle })),
      markStarting: vi.fn(async (id) => ({ id, status: 'starting', lease_owner: leaseOwner, lease_generation: 0 })),
      recordLaunchReceipt: vi.fn(async (id, receipt) => ({ id, status: 'starting', ...receipt })),
      fail: vi.fn(),
      listFailedExecutionTargets: vi.fn(async () => []),
    },
    registry: { resolve: vi.fn(() => adapter) },
    launcher: {
      launch: vi.fn(async ({ target }) => ({
        actualMachineId: target?.machine ?? 'us-mac-m4',
        executionTransport: 'local-docker',
        remoteJobId: null,
        attestationStatus: 'local',
        containerId: 'container-1',
        jobId: null,
      })),
      inspect: vi.fn(),
      cancel: vi.fn(async () => ({ status: 'missing' })),
    },
    loadSkill: vi.fn(fakeSkill),
    randomUUID: () => attemptId,
    createCallbackSecret: () => 'attempt-secret',
    machineId: 'us-mac-m4',
    leaseOwner,
    onPreflightBlocked: vi.fn(async () => {}),
  };
}

function realGate(checkCredentialFreshness, extra = {}) {
  return createCapabilityGate({
    resolveCanonicalMachineId: vi.fn(async ({ machine }) => machine),
    getMachineHealth: vi.fn(async ({ machine }) => ({ ok: true, machine })),
    getMachineCapacity: vi.fn(async () => ({ ok: true, available: 1 })),
    probeProviderAuth: vi.fn(async () => ({ ok: true })),
    probeGitHub: vi.fn(async () => ({ ok: true })),
    probePostgres: vi.fn(async () => ({ ok: true })),
    probeModelCapability: vi.fn(async () => ({ ok: true })),
    emitAlert: vi.fn(async () => {}),
    recordDecision: vi.fn(async () => {}),
    checkCredentialFreshness,
    ...extra,
  });
}

const ctx = {
  taskId,
  runId,
  hop: 1,
  observed,
  decision: { phase: 'generate' },
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('dispatch preflight — credential freshness blocks the spawn', () => {
  it('does NOT create an attempt or spawn a provider when the Claude token is expiring soon', async () => {
    const deps = makeDeps();
    deps.preflightGate = realGate(vi.fn(() => ({
      fresh: false,
      reason: CREDENTIAL_FRESHNESS_REASONS.EXPIRING_SOON,
      remainingMs: 5 * 60 * 1000,
      account: 'account1',
      provider: 'claude',
      machine: 'us-mac-m4',
    })));

    const result = await createDispatcher(deps)('spawn:generator', ctx);

    // infrastructure backoff, not a terminal product failure
    expect(result).toMatchObject({
      status: 'DONE_WITH_CONCERNS',
      control_status: 'BLOCKED',
      failure_class: 'infrastructure_blocked',
      should_create_attempt: false,
    });
    expect(result.fallback_reason).toBe(CREDENTIAL_FRESHNESS_REASONS.EXPIRING_SOON);

    // the whole point: no attempt burned, no provider process spawned
    expect(deps.attemptStore.createAttempt).not.toHaveBeenCalled();
    expect(deps.launcher.launch).not.toHaveBeenCalled();
    expect(deps.onPreflightBlocked).toHaveBeenCalledTimes(1);
  });

  it('recovers without a re-dispatch: once credentials are fresh again the run advances to spawn', async () => {
    const deps = makeDeps();
    // First dispatch: stale → blocked. Second dispatch (same run, next tick): fresh → spawns.
    const checkCredentialFreshness = vi.fn()
      .mockReturnValueOnce({
        fresh: false,
        reason: CREDENTIAL_FRESHNESS_REASONS.EXPIRED,
        remainingMs: -1000,
        account: 'account1',
        provider: 'claude',
        machine: 'us-mac-m4',
      })
      .mockReturnValue({ fresh: true, reason: CREDENTIAL_FRESHNESS_REASONS.FRESH });
    deps.preflightGate = realGate(checkCredentialFreshness);

    const dispatch = createDispatcher(deps);

    const blocked = await dispatch('spawn:generator', ctx);
    expect(blocked.should_create_attempt).toBe(false);
    expect(blocked.failure_class).toBe('infrastructure_blocked'); // NOT terminal — run keeps waiting
    expect(deps.launcher.launch).not.toHaveBeenCalled();

    const launched = await dispatch('spawn:generator', { ...ctx, hop: 2 });
    expect(launched).toMatchObject({ status: 'LAUNCHED', attempt_id: attemptId });
    expect(deps.attemptStore.createAttempt).toHaveBeenCalledTimes(1);
    expect(deps.launcher.launch).toHaveBeenCalledTimes(1);
  });
});
