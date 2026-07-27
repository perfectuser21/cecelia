import { describe, expect, it, vi } from 'vitest';

import { signMachineAttestation } from './machine-attestation.js';
import {
  createProductionExecutionTransport,
  DEFAULT_LOCAL_MACHINE_ID,
} from './production-transport.js';

const CALLBACK_URL = 'http://brain.internal:5221';
const SHARED_SECRET = 'fleet-worker-secret-at-least-32-bytes';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const BASE_SHA = '0123456789abcdef0123456789abcdef01234567';
const ENVELOPE = Object.freeze({
  contract_version: 'credential-envelope/v1',
  credential_ref: '33333333-3333-4333-8333-333333333333',
  attempt_id: ATTEMPT_ID,
  account_id: 'team1',
  machine_id: 'us-mac-m4',
  issued_at: '2026-07-27T12:00:00.000Z',
  expires_at: '2026-07-27T14:00:00.000Z',
  payload_hash: `sha256:${'a'.repeat(64)}`,
  payload: 'eyJ0b2tlbnMiOnsiYWNjZXNzX3Rva2VuIjoic2VjcmV0In19',
});
const MACHINE_URLS = {
  'us-mac-m4': 'http://us-worker.internal:5231',
  'xian-mac-m4': 'http://xian-m4-worker.internal:5231',
  'xian-mac-m1': 'http://xian-m1-worker.internal:5231',
};

function configuredEnv(overrides = {}) {
  return {
    KERNEL_FLEET_REMOTE_ENABLED: 'true',
    KERNEL_FLEET_BRIDGE_TOKEN: SHARED_SECRET,
    KERNEL_FLEET_REMOTE_CALLBACK_BASE_URL: CALLBACK_URL,
    FLEET_WORKER_US_MAC_M4_URL: MACHINE_URLS['us-mac-m4'],
    FLEET_WORKER_XIAN_MAC_M4_URL: MACHINE_URLS['xian-mac-m4'],
    FLEET_WORKER_XIAN_MAC_M1_URL: MACHINE_URLS['xian-mac-m1'],
    ...overrides,
  };
}

function launchInput(machine) {
  return {
    attempt: {
      id: ATTEMPT_ID,
      run_id: RUN_ID,
      role: 'generator',
      callbackSecret: 'local-callback-token',
      lease_owner: 'dispatcher-local',
      lease_generation: 0,
    },
    bundle: {
      inputs: {
        task_id: 'task-local',
        execution_surface: 'fleet-worker',
        workspace_spec: {
          repo: 'perfectuser21/cecelia',
          base_sha: BASE_SHA,
          branch: 'cp-07272050-unified-worker',
          expected_head_sha: null,
          mode: 'read-write',
          run_id: RUN_ID,
          attempt_id: ATTEMPT_ID,
        },
      },
      constraints: { read_only: false, timeout_seconds: 3600 },
    },
    spec: {
      provider: 'codex',
      command: 'codex',
      args: ['exec', '--json'],
      stdin: 'run through the selected Fleet Worker',
      output: { format: 'jsonl' },
      cwd: '/Users/operator/must-not-cross-machines',
      environment: { MUST_NOT: 'cross the Worker boundary' },
    },
    task: { id: 'task-local' },
    target: {
      provider: 'codex',
      account: 'team1',
      model: 'gpt-5',
      machine,
    },
    leaseClaimed: true,
  };
}

function acceptedResponse(machine) {
  const jobId = `container-${machine}`;
  return {
    ok: true,
    status: 202,
    json: vi.fn(async () => ({
      status: 'accepted',
      job_id: jobId,
      actual_machine_id: machine,
      attestation: signMachineAttestation({
        secret: SHARED_SECRET,
        attemptId: ATTEMPT_ID,
        machineId: machine,
        jobId,
      }),
    })),
  };
}

describe('production execution transport', () => {
  it.each(Object.keys(MACHINE_URLS))(
    'fails closed for %s when unified Worker execution is not configured',
    async (machine) => {
      const fetchFn = vi.fn();
      const spawnDetached = vi.fn();
      const transport = createProductionExecutionTransport({
        fetchFn,
        spawnDetached,
      });

      await expect(transport.launch(launchInput(machine))).rejects.toThrow(
        `execution_transport_unavailable:${machine}`,
      );
      expect(fetchFn).not.toHaveBeenCalled();
      expect(spawnDetached).not.toHaveBeenCalled();
    },
  );

  it.each(Object.entries(MACHINE_URLS))(
    'routes %s through its server-owned Fleet Worker URL',
    async (machine, workerUrl) => {
      const fetchFn = vi.fn(async () => acceptedResponse(machine));
      const spawnDetached = vi.fn();
      const transport = createProductionExecutionTransport({
        env: configuredEnv(),
        fetchFn,
        spawnDetached,
        credentialBroker: {
          issue: vi.fn(async ({ machineId }) => ({
            ...ENVELOPE,
            machine_id: machineId,
          })),
        },
      });

      await expect(transport.launch(launchInput(machine))).resolves.toEqual({
        jobId: `container-${machine}`,
        actualMachineId: machine,
        executionTransport: 'fleet-worker',
        remoteJobId: `container-${machine}`,
        attestationStatus: 'verified',
      });
      expect(fetchFn).toHaveBeenCalledOnce();
      expect(fetchFn.mock.calls[0][0]).toBe(`${workerUrl}/harness/attempts`);
      const body = JSON.parse(fetchFn.mock.calls[0][1].body);
      expect(body.workspace_spec).toEqual(
        launchInput(machine).bundle.inputs.workspace_spec,
      );
      expect(body.credential_envelope).toEqual({
        ...ENVELOPE,
        machine_id: machine,
      });
      expect(JSON.stringify(body)).not.toMatch(
        /worktree_path|workspace_path|\/Users\/operator/,
      );
      expect(spawnDetached).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['missing US URL', { FLEET_WORKER_US_MAC_M4_URL: undefined }, DEFAULT_LOCAL_MACHINE_ID],
    ['missing Xian URL', { FLEET_WORKER_XIAN_MAC_M4_URL: undefined }, 'xian-mac-m4'],
    ['missing shared secret', { KERNEL_FLEET_BRIDGE_TOKEN: undefined }, DEFAULT_LOCAL_MACHINE_ID],
    ['missing callback URL', {
      KERNEL_FLEET_REMOTE_CALLBACK_BASE_URL: undefined,
    }, DEFAULT_LOCAL_MACHINE_ID],
  ])('fails closed for %s without contacting any Worker', async (
    _case,
    overrides,
    machine,
  ) => {
    const fetchFn = vi.fn();
    const spawnDetached = vi.fn();
    const transport = createProductionExecutionTransport({
      env: configuredEnv(overrides),
      fetchFn,
      spawnDetached,
    });

    await expect(transport.launch(launchInput(machine))).rejects.toThrow(
      `execution_transport_unavailable:${machine}`,
    );
    expect(fetchFn).not.toHaveBeenCalled();
    expect(spawnDetached).not.toHaveBeenCalled();
  });

  it('fails closed without a credential broker for configured Codex execution', async () => {
    const fetchFn = vi.fn();
    const transport = createProductionExecutionTransport({
      env: configuredEnv(),
      fetchFn,
    });

    await expect(transport.launch(launchInput(DEFAULT_LOCAL_MACHINE_ID))).rejects.toThrow(
      'remote_bridge_credential_broker_unavailable',
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
