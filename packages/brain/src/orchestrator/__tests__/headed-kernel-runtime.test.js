import { describe, expect, it, vi } from 'vitest';

import { spawnHeadedKernelRuntime } from '../headed-kernel-runtime.js';

const TASK = Object.freeze({
  id: '11111111-1111-4111-8111-111111111111',
  ability_id: null,
  payload: { repo: 'cecelia', journey_id: null },
});

function authorityRun(overrides = {}) {
  return {
    created: true,
    run: {
      id: '22222222-2222-4222-8222-222222222222',
      controller_session_id: '33333333-3333-4333-8333-333333333333',
      controller_generation: 4,
    },
    ...overrides,
  };
}

describe('spawnHeadedKernelRuntime', () => {
  it('passes the server-issued Controller authority to the headed session', async () => {
    const createKernelRun = vi.fn(async () => authorityRun());
    const spawnSession = vi.fn(async ({ runId, controllerSessionId, controllerGeneration }) => ({
      ok: true,
      runId,
      controllerSessionId,
      controllerGeneration,
    }));

    const result = await spawnHeadedKernelRuntime({
      task: TASK,
      dbPool: {},
      initiativeId: TASK.id,
      deps: { createKernelRun },
      gear: 'default',
      spawnSession,
    });

    expect(createKernelRun).toHaveBeenCalledWith({}, expect.objectContaining({
      taskId: TASK.id,
      initiativeId: TASK.id,
      createdSource: 'kernel_dispatch',
    }));
    expect(spawnSession).toHaveBeenCalledWith(expect.objectContaining({
      runId: '22222222-2222-4222-8222-222222222222',
      controllerSessionId: '33333333-3333-4333-8333-333333333333',
      controllerGeneration: 4,
    }));
    expect(result).toMatchObject({ ok: true, controllerGeneration: 4 });
  });

  it('does not launch a second headed session when the Kernel run already exists', async () => {
    const spawnSession = vi.fn();
    const result = await spawnHeadedKernelRuntime({
      task: TASK,
      dbPool: {},
      initiativeId: TASK.id,
      deps: { createKernelRun: vi.fn(async () => authorityRun({ created: false })) },
      gear: 'default',
      spawnSession,
    });

    expect(result).toMatchObject({
      ok: false,
      deferred: true,
      reason: 'kernel_run_exists',
    });
    expect(spawnSession).not.toHaveBeenCalled();
  });

  it('terminalizes a failed headed launch through the shared run finalizer', async () => {
    const finalizeRun = vi.fn(async () => ({ finalized: true }));
    const result = await spawnHeadedKernelRuntime({
      task: TASK,
      dbPool: {},
      initiativeId: TASK.id,
      deps: {
        createKernelRun: vi.fn(async () => authorityRun()),
        finalizeRun,
      },
      gear: 'default',
      spawnSession: vi.fn(async () => ({ ok: false, error: 'tmux_unavailable' })),
    });

    expect(finalizeRun).toHaveBeenCalledWith({}, {
      runId: '22222222-2222-4222-8222-222222222222',
      expectedTaskId: TASK.id,
      outcome: 'failed',
      reason: 'headed_kernel_launch_failed:tmux_unavailable',
    });
    expect(result).toMatchObject({
      ok: false,
      terminalized: true,
      error: 'tmux_unavailable',
    });
  });
});
