/**
 * run.js CLI 入口单测：parseArgs 解析契约。
 * buildRealDeps/main 组装真实 pg/execSync，不在单测覆盖（--dry-run 冒烟见 scripts/smoke/orchestrator-smoke.sh）。
 */
import { describe, it, expect, vi } from 'vitest';
import { signMachineAttestation } from '../machine-attestation.js';
import { buildRealDeps, parseArgs } from '../run.js';

describe('parseArgs', () => {
  it('--task-id 必填，缺失即抛用法错误', () => {
    expect(() => parseArgs([])).toThrow(/--task-id/);
  });

  it('解析 --task-id / --run-id / --dry-run', () => {
    const a = parseArgs(['--task-id', 'T1', '--run-id', 'R1', '--dry-run']);
    expect(a).toEqual({ taskId: 'T1', runId: 'R1', dryRun: true });
  });

  it('默认 dryRun=false、runId=null', () => {
    const a = parseArgs(['--task-id', 'T1']);
    expect(a).toEqual({ taskId: 'T1', runId: null, dryRun: false });
  });
});

describe('buildRealDeps', () => {
  it('组装真实 dispatcher，不再返回 T3 NotImplemented 占位', async () => {
    const dispatch = vi.fn();
    const deps = await buildRealDeps({
      pool: { query: vi.fn() },
      dispatch,
      execCmd: vi.fn(),
      fileExists: vi.fn(),
      readFile: vi.fn(),
    });

    expect(deps.dispatch).toBe(dispatch);
    expect(deps.commanderCoordinator).toMatchObject({
      reconcile: expect.any(Function),
    });
    expect(deps.commanderDirectiveExecutor).toMatchObject({
      execute: expect.any(Function),
    });
    expect(String(deps.dispatch)).not.toContain('NotImplemented');
  });

  it('wires the central Credential Broker into the real Fleet Worker launcher', async () => {
    const attemptId = '33333333-3333-4333-8333-333333333333';
    const sharedSecret = 'run-test-fleet-secret-that-is-long-enough';
    const credentialBroker = {
      issue: vi.fn(async () => ({
        contract_version: 'credential-envelope/v1',
        credential_ref: '44444444-4444-4444-8444-444444444444',
        attempt_id: attemptId,
        account_id: 'team4',
        machine_id: 'us-mac-m4',
        issued_at: '2026-07-27T15:00:00.000Z',
        expires_at: '2026-07-27T17:00:00.000Z',
        payload_hash: `sha256:${'a'.repeat(64)}`,
        payload: 'eyJ0b2tlbnMiOnsiYWNjZXNzX3Rva2VuIjoidGVzdCJ9fQ==',
      })),
    };
    const fetchFn = vi.fn(async (_url, options) => {
      const request = JSON.parse(options.body);
      const jobId = 'run-test-fleet-job';
      return {
        ok: true,
        status: 202,
        json: vi.fn(async () => ({
          status: 'accepted',
          job_id: jobId,
          actual_machine_id: 'us-mac-m4',
          attestation: signMachineAttestation({
            secret: sharedSecret,
            attemptId: request.attempt_id,
            machineId: 'us-mac-m4',
            jobId,
          }),
        })),
      };
    });
    const attemptStore = {
      createAttempt: vi.fn(async (input) => ({
        ...input,
        id: input.id,
        run_id: input.runId,
        task_bundle: input.bundle,
      })),
      markStarting: vi.fn(async (id, { leaseOwner }) => ({
        id,
        status: 'starting',
        lease_owner: leaseOwner,
        lease_generation: 0,
      })),
      recordLaunchReceipt: vi.fn(async (id, receipt) => ({ id, ...receipt })),
      fail: vi.fn(),
    };
    const preflightGate = {
      evaluate: vi.fn(async ({ preferred_target: target }) => ({
        status: 'ok',
        snapshot: {
          ...target,
          verified: true,
          capability_snapshot_id: 'run-test-credential-snapshot',
          expires_at: Date.now() + 1000,
        },
        evidence: {},
        to_target: target,
      })),
      validateSnapshotForDispatch: vi.fn(async (snapshot) => ({ status: 'ok', snapshot })),
    };
    const deps = await buildRealDeps({
      pool: { query: vi.fn() },
      env: {
        KERNEL_FLEET_REMOTE_ENABLED: 'true',
        FLEET_WORKER_US_MAC_M4_URL: 'http://worker.internal:3458',
        KERNEL_FLEET_BRIDGE_TOKEN: sharedSecret,
        KERNEL_FLEET_REMOTE_CALLBACK_BASE_URL: 'http://brain.internal:5221',
      },
      attemptStore,
      credentialBroker,
      fetchFn,
      handlers: {},
      machineId: 'us-mac-m4',
      preflightGate,
      resolveRepoHead: vi.fn(async () => 'c'.repeat(40)),
      loadSkill: vi.fn(() => ({
        name: 'harness-generator',
        version: '1.0.0',
        digest: `sha256:${'b'.repeat(64)}`,
        content: 'generate',
      })),
      randomUUID: () => attemptId,
      leaseOwner: 'run-test:credential-broker',
    });

    await deps.dispatch('spawn:generator', {
      taskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      runId: '11111111-1111-4111-8111-111111111111',
      hop: 8,
      decision: { phase: 'generate' },
      observed: {
        task: {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          title: 'central credential broker wiring',
          payload: {
            sprint_dir: 'sprints/credential-broker',
            role_assignments: {
              generator: {
                provider: 'codex',
                account: 'team4',
                machine: 'us-mac-m4',
              },
            },
          },
        },
        run: { phase: 'generate' },
        contract: { row: {} },
        pr: null,
      },
    });

    expect(credentialBroker.issue).toHaveBeenCalledWith(expect.objectContaining({
      attemptId,
      accountId: 'team4',
      machineId: 'us-mac-m4',
    }));
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).credential_envelope)
      .toMatchObject({ credential_ref: '44444444-4444-4444-8444-444444444444' });
  });

  it('默认 registry 注册 Grok，可把 evaluator 派给不同厂商', async () => {
    const attemptStore = {
      createAttempt: vi.fn(async (input) => ({ id: input.id, ...input, task_bundle: input.bundle })),
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
    };
    const launcher = {
      launch: vi.fn(async ({ target }) => Object.freeze({
        actualMachineId: target.machine,
        executionTransport: 'local-docker',
        remoteJobId: null,
        attestationStatus: 'local',
        containerId: 'grok-worker',
        jobId: null,
      })),
      cancel: vi.fn(),
    };
    const deps = await buildRealDeps({
      pool: { query: vi.fn() },
      attemptStore,
      launcher,
      handlers: {},
      machineId: 'us-mac-m4',
      preflightGate: {
        evaluate: vi.fn(async ({ preferred_target: preferredTarget }) => ({
          status: 'ok',
          snapshot: {
            ...preferredTarget,
            verified: true,
            capability_snapshot_id: 'run-test-snapshot',
            expires_at: Date.now() + 1_000,
          },
          evidence: {
            capability_snapshot_id: 'run-test-snapshot',
            from_target: preferredTarget,
            to_target: preferredTarget,
            fallback_reason: 'preferred_target_healthy',
            failure_class: 'none',
          },
          to_target: preferredTarget,
        })),
        validateSnapshotForDispatch: vi.fn(async (snapshot) => ({ status: 'ok', snapshot })),
      },
      loadSkill: vi.fn(() => ({
        name: 'harness-evaluator', version: '1.0.0', digest: `sha256:${'a'.repeat(64)}`, content: 'evaluate',
      })),
      leaseOwner: 'run-test:4242',
    });

    await deps.dispatch('spawn:evaluator', {
      taskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      runId: '11111111-1111-4111-8111-111111111111',
      hop: 7,
      decision: { phase: 'evaluate' },
      observed: {
        task: {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          title: 'cross-vendor review',
          payload: {
            sprint_dir: 'sprints/x',
            worktree_path: '/tmp/wt',
            role_assignments: { evaluator: { provider: 'grok', account: 'grok' } },
          },
        },
        run: { phase: 'evaluate' },
        contract: { row: {} },
        pr: {
          url: 'https://github.com/o/r/pull/1',
          state: 'OPEN',
          head_ref: 'cp-cross-vendor-review',
          head_sha: 'b'.repeat(40),
        },
      },
    });

    expect(attemptStore.createAttempt).toHaveBeenCalledWith(expect.objectContaining({
      role: 'evaluator', provider: 'grok', accountId: 'grok',
    }));
  });

  it.each([
    ['injected env machine', { CECELIA_MACHINE_ID: 'xian-mac-m1' }, 'xian-mac-m1'],
    ['canonical default', {}, 'us-mac-m4'],
  ])('uses %s instead of ambient process.env identity', async (_case, env, expectedMachine) => {
    const previous = process.env.CECELIA_MACHINE_ID;
    process.env.CECELIA_MACHINE_ID = 'ambient-host-must-not-leak';
    const attemptStore = {
      createAttempt: vi.fn(async (input) => ({
        ...input,
        id: input.id,
        run_id: input.runId,
        task_bundle: input.bundle,
      })),
      markStarting: vi.fn(async (id, { leaseOwner }) => ({
        id,
        status: 'starting',
        lease_owner: leaseOwner,
        lease_generation: 0,
      })),
      recordLaunchReceipt: vi.fn(async (id) => ({ id })),
      fail: vi.fn(),
    };
    const preflightGate = {
      evaluate: vi.fn(async ({ preferred_target: target }) => ({
        status: 'ok',
        snapshot: { ...target, capability_snapshot_id: 'canonical-machine' },
        evidence: {},
        to_target: target,
      })),
      validateSnapshotForDispatch: vi.fn(async () => ({ status: 'ok' })),
    };
    try {
      const deps = await buildRealDeps({
        pool: { query: vi.fn() },
        attemptStore,
        env,
        handlers: {},
        preflightGate,
        launcher: {
          launch: vi.fn(async ({ target }) => ({
            actualMachineId: target.machine,
            executionTransport: 'fleet-worker',
            remoteJobId: 'canonical-worker-job',
            attestationStatus: 'verified',
            jobId: 'canonical-worker-job',
          })),
          cancel: vi.fn(),
        },
        resolveRepoHead: vi.fn(async () => 'c'.repeat(40)),
        loadSkill: vi.fn(() => ({
          name: 'harness-generator',
          version: '1.0.0',
          digest: `sha256:${'b'.repeat(64)}`,
          content: 'generate',
        })),
        randomUUID: () => '33333333-3333-4333-8333-333333333333',
        leaseOwner: 'run-test:canonical',
      });

      await deps.dispatch('spawn:generator', {
        taskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        runId: '11111111-1111-4111-8111-111111111111',
        hop: 8,
        decision: { phase: 'generate' },
        observed: {
          task: {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            title: 'canonical machine',
            payload: {
              sprint_dir: 'sprints/canonical-machine',
              worktree_path: '/tmp/wt',
            },
          },
          run: { phase: 'generate' },
          contract: { row: {} },
          pr: null,
        },
      });

      expect(preflightGate.evaluate).toHaveBeenCalledWith(expect.objectContaining({
        preferred_target: expect.objectContaining({ machine: expectedMachine }),
      }));
      expect(attemptStore.createAttempt).toHaveBeenCalledWith(expect.objectContaining({
        machineId: expectedMachine,
      }));
      const createdBundle = attemptStore.createAttempt.mock.calls[0][0].bundle;
      expect(createdBundle.inputs).toMatchObject({
        execution_surface: 'fleet-worker',
        workspace_spec: {
          repo: 'perfectuser21/cecelia',
          base_sha: 'c'.repeat(40),
          mode: 'read-write',
          run_id: '11111111-1111-4111-8111-111111111111',
          attempt_id: '33333333-3333-4333-8333-333333333333',
        },
      });
      expect(createdBundle.inputs).not.toHaveProperty('worktree_path');
    } finally {
      if (previous === undefined) delete process.env.CECELIA_MACHINE_ID;
      else process.env.CECELIA_MACHINE_ID = previous;
    }
  });
});
