/**
 * run.js CLI 入口单测：parseArgs 解析契约。
 * buildRealDeps/main 组装真实 pg/execSync，不在单测覆盖（--dry-run 冒烟见 scripts/smoke/orchestrator-smoke.sh）。
 */
import { describe, it, expect, vi } from 'vitest';
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
    expect(String(deps.dispatch)).not.toContain('NotImplemented');
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
        pr: { url: 'https://github.com/o/r/pull/1' },
      },
    });

    expect(attemptStore.createAttempt).toHaveBeenCalledWith(expect.objectContaining({
      role: 'evaluator', provider: 'grok', accountId: 'grok',
    }));
  });

  it.each([
    ['injected env machine', { CECELIA_MACHINE_ID: 'env-worker' }, 'env-worker'],
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
            executionTransport: 'local-docker',
            remoteJobId: null,
            attestationStatus: 'local',
            containerId: 'canonical-worker',
          })),
          cancel: vi.fn(),
        },
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
    } finally {
      if (previous === undefined) delete process.env.CECELIA_MACHINE_ID;
      else process.env.CECELIA_MACHINE_ID = previous;
    }
  });
});
