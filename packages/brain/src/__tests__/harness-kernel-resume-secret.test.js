import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  adapter: { name: 'codex', resume: vi.fn() },
}));

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../notifier.js', () => ({ sendBark: vi.fn() }));
vi.mock('../orchestrator/provider-registry.js', () => ({
  createProviderRegistry: () => ({ resolve: () => mocks.adapter }),
}));
vi.mock('../orchestrator/providers/claude.js', () => ({ claudeAdapter: {} }));
vi.mock('../orchestrator/providers/codex.js', () => ({ codexAdapter: {} }));
vi.mock('../orchestrator/providers/grok.js', () => ({ grokAdapter: {} }));
vi.mock('../orchestrator/dispatcher.js', () => ({
  resolveProviderAccountHome: vi.fn(),
}));

import { resumeKernelAttempt } from '../harness-relay-watchdog.js';

function makeAttemptContext() {
  const originalParentAttempt = {
    id: 'attempt-parent',
    run_id: 'run-1',
    provider: 'codex',
    provider_session_id: 'thread-1',
    account_id: null,
    machine_id: 'us-mac-m4',
    requested_machine_id: 'us-mac-m4',
    task_bundle: { inputs: {} },
    lease_owner: 'dispatcher-parent',
    lease_generation: 6,
    local_container_naming: 'generation-v1',
  };
  return {
    child: {
      id: 'attempt-child',
      run_id: 'run-1',
      provider: 'codex',
      account_id: null,
      machine_id: 'us-mac-m4',
      requested_machine_id: 'us-mac-m4',
      task_bundle: { inputs: {} },
      lease_owner: 'watchdog:test',
      lease_generation: 0,
      local_container_naming: 'generation-v1',
    },
    originalParentAttempt,
    reclaimedParentAttempt: {
      ...originalParentAttempt,
      lease_owner: 'watchdog:test',
      lease_generation: 7,
    },
  };
}

function makeDeps(overrides = {}) {
  const launcher = {
    inspect: vi.fn(async () => ({ status: 'unsupported' })),
    cancel: vi.fn(async () => ({ status: 'cancelled' })),
    prepare: vi.fn(async () => ({
      jobId: 'child-job',
      actualMachineId: 'us-mac-m4',
      executionTransport: 'fleet-worker',
      remoteJobId: 'child-job',
      attestationStatus: 'verified',
    })),
    start: vi.fn(async ({ attempt }) => ({
      status: 'running',
      attempt_id: attempt.id,
    })),
  };
  const attemptStore = {
    recordLaunchReceipt: vi.fn(async () => ({ id: 'attempt-child' })),
    fail: vi.fn(async () => ({ deduped: false })),
  };
  return {
    launcher,
    attemptStore,
    task: { payload: {} },
    dbPool: { query: vi.fn() },
    callbackSecret: 'rotated-raw-secret',
    leaseOwner: 'watchdog:test',
    onRecoveryAlert: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('resumeKernelAttempt callback fencing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.adapter.resume.mockReturnValue({
      provider: 'codex',
      args: ['exec', 'resume', 'thread-1'],
      env: {},
    });
  });

  it('轮换 hash 后只把新明文交给恢复容器，并先按旧 claim 精确取消 parent', async () => {
    const { child, originalParentAttempt, reclaimedParentAttempt } = makeAttemptContext();
    const deps = makeDeps();

    const result = await resumeKernelAttempt(child, {
      ...deps,
      originalParentAttempt,
      reclaimedParentAttempt,
    });

    expect(result).toMatchObject({ ok: true, resumed: true });
    expect(mocks.adapter.resume).toHaveBeenCalledWith(expect.objectContaining({
      attempt: expect.objectContaining({
        id: 'attempt-parent',
        provider_session_id: 'thread-1',
      }),
    }));
    expect(deps.launcher.inspect).toHaveBeenCalledWith({
      attempt: originalParentAttempt,
      target: expect.objectContaining({ machine: 'us-mac-m4' }),
    });
    expect(deps.launcher.cancel).toHaveBeenCalledWith({
      attempt: expect.objectContaining({
        id: 'attempt-parent',
        lease_owner: 'dispatcher-parent',
        lease_generation: 6,
      }),
      target: expect.objectContaining({ machine: 'us-mac-m4' }),
    });
    expect(deps.launcher.inspect.mock.invocationCallOrder[0])
      .toBeLessThan(deps.launcher.cancel.mock.invocationCallOrder[0]);
    expect(deps.launcher.cancel.mock.invocationCallOrder[0])
      .toBeLessThan(deps.launcher.prepare.mock.invocationCallOrder[0]);
    expect(deps.launcher.prepare).toHaveBeenCalledWith(expect.objectContaining({
      attempt: expect.objectContaining({
        id: 'attempt-child',
        callbackSecret: 'rotated-raw-secret',
        lease_owner: 'watchdog:test',
        lease_generation: 0,
      }),
      leaseClaimed: true,
    }));
    expect(deps.attemptStore.recordLaunchReceipt).toHaveBeenCalledWith(
      'attempt-child',
      expect.objectContaining({
        leaseOwner: 'watchdog:test',
        leaseGeneration: 0,
      }),
    );
    expect(deps.launcher.prepare.mock.invocationCallOrder[0])
      .toBeLessThan(deps.attemptStore.recordLaunchReceipt.mock.invocationCallOrder[0]);
    expect(deps.attemptStore.recordLaunchReceipt.mock.invocationCallOrder[0])
      .toBeLessThan(deps.launcher.start.mock.invocationCallOrder[0]);
  });

  it('旧 attempt 无法确认清除时不启动恢复容器并发出安全告警', async () => {
    const { child, originalParentAttempt, reclaimedParentAttempt } = makeAttemptContext();
    const deps = makeDeps();
    deps.launcher.cancel.mockResolvedValueOnce({ status: 'missing' });

    const result = await resumeKernelAttempt(child, {
      ...deps,
      originalParentAttempt,
      reclaimedParentAttempt,
    });

    expect(result).toMatchObject({
      ok: false,
      failure_code: 'resume_parent_cleanup_unconfirmed',
      cleanup_status: 'missing',
      recovery_alert: expect.objectContaining({
        attemptId: 'attempt-parent',
        kind: 'cleanup_unconfirmed',
      }),
    });
    expect(deps.launcher.inspect).toHaveBeenCalledOnce();
    expect(deps.launcher.cancel).toHaveBeenCalledOnce();
    expect(deps.onRecoveryAlert).not.toHaveBeenCalled();
    expect(deps.launcher.prepare).not.toHaveBeenCalled();
    expect(deps.launcher.start).not.toHaveBeenCalled();
    expect(deps.attemptStore.recordLaunchReceipt).not.toHaveBeenCalled();
  });
});
