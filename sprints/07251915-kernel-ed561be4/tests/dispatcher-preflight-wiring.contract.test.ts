import { describe, expect, it, vi } from 'vitest';

import { createDispatcher } from '../../../packages/brain/src/orchestrator/dispatcher.js';
import { createCapabilityGate } from '../../../packages/brain/src/orchestrator/preflight/capability-gate.js';

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const ATTEMPT_ID = '33333333-3333-4333-8333-333333333333';

function fakeSkill(name: string) {
  return Object.freeze({
    name,
    version: '1.0.0',
    digest: `sha256:${'b'.repeat(64)}`,
    content: `${name} instructions`,
  });
}

function buildObserved(payloadOverrides: Record<string, unknown> = {}) {
  return {
    task: {
      id: TASK_ID,
      title: 'Kernel capability gate',
      description: 'preflight before attempt creation',
      payload: {
        sprint_dir: 'sprints/07251915-kernel-ed561be4',
        worktree_path: '/workspace',
        role_assignments: {
          generator: { provider: 'codex', account: 'team4' },
        },
        logical_cycle: 3,
        contract_requirements: {
          provider_auth: true,
          github: true,
          postgres: true,
          model_capabilities: ['structured_output'],
        },
        ...payloadOverrides,
      },
    },
    run: { id: RUN_ID },
  };
}

function createRealGate(overrides: Record<string, unknown> = {}) {
  return createCapabilityGate({
    probeProviderAuth: async ({ provider, account }: { provider: string; account: string }) => ({
      ok: true,
      provider,
      account,
    }),
    probeGitHub: async () => ({ ok: true }),
    probePostgres: async () => ({ ok: true }),
    probeModelCapability: async ({ capability }: { capability: string }) => ({ ok: true, capability }),
    resolveCanonicalMachineId: async ({ machine }: { machine: string }) => machine,
    getMachineHealth: async ({ machine }: { machine: string }) => ({ ok: true, machine }),
    getMachineCapacity: async () => ({ ok: true, available: 3 }),
    listProviderAccounts: async () => ['team1', 'team2', 'team3', 'team4', 'team5'],
    now: () => 1_000,
    probeTimeoutMs: 50,
    snapshotTtlMs: 500,
    ...overrides,
  });
}

function createDispatcherDeps(preflightGate: ReturnType<typeof createCapabilityGate>) {
  const order: string[] = [];
  const recordedPreflightGate = {
    evaluate: async (input: unknown) => {
      order.push('preflight');
      return preflightGate.evaluate(input);
    },
    validateSnapshotForDispatch: (...args: unknown[]) => preflightGate.validateSnapshotForDispatch(...args),
  };
  const createAttempt = vi.fn(async (input) => {
    order.push('createAttempt');
    return { id: input.id, ...input, task_bundle: input.bundle };
  });
  const launcher = {
    launch: vi.fn(async () => {
      order.push('launch');
      return { containerId: 'cx-1' };
    }),
  };
  return {
    order,
    createAttempt,
    launcher,
    deps: {
      attemptStore: {
        createAttempt,
        fail: vi.fn(),
      },
      registry: {
        resolve: vi.fn(() => ({
          name: 'codex',
          start: vi.fn(() => {
            order.push('adapter.start');
            return { provider: 'codex', args: [], stdin: '{}' };
          }),
        })),
      },
      launcher,
      loadSkill: vi.fn(fakeSkill),
      randomUUID: () => ATTEMPT_ID,
      createCallbackSecret: () => 'secret',
      machineId: 'us-mac-m4',
      preflightGate: recordedPreflightGate,
    },
  };
}

describe('dispatcher preflight wiring contract [BEHAVIOR]', () => {
  it('dispatcher 真实调用 preflight 后才创建合法 UUID attempt 并写完整 evidence', async () => {
    const gate = createRealGate();
    const { deps, order, createAttempt } = createDispatcherDeps(gate);
    const dispatch = createDispatcher(deps);

    await dispatch('spawn:generator', {
      taskId: TASK_ID,
      runId: RUN_ID,
      hop: 7,
      observed: buildObserved({
        role_assignments: { generator: { provider: 'codex', account: 'team1' } },
      }),
      decision: { phase: 'generate', reason: 'approved' },
    });

    expect(order).toEqual(['preflight', 'createAttempt', 'adapter.start', 'launch']);
    const created = createAttempt.mock.calls[0][0];
    expect(created.id).toBe(ATTEMPT_ID);
    expect(created.run_id).toBe(RUN_ID);
    expect(created.bundle.inputs).toMatchObject({
      capability_snapshot_id: expect.any(String),
      capability_evidence: {
        capability_snapshot_id: expect.any(String),
        from_target: expect.any(Object),
        to_target: expect.any(Object),
        fallback_reason: 'preferred_target_healthy',
        failure_class: 'none',
      },
    });
  });

  it('五个 Codex 账号全失败时 dispatcher 不建 attempt 并转人审告警', async () => {
    const probedAccounts: string[] = [];
    const emitAlert = vi.fn();
    const gate = createRealGate({
      probeProviderAuth: async ({ account }: { account: string }) => {
        probedAccounts.push(account);
        return { ok: false, transient: false, signature: `auth_failed:${account}` };
      },
      emitAlert,
    });
    const { deps, createAttempt, launcher } = createDispatcherDeps(gate);
    const dispatch = createDispatcher(deps);

    const result = await dispatch('spawn:generator', {
      taskId: TASK_ID,
      runId: RUN_ID,
      hop: 8,
      observed: buildObserved({
        role_assignments: { generator: { provider: 'codex', account: 'team1' } },
      }),
      decision: { phase: 'generate', reason: 'approved' },
    });

    expect(probedAccounts).toEqual(['team1', 'team2', 'team3', 'team4', 'team5']);
    expect(createAttempt).not.toHaveBeenCalled();
    expect(launcher.launch).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'DONE_WITH_CONCERNS',
      action: 'wait:human_review',
      failure_class: 'infrastructure_blocked',
      should_enter_generator_fix: false,
    });
    expect(result.evidence).toMatchObject({
      capability_snapshot_id: expect.any(String),
      from_target: expect.any(Object),
      to_target: null,
      fallback_reason: 'all_execution_targets_exhausted',
      failure_class: 'infrastructure_blocked',
    });
    expect(emitAlert).toHaveBeenCalledTimes(1);
  });

  it('过期 snapshot 在 createAttempt 前被竞态闸拒绝', async () => {
    let now = 1_000;
    const gate = createRealGate({
      now: () => now,
      snapshotTtlMs: 20,
      beforeDispatchSnapshotValidation: () => {
        now = 1_021;
      },
    });
    const { deps, createAttempt, launcher } = createDispatcherDeps(gate);
    const dispatch = createDispatcher(deps);

    const result = await dispatch('spawn:generator', {
      taskId: TASK_ID,
      runId: RUN_ID,
      hop: 9,
      observed: buildObserved(),
      decision: { phase: 'generate', reason: 'approved' },
    });

    expect(createAttempt).not.toHaveBeenCalled();
    expect(launcher.launch).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      action: 'wait:human_review',
      failure_class: 'infrastructure_blocked',
      fallback_reason: 'capability_snapshot_expired',
    });
  });
});
