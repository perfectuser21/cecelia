import { describe, expect, it, vi } from 'vitest';

import {
  createProductionExecutionTransport,
  DEFAULT_LOCAL_MACHINE_ID,
} from './production-transport.js';

const REMOTE_MACHINE = 'xian-mac-m4';
const REMOTE_URL = 'http://100.86.57.69:3458';
const CALLBACK_URL = 'http://brain.internal:5221';
const SHARED_SECRET = 'fleet-bridge-secret-at-least-32-bytes';

function remoteInput() {
  return {
    attempt: { id: 'attempt-remote' },
    target: { machine: REMOTE_MACHINE },
  };
}

describe('production execution transport', () => {
  it('keeps remote execution disabled by default and fails closed before fetch', async () => {
    const fetchFn = vi.fn();
    const spawnDetached = vi.fn();
    const transport = createProductionExecutionTransport({ fetchFn, spawnDetached });

    await expect(transport.launch(remoteInput())).rejects.toThrow(
      `execution_transport_unavailable:${REMOTE_MACHINE}`,
    );
    expect(fetchFn).not.toHaveBeenCalled();
    expect(spawnDetached).not.toHaveBeenCalled();
  });

  it('routes a valid local launch without remote configuration', async () => {
    const attempt = {
      id: '12345678-0000-4000-8000-000000000000',
      run_id: 'run-local',
      hop: 1,
      role: 'generator',
      callbackSecret: 'local-callback-token',
      lease_owner: 'dispatcher-local',
      lease_generation: 0,
    };
    const containerId = 'cecelia-harness-12345678-g0';
    const spawnDetached = vi.fn(async () => ({ containerId }));
    const transport = createProductionExecutionTransport({ spawnDetached });

    await expect(transport.launch({
      attempt,
      bundle: {
        inputs: { task_id: 'task-local', worktree_path: '/tmp/kernel-local' },
        constraints: { read_only: false },
      },
      spec: { provider: 'codex', env: {}, args: [], stdin: 'run locally' },
      task: { id: 'task-local' },
      target: { machine: DEFAULT_LOCAL_MACHINE_ID },
      leaseClaimed: true,
    })).resolves.toEqual({
      actualMachineId: DEFAULT_LOCAL_MACHINE_ID,
      executionTransport: 'local-docker',
      remoteJobId: null,
      attestationStatus: 'local',
      containerId,
      jobId: null,
    });
    expect(spawnDetached).toHaveBeenCalledOnce();
  });

  it.each([
    ['missing xian URL', {
      KERNEL_FLEET_REMOTE_ENABLED: 'true',
      KERNEL_FLEET_BRIDGE_TOKEN: SHARED_SECRET,
      KERNEL_FLEET_REMOTE_CALLBACK_BASE_URL: CALLBACK_URL,
    }],
    ['missing shared secret', {
      KERNEL_FLEET_REMOTE_ENABLED: 'true',
      XIAN_M4_KERNEL_BRIDGE_URL: REMOTE_URL,
      KERNEL_FLEET_REMOTE_CALLBACK_BASE_URL: CALLBACK_URL,
    }],
  ])('fails closed for %s without contacting a bridge', async (_case, env) => {
    const fetchFn = vi.fn();
    const transport = createProductionExecutionTransport({ env, fetchFn });

    await expect(transport.launch(remoteInput())).rejects.toThrow(
      `execution_transport_unavailable:${REMOTE_MACHINE}`,
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
