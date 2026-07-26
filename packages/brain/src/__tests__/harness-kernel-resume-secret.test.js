import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  inspect: vi.fn(),
  cancel: vi.fn(),
  launch: vi.fn(),
  recordLaunchReceipt: vi.fn(),
  adapter: { name: 'codex', resume: vi.fn() },
}));

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../notifier.js', () => ({ sendBark: vi.fn() }));
vi.mock('../orchestrator/attempt-store.js', () => ({
  createAttemptStore: () => ({}),
}));
vi.mock('../orchestrator/provider-registry.js', () => ({
  createProviderRegistry: () => ({ resolve: () => mocks.adapter }),
}));
vi.mock('../orchestrator/providers/claude.js', () => ({ claudeAdapter: {} }));
vi.mock('../orchestrator/providers/codex.js', () => ({ codexAdapter: {} }));
vi.mock('../orchestrator/dispatcher.js', () => ({
  resolveProviderAccountHome: vi.fn(),
}));
vi.mock('../orchestrator/callback-auth.js', () => ({
  generateCallbackSecret: () => 'rotated-raw-secret',
  hashCallbackSecret: (value) => `hash:${value}`,
}));

import { resumeKernelAttempt } from '../harness-relay-watchdog.js';

describe('resumeKernelAttempt callback fencing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inspect.mockResolvedValue({ status: 'running' });
    mocks.cancel.mockResolvedValue({ status: 'cancelled' });
    mocks.adapter.resume.mockReturnValue({ provider: 'codex', args: ['exec', 'resume', 'thread-1'], env: {} });
    mocks.launch.mockResolvedValue({
      containerId: 'resumed-container',
      actualMachineId: 'us-mac-m4',
      executionTransport: 'local-docker',
      remoteJobId: null,
      attestationStatus: 'local',
    });
    mocks.recordLaunchReceipt.mockResolvedValue({ id: 'attempt-child' });
  });

  it('轮换 hash 后只把新明文交给恢复容器', async () => {
    const child = {
      id: 'attempt-child',
      run_id: 'run-1',
      provider: 'codex',
      task_bundle: { inputs: {} },
      updated_at: '2026-07-22T01:02:03.000Z',
      lease_owner: 'watchdog:test',
      lease_generation: 1,
    };
    const originalParentAttempt = {
      id: 'attempt-parent',
      run_id: 'run-1',
      provider: 'codex',
      account_id: 'team1',
      requested_machine_id: 'us-mac-m4',
      provider_session_id: 'thread-1',
      task_bundle: { inputs: {} },
      lease_owner: 'dispatcher:old',
      lease_generation: 0,
    };
    const reclaimedParentAttempt = {
      ...originalParentAttempt,
      lease_owner: 'watchdog:test',
      lease_generation: 1,
    };
    const launcher = {
      inspect: mocks.inspect,
      cancel: mocks.cancel,
      launch: mocks.launch,
    };
    const attemptStore = {
      recordLaunchReceipt: mocks.recordLaunchReceipt,
      fail: vi.fn(),
    };

    const result = await resumeKernelAttempt(child, {
      originalParentAttempt,
      reclaimedParentAttempt,
      task: { payload: {} },
      dbPool: { query: vi.fn() },
      callbackSecret: 'rotated-raw-secret',
      leaseOwner: 'watchdog:test',
      attemptStore,
      launcher,
    });

    expect(result).toMatchObject({ ok: true, resumed: true });
    expect(mocks.adapter.resume).toHaveBeenCalledWith(expect.objectContaining({
      attempt: expect.objectContaining({
        id: 'attempt-parent',
        provider_session_id: 'thread-1',
      }),
    }));
    expect(mocks.inspect).toHaveBeenCalledWith(expect.objectContaining({
      attempt: originalParentAttempt,
    }));
    expect(mocks.cancel).toHaveBeenCalledWith(expect.objectContaining({
      attempt: originalParentAttempt,
    }));
    expect(mocks.cancel.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.launch.mock.invocationCallOrder[0]);
    expect(mocks.launch).toHaveBeenCalledWith(expect.objectContaining({
      attempt: expect.objectContaining({
        id: 'attempt-child',
        callbackSecret: 'rotated-raw-secret',
        lease_owner: 'watchdog:test',
        lease_generation: 1,
      }),
      leaseClaimed: true,
    }));
    expect(mocks.recordLaunchReceipt).toHaveBeenCalledWith(
      'attempt-child',
      expect.objectContaining({
        leaseOwner: 'watchdog:test',
        leaseGeneration: 1,
      }),
    );
  });

  it('旧 attempt 容器无法确认清除时不启动恢复容器', async () => {
    mocks.cancel.mockResolvedValueOnce({ status: 'conflict' });
    const originalParentAttempt = {
      id: 'attempt-parent',
      run_id: 'run-1',
      provider: 'codex',
      requested_machine_id: 'us-mac-m4',
      provider_session_id: 'thread-1',
      task_bundle: { inputs: {} },
      lease_owner: 'dispatcher:old',
      lease_generation: 0,
    };
    const result = await resumeKernelAttempt({
      id: 'attempt-child',
      run_id: 'run-1',
      provider: 'codex',
      task_bundle: { inputs: {} },
      lease_owner: 'watchdog:test',
      lease_generation: 1,
    }, {
      originalParentAttempt,
      reclaimedParentAttempt: {
        ...originalParentAttempt,
        lease_owner: 'watchdog:test',
        lease_generation: 1,
      },
      task: { payload: {} },
      dbPool: { query: vi.fn() },
      callbackSecret: 'rotated-raw-secret',
      leaseOwner: 'watchdog:test',
      attemptStore: {
        recordLaunchReceipt: mocks.recordLaunchReceipt,
        fail: vi.fn(),
      },
      launcher: {
        inspect: mocks.inspect,
        cancel: mocks.cancel,
        launch: mocks.launch,
      },
    });

    expect(result).toMatchObject({
      ok: false,
      failure_code: 'resume_parent_cleanup_unconfirmed',
      cleanup_status: 'conflict',
    });
    expect(mocks.inspect).toHaveBeenCalledOnce();
    expect(mocks.cancel).toHaveBeenCalledOnce();
    expect(mocks.launch).not.toHaveBeenCalled();
    expect(mocks.recordLaunchReceipt).not.toHaveBeenCalled();
  });
});
