import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  reclaim: vi.fn(),
  rotateCallbackSecret: vi.fn(),
  killAttemptContainers: vi.fn(),
  launch: vi.fn(),
  adapter: { name: 'codex', resume: vi.fn() },
}));

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../notifier.js', () => ({ sendBark: vi.fn() }));
vi.mock('../orchestrator/attempt-store.js', () => ({
  createAttemptStore: () => ({
    reclaim: mocks.reclaim,
    rotateCallbackSecret: mocks.rotateCallbackSecret,
  }),
}));
vi.mock('../orchestrator/provider-registry.js', () => ({
  createProviderRegistry: () => ({ resolve: () => mocks.adapter }),
}));
vi.mock('../orchestrator/providers/claude.js', () => ({ claudeAdapter: {} }));
vi.mock('../orchestrator/providers/codex.js', () => ({ codexAdapter: {} }));
vi.mock('../orchestrator/dispatcher.js', () => ({
  createDetachedLauncher: () => ({ launch: mocks.launch }),
  resolveProviderAccountHome: vi.fn(),
}));
vi.mock('../spawn/detached.js', () => ({
  spawnDockerDetached: vi.fn(),
  removeDockerContainer: vi.fn(),
}));
vi.mock('../orchestrator/callback-auth.js', () => ({
  generateCallbackSecret: () => 'rotated-raw-secret',
  hashCallbackSecret: (value) => `hash:${value}`,
}));
vi.mock('../harness-container-cleanup.js', () => ({
  killAttemptContainers: mocks.killAttemptContainers,
}));

import { resumeKernelAttempt } from '../harness-relay-watchdog.js';

describe('resumeKernelAttempt callback fencing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reclaim.mockResolvedValue({
      id: 'attempt-1',
      updated_at: '2026-07-22T01:02:03.000Z',
    });
    mocks.rotateCallbackSecret.mockResolvedValue({ id: 'attempt-1' });
    mocks.killAttemptContainers.mockResolvedValue({ ok: true, matched: 1, killed: 1 });
    mocks.adapter.resume.mockReturnValue({ provider: 'codex', args: ['exec', 'resume', 'thread-1'], env: {} });
    mocks.launch.mockResolvedValue({ containerId: 'resumed-container' });
  });

  it('轮换 hash 后只把新明文交给恢复容器', async () => {
    const attempt = {
      id: 'attempt-1',
      run_id: 'run-1',
      provider: 'codex',
      provider_session_id: 'thread-1',
      task_bundle: { inputs: {} },
    };

    await resumeKernelAttempt(attempt, {
      task: { payload: {} },
      dbPool: { query: vi.fn() },
    });

    expect(mocks.rotateCallbackSecret).toHaveBeenCalledWith('attempt-1', {
      leaseOwner: expect.stringMatching(/^watchdog:/),
      callbackSecretHash: 'hash:rotated-raw-secret',
    });
    expect(mocks.killAttemptContainers).toHaveBeenCalledWith('attempt-1');
    expect(mocks.killAttemptContainers.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.launch.mock.invocationCallOrder[0]);
    expect(mocks.launch).toHaveBeenCalledWith(expect.objectContaining({
      attempt: expect.objectContaining({ callbackSecret: 'rotated-raw-secret' }),
      generation: new Date('2026-07-22T01:02:03.000Z').getTime(),
    }));
  });

  it('旧 attempt 容器无法确认清除时不启动恢复容器', async () => {
    mocks.killAttemptContainers.mockResolvedValueOnce({ ok: false, matched: 1, killed: 0 });
    const result = await resumeKernelAttempt({
      id: 'attempt-1',
      run_id: 'run-1',
      provider: 'codex',
      provider_session_id: 'thread-1',
      task_bundle: { inputs: {} },
    }, {
      task: { payload: {} },
      dbPool: { query: vi.fn() },
    });

    expect(result).toMatchObject({ ok: false, reason: 'attempt_container_cleanup_failed' });
    expect(mocks.launch).not.toHaveBeenCalled();
  });
});
