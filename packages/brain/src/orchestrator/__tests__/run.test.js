/**
 * run.js CLI 入口与生产依赖组装契约。
 * main 的真实 pg/execSync 仍由 --dry-run 冒烟覆盖（scripts/smoke/orchestrator-smoke.sh）。
 */
import { describe, it, expect, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { signMachineAttestation } from '../machine-attestation.js';
import { buildRealDeps, parseArgs, runKernelMain } from '../run.js';

describe('parseArgs', () => {
  it('--task-id 必填，缺失即抛用法错误', () => {
    expect(() => parseArgs([])).toThrow(/--task-id/);
  });

  it('解析 --task-id / --run-id / --dry-run', () => {
    const a = parseArgs([
      '--task-id', 'T1',
      '--run-id', 'R1',
      '--resume-token', 'resume-token-1',
      '--dry-run',
    ]);
    expect(a).toEqual({
      taskId: 'T1',
      runId: 'R1',
      resumeToken: 'resume-token-1',
      dryRun: true,
    });
  });

  it('默认 dryRun=false、runId=null、resumeToken=null', () => {
    const a = parseArgs(['--task-id', 'T1']);
    expect(a).toEqual({
      taskId: 'T1',
      runId: null,
      resumeToken: null,
      dryRun: false,
    });
  });
});

describe('runKernelMain fatal convergence', () => {
  it('terminalizes and closes the exact pool when dependency assembly fails', async () => {
    const pool = { end: vi.fn() };
    const finalizeRun = vi.fn(async () => ({ phase: 'failed' }));
    const buildDeps = vi.fn(async ({ onPool }) => {
      onPool(pool);
      throw new Error('dependency_assembly_failed');
    });

    await expect(runKernelMain({
      taskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      runId: '11111111-1111-4111-8111-111111111111',
      resumeToken: null,
      dryRun: false,
    }, {
      buildDeps,
      runLoopFn: vi.fn(),
      finalizeRun,
    })).rejects.toThrow('dependency_assembly_failed');

    expect(finalizeRun).toHaveBeenCalledWith(pool, {
      runId: '11111111-1111-4111-8111-111111111111',
      expectedTaskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      outcome: 'failed',
      reason: 'kernel_process_fatal:dependency_assembly_failed',
    });
    expect(pool.end).toHaveBeenCalledOnce();
  });

  it('terminalizes the exact run and parent task when startup fails before heartbeat', async () => {
    const pool = { end: vi.fn() };
    const finalizeRun = vi.fn(async () => ({ phase: 'failed' }));
    const fatal = new Error('workspace_repo_not_supported');

    await expect(runKernelMain({
      taskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      runId: '11111111-1111-4111-8111-111111111111',
      resumeToken: null,
      dryRun: false,
    }, {
      buildDeps: vi.fn(async () => ({ pool })),
      runLoopFn: vi.fn(async () => { throw fatal; }),
      finalizeRun,
    })).rejects.toThrow('workspace_repo_not_supported');

    expect(finalizeRun).toHaveBeenCalledWith(pool, {
      runId: '11111111-1111-4111-8111-111111111111',
      expectedTaskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      outcome: 'failed',
      reason: 'kernel_process_fatal:workspace_repo_not_supported',
    });
    expect(pool.end).toHaveBeenCalledOnce();
  });

  it('redacts credentials before persisting a fatal diagnostic', async () => {
    const pool = { end: vi.fn() };
    const finalizeRun = vi.fn(async () => ({ phase: 'failed' }));

    await expect(runKernelMain({
      taskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      runId: '11111111-1111-4111-8111-111111111111',
      resumeToken: null,
      dryRun: false,
    }, {
      buildDeps: vi.fn(async () => ({ pool })),
      runLoopFn: vi.fn(async () => {
        throw new Error('KERNEL_FLEET_BRIDGE_TOKEN=raw-bridge-secret');
      }),
      finalizeRun,
    })).rejects.toThrow('raw-bridge-secret');

    const persisted = finalizeRun.mock.calls[0][1].reason;
    expect(persisted).toContain('[REDACTED]');
    expect(persisted).not.toContain('raw-bridge-secret');
  });
});

// r17 实证：task.status 运行中恒 'queued'（派发时也不置 in_progress）。以下锁死
// runKernelMain 启动流程装载 task 后必须调用 activateQueuedTask（默认实现
// kernel-run-store.activateQueuedKernelTask）单条 UPDATE，失败只告警不中断 loop
// （PrepPRD: docs/prd/2026-08-04-kernel-phase-persist-prep-prd.md）。
describe('runKernelMain：task 启动置位', () => {
  it('非 dry-run：启动时调用 activateQueuedTask(pool, taskId)，随后照常跑 loop', async () => {
    const pool = { end: vi.fn() };
    const activateQueuedTask = vi.fn(async () => ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }));
    const runLoopFn = vi.fn(async () => ({ exitReason: 'run_done', hops: 1 }));

    const result = await runKernelMain({
      taskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      runId: '11111111-1111-4111-8111-111111111111',
      resumeToken: null,
      dryRun: false,
    }, {
      buildDeps: vi.fn(async () => ({ pool })),
      runLoopFn,
      activateQueuedTask,
    });

    expect(activateQueuedTask).toHaveBeenCalledWith(
      pool,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
    expect(runLoopFn).toHaveBeenCalled();
    expect(result).toEqual({ exitReason: 'run_done', hops: 1 });
  });

  it('dry-run：不调用 activateQueuedTask（零写入契约不破）', async () => {
    const pool = { end: vi.fn() };
    const activateQueuedTask = vi.fn(async () => null);
    const runLoopFn = vi.fn(async () => ({ exitReason: 'dry_run', hops: 0 }));

    await runKernelMain({
      taskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      runId: '11111111-1111-4111-8111-111111111111',
      resumeToken: null,
      dryRun: true,
    }, {
      buildDeps: vi.fn(async () => ({ pool })),
      runLoopFn,
      activateQueuedTask,
    });

    expect(activateQueuedTask).not.toHaveBeenCalled();
  });

  it('activateQueuedTask 失败只告警，不中断 loop（非关键路径）', async () => {
    const pool = { end: vi.fn() };
    const activateQueuedTask = vi.fn(async () => { throw new Error('connection refused'); });
    const runLoopFn = vi.fn(async () => ({ exitReason: 'run_done', hops: 1 }));
    const logError = vi.fn();

    const result = await runKernelMain({
      taskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      runId: '11111111-1111-4111-8111-111111111111',
      resumeToken: null,
      dryRun: false,
    }, {
      buildDeps: vi.fn(async () => ({ pool })),
      runLoopFn,
      activateQueuedTask,
      logError,
    });

    expect(runLoopFn).toHaveBeenCalled();
    expect(result).toEqual({ exitReason: 'run_done', hops: 1 });
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));
  });
});

