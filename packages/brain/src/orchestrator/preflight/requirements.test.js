import { describe, expect, it, vi } from 'vitest';

import { createDispatcher } from '../dispatcher.js';

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';

function dispatcherWithCapturedPreflight() {
  const evaluate = vi.fn(async ({ preferred_target: preferredTarget }) => ({
    status: 'ok',
    snapshot: {
      ...preferredTarget,
      verified: true,
      capability_snapshot_id: 'snapshot-1',
      expires_at: Date.now() + 10_000,
    },
    evidence: {
      capability_snapshot_id: 'snapshot-1',
      from_target: preferredTarget,
      to_target: preferredTarget,
      fallback_reason: 'preferred_target_healthy',
      failure_class: 'none',
    },
    to_target: preferredTarget,
  }));
  const deps = {
    machineId: 'us-mac-m4',
    randomUUID: () => '33333333-3333-4333-8333-333333333333',
    createCallbackSecret: () => 'secret',
    resolveAccountHome: vi.fn(() => '/tmp/provider-home'),
    preflightGate: {
      evaluate,
      validateSnapshotForDispatch: vi.fn(async (snapshot) => ({ status: 'ok', snapshot })),
    },
    attemptStore: {
      createAttempt: vi.fn(async (input) => ({ ...input, task_bundle: input.bundle })),
      markStarting: vi.fn(async (id, { leaseOwner }) => ({
        id,
        status: 'starting',
        lease_owner: leaseOwner,
        lease_generation: 0,
      })),
      recordLaunchReceipt: vi.fn(async (id, receipt) => ({
        id,
        status: 'starting',
        ...receipt,
      })),
      fail: vi.fn(),
    },
    registry: {
      resolve: vi.fn(() => ({
        name: 'codex',
        start: vi.fn(() => ({ provider: 'codex', args: [], env: {}, stdin: '{}' })),
      })),
    },
    launcher: {
      launch: vi.fn(async ({ target }) => Object.freeze({
        actualMachineId: target.machine,
        executionTransport: 'local-docker',
        remoteJobId: null,
        attestationStatus: 'local',
        containerId: 'worker-1',
        jobId: null,
      })),
      cancel: vi.fn(),
    },
    loadSkill: vi.fn((name) => ({
      name,
      version: '1.0.0',
      digest: `sha256:${'a'.repeat(64)}`,
      content: name,
    })),
    leaseOwner: 'requirements-test:4242',
  };
  return { dispatch: createDispatcher(deps), evaluate };
}

function context(role, requirements) {
  return {
    taskId: TASK_ID,
    runId: RUN_ID,
    hop: 5,
    decision: { phase: role },
    observed: {
      task: {
        id: TASK_ID,
        title: `${role} capability requirements`,
        payload: {
          sprint_dir: 'sprints/requirements',
          worktree_path: '/workspace',
          role_assignments: {
            [role]: { provider: 'codex', account: 'team1' },
          },
          contract_requirements: requirements,
        },
      },
      run: { id: RUN_ID, phase: role },
      contract: { row: {} },
      pr: role === 'evaluator'
        ? { url: 'https://github.com/perfectuser21/cecelia/pull/1' }
        : null,
    },
  };
}

describe('server-owned capability requirements', () => {
  it('payload false cannot disable generator provider auth, GitHub, or structured output', async () => {
    const { dispatch, evaluate } = dispatcherWithCapturedPreflight();

    await dispatch('spawn:generator', context('generator', {
      provider_auth: false,
      github: false,
      postgres: false,
      model_capabilities: [],
    }));

    expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({
      requirements: {
        provider_auth: true,
        github: true,
        postgres: false,
        model_capabilities: ['structured_output'],
      },
    }));
  });

  it('structured requirements can add PostgreSQL and model capabilities without duplication', async () => {
    const { dispatch, evaluate } = dispatcherWithCapturedPreflight();

    await dispatch('spawn:evaluator', context('evaluator', {
      provider_auth: true,
      github: true,
      postgres: true,
      model_capabilities: ['vision', 'structured_output', 'vision'],
    }));

    expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({
      requirements: {
        provider_auth: true,
        github: true,
        postgres: true,
        model_capabilities: ['structured_output', 'vision'],
      },
    }));
  });
});