describe('buildRealDeps', () => {
  it('reads frozen Git artifacts from the mounted REPO_ROOT when the Brain image cwd is not a repository', async () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), 'kernel-artifact-repo-root-'));
    const imageCwd = mkdtempSync(path.join(os.tmpdir(), 'kernel-artifact-image-cwd-'));
    const originalCwd = process.cwd();
    const git = (...args) => execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();

    try {
      git('init');
      git('config', 'user.email', 'test@example.com');
      git('config', 'user.name', 'Test');
      writeFileSync(path.join(repoRoot, 'contract-draft.md'), 'approved contract\n');
      git('add', 'contract-draft.md');
      git('commit', '-m', 'approved contract');
      const approvedSha = git('rev-parse', 'HEAD');

      process.chdir(imageCwd);
      const deps = await buildRealDeps({
        pool: { query: vi.fn() },
        dispatch: vi.fn(),
        env: { REPO_ROOT: repoRoot },
      });

      expect(deps.readGitFile(approvedSha, 'contract-draft.md'))
        .toBe('approved contract\n');
    } finally {
      process.chdir(originalCwd);
      rmSync(repoRoot, { recursive: true, force: true });
      rmSync(imageCwd, { recursive: true, force: true });
    }
  });

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
    expect(deps.reconcileExpiredAttempt).toBeUndefined();
    expect(String(deps.dispatch)).not.toContain('NotImplemented');
  });

  it('wires expired-attempt reconciliation to the exact production launcher and authority', async () => {
    const attempt = {
      id: '863fdc22-ad3e-4e89-a8ce-6323cf9b9917',
      run_id: '92a67d1a-2c3a-4819-9930-09d841f31bd8',
      hop: 49,
      phase: 'gan',
      role: 'reviewer',
      status: 'running',
      lease_owner: 'controller-old:6328',
      lease_generation: 0,
      lease_expires_at: '2026-08-03T07:59:00.000Z',
      requested_machine_id: 'us-mac-m4',
      actual_machine_id: null,
    };
    const launcher = {
      inspect: vi.fn(async () => ({ status: 'missing', attempt_id: attempt.id })),
      start: vi.fn(),
      cancel: vi.fn(),
    };
    const terminalize = vi.fn(async () => ({
      attempt: { ...attempt, status: 'failed' },
      hop: 50,
    }));
    const deps = await buildRealDeps({
      pool: { query: vi.fn() },
      dispatch: vi.fn(),
      launcher,
      attemptStore: { heartbeat: vi.fn() },
      expiredAttemptAuthority: { terminalize },
      now: () => new Date('2026-08-03T08:00:00.000Z'),
    });

    const result = await deps.reconcileExpiredAttempt({ attempt });

    expect(launcher.inspect).toHaveBeenCalledWith({
      attempt,
      target: { machine: 'us-mac-m4' },
    });
    expect(terminalize).toHaveBeenCalledWith(expect.objectContaining({
      attemptId: attempt.id,
      runId: attempt.run_id,
      leaseOwner: attempt.lease_owner,
      leaseGeneration: 0,
      code: 'worker_attempt_missing_after_lease',
    }));
    expect(result).toMatchObject({ status: 'missing_terminalized', hop: 50 });
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
    const githubCredentialBroker = {
      issue: vi.fn(async () => ({
        contract_version: 'github-credential-envelope/v1',
        credential_ref: '55555555-5555-4555-8555-555555555555',
        attempt_id: attemptId,
        machine_id: 'us-mac-m4',
        issued_at: '2026-07-27T15:00:00.000Z',
        expires_at: '2026-07-27T16:00:00.000Z',
        payload_hash: `sha256:${'c'.repeat(64)}`,
        payload: 'Z2l0aHViX3BhdF90ZXN0',
      })),
    };
    const fetchFn = vi.fn(async (url, options) => {
      const request = JSON.parse(options.body);
      if (String(url).endsWith(`/harness/attempts/${attemptId}/start`)) {
        return {
          ok: true,
          status: 200,
          json: vi.fn(async () => ({ status: 'running', attempt_id: attemptId })),
        };
      }
      if (!String(url).endsWith('/harness/attempts/prepare')) {
        throw new Error(`unexpected fetch: ${url}`);
      }
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
      githubCredentialBroker,
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
    expect(githubCredentialBroker.issue).toHaveBeenCalledWith(expect.objectContaining({
      attemptId,
      machineId: 'us-mac-m4',
    }));
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([
      'http://worker.internal:3458/harness/attempts/prepare',
      `http://worker.internal:3458/harness/attempts/${attemptId}/start`,
    ]);
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).credential_envelope)
      .toMatchObject({ credential_ref: '44444444-4444-4444-8444-444444444444' });
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).github_credential_envelope)
      .toMatchObject({ credential_ref: '55555555-5555-4555-8555-555555555555' });
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
          prepare: vi.fn(async ({ target }) => ({
            actualMachineId: target.machine,
            executionTransport: 'fleet-worker',
            remoteJobId: 'canonical-worker-job',
            attestationStatus: 'verified',
            jobId: 'canonical-worker-job',
          })),
          start: vi.fn(async ({ attempt }) => ({
            status: 'running',
            attempt_id: attempt.id,
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
