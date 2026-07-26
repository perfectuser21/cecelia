import { describe, expect, it, vi } from 'vitest';

import {
  reconcileExpiredKernelAttempt,
  resumeKernelAttempt,
} from '../harness-relay-watchdog.js';
import { signMachineAttestation } from '../orchestrator/machine-attestation.js';

const PARENT_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '33333333-3333-4333-8333-333333333333';
const SECRET = 'watchdog-fleet-secret-at-least-32-bytes';
const CALLBACK_TOKEN = 'watchdog-child-callback-token';
const BRIDGE_URL = 'http://xian-m4.internal:3458';

function response(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function bundle() {
  return {
    contract_version: '1.0',
    run_id: RUN_ID,
    attempt_id: CHILD_ID,
    hop: 8,
    phase: 'evaluate',
    role: 'evaluator',
    objective: 'Continue the durable evaluator checkpoint.',
    inputs: {
      task_id: 'task-1',
      sprint_dir: 'sprints/watchdog-fleet',
      worktree_path: '/workspace',
      artifacts: [],
    },
    constraints: {
      read_only: true,
      fresh_session: false,
      timeout_seconds: 300,
    },
    expected_output: 'harness-result/evaluator-v1',
  };
}

function parentAttempt() {
  return {
    id: PARENT_ID,
    run_id: RUN_ID,
    hop: 7,
    phase: 'evaluate',
    role: 'evaluator',
    provider: 'codex',
    account_id: 'team3',
    machine_id: 'xian-mac-m4',
    requested_machine_id: 'xian-mac-m4',
    provider_session_id: 'thread-parent',
    remote_job_id: 'parent-job',
    execution_transport: 'remote-bridge',
    task_bundle: bundle(),
    status: 'running',
    lease_owner: 'dispatcher-parent',
    lease_generation: 3,
    lease_expires_at: new Date(Date.now() - 60_000).toISOString(),
    logical_cycle_id: `intent:${RUN_ID}:7`,
    workstream_key: 'ws1',
  };
}

function childAttempt() {
  return {
    id: CHILD_ID,
    run_id: RUN_ID,
    hop: 8,
    phase: 'evaluate',
    role: 'evaluator',
    provider: 'codex',
    account_id: 'team3',
    machine_id: 'xian-mac-m4',
    requested_machine_id: 'xian-mac-m4',
    task_bundle: bundle(),
    status: 'starting',
    lease_owner: 'watchdog:test',
    lease_generation: 0,
  };
}

function remoteEnv(overrides = {}) {
  return {
    KERNEL_FLEET_REMOTE_ENABLED: 'true',
    XIAN_M4_KERNEL_BRIDGE_URL: BRIDGE_URL,
    KERNEL_FLEET_BRIDGE_TOKEN: SECRET,
    KERNEL_FLEET_REMOTE_CALLBACK_BASE_URL: 'https://brain.public.example',
    ...overrides,
  };
}

function resumeStore(receiptResult = { id: CHILD_ID, status: 'starting' }) {
  return {
    recordLaunchReceipt: vi.fn(async () => receiptResult),
    fail: vi.fn(async () => ({ deduped: false })),
  };
}

function resumeOptions(overrides = {}) {
  return {
    originalParentAttempt: parentAttempt(),
    reclaimedParentAttempt: {
      ...parentAttempt(),
      lease_owner: 'watchdog:test',
      lease_generation: 4,
    },
    task: { id: 'task-1', payload: {} },
    dbPool: { query: vi.fn() },
    callbackSecret: CALLBACK_TOKEN,
    leaseOwner: 'watchdog:test',
    attemptStore: resumeStore(),
    env: remoteEnv(),
    fetchFn: vi.fn(),
    spawnDetached: vi.fn(),
    removeContainer: vi.fn(),
    ...overrides,
  };
}

describe('kernel fleet watchdog recovery', () => {
  it('resumes a xian parent through inspect/cancel/launch and persists the child receipt', async () => {
    const child = childAttempt();
    const store = resumeStore();
    const spawnDetached = vi.fn();
    const removeContainer = vi.fn();
    const fetchFn = vi.fn(async (url, init) => {
      if (url === `${BRIDGE_URL}/harness/attempts/${PARENT_ID}`) {
        return response(200, { status: 'running', job_id: 'parent-job' });
      }
      if (url === `${BRIDGE_URL}/harness/attempts/${PARENT_ID}/cancel`) {
        return response(200, { status: 'cancelled', job_id: 'parent-job' });
      }
      if (url === `${BRIDGE_URL}/harness/attempts`) {
        return response(202, {
          status: 'accepted',
          job_id: 'child-job',
          actual_machine_id: 'xian-mac-m4',
          attestation: signMachineAttestation({
            secret: SECRET,
            attemptId: CHILD_ID,
            machineId: 'xian-mac-m4',
            jobId: 'child-job',
          }),
        });
      }
      throw new Error(`unexpected request ${init?.method} ${url}`);
    });

    await expect(resumeKernelAttempt(child, resumeOptions({
      attemptStore: store,
      fetchFn,
      spawnDetached,
      removeContainer,
    }))).resolves.toMatchObject({
      ok: true,
      resumed: true,
      remoteJobId: 'child-job',
      executionTransport: 'remote-bridge',
    });

    expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([
      `${BRIDGE_URL}/harness/attempts/${PARENT_ID}`,
      `${BRIDGE_URL}/harness/attempts/${PARENT_ID}/cancel`,
      `${BRIDGE_URL}/harness/attempts`,
    ]);
    expect(JSON.parse(fetchFn.mock.calls[1][1].body)).toEqual({
      lease_owner: 'dispatcher-parent',
      lease_generation: 3,
    });
    expect(JSON.parse(fetchFn.mock.calls[2][1].body)).toMatchObject({
      attempt_id: CHILD_ID,
      lease_owner: 'watchdog:test',
      lease_generation: 0,
      target: {
        provider: 'codex',
        account: 'team3',
        machine: 'xian-mac-m4',
      },
      callback_url: `https://brain.public.example/api/brain/harness/attempts/${CHILD_ID}/callback`,
    });
    expect(store.recordLaunchReceipt).toHaveBeenCalledWith(CHILD_ID, {
      leaseOwner: 'watchdog:test',
      leaseGeneration: 0,
      actualMachineId: 'xian-mac-m4',
      executionTransport: 'remote-bridge',
      remoteJobId: 'child-job',
      attestationStatus: 'verified',
    });
    expect(spawnDetached).not.toHaveBeenCalled();
    expect(removeContainer).not.toHaveBeenCalled();
  });

  it('cleans a local parent by its exact persisted generation before launching the child generation', async () => {
    const originalParentAttempt = {
      ...parentAttempt(),
      machine_id: 'us-mac-m4',
      requested_machine_id: 'us-mac-m4',
      remote_job_id: null,
      execution_transport: 'local-docker',
      lease_generation: 2,
    };
    const reclaimedParentAttempt = {
      ...originalParentAttempt,
      lease_owner: 'watchdog:test',
      lease_generation: 3,
    };
    const child = {
      ...childAttempt(),
      machine_id: 'us-mac-m4',
      requested_machine_id: 'us-mac-m4',
    };
    const removeContainer = vi.fn(async () => true);
    const spawnDetached = vi.fn(async ({ containerId }) => ({ containerId }));
    const store = resumeStore();

    await expect(resumeKernelAttempt(child, resumeOptions({
      originalParentAttempt,
      reclaimedParentAttempt,
      attemptStore: store,
      env: {},
      spawnDetached,
      removeContainer,
    }))).resolves.toMatchObject({
      ok: true,
      executionTransport: 'local-docker',
      containerId: 'cecelia-harness-22222222-g0',
    });

    expect(removeContainer.mock.calls.map(([containerId]) => containerId)).toEqual([
      'cecelia-harness-11111111-g2',
      'cecelia-harness-22222222-g0',
    ]);
    expect(removeContainer.mock.calls.flat()).not.toContain('cecelia-harness-11111111');
    expect(removeContainer.mock.calls.flat()).not.toContain('cecelia-harness-11111111-g3');
  });

  it('fails closed before cleanup or launch when remote callback config is absent', async () => {
    const fetchFn = vi.fn();
    const store = resumeStore();

    await expect(resumeKernelAttempt(childAttempt(), resumeOptions({
      attemptStore: store,
      env: remoteEnv({ KERNEL_FLEET_REMOTE_CALLBACK_BASE_URL: undefined }),
      fetchFn,
    }))).resolves.toMatchObject({
      ok: false,
      failure_code: 'resume_parent_cleanup_unconfirmed',
      error: 'execution_transport_unavailable:xian-mac-m4',
    });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(store.recordLaunchReceipt).not.toHaveBeenCalled();
  });

  it('blocks child launch when remote parent cleanup returns missing', async () => {
    const store = resumeStore();
    const fetchFn = vi.fn(async (url) => {
      if (url === `${BRIDGE_URL}/harness/attempts/${PARENT_ID}`) {
        return response(200, { status: 'running' });
      }
      if (url === `${BRIDGE_URL}/harness/attempts/${PARENT_ID}/cancel`) {
        return response(404, { status: 'missing' });
      }
      throw new Error(`child launch must not occur: ${url}`);
    });

    await expect(resumeKernelAttempt(childAttempt(), resumeOptions({
      attemptStore: store,
      fetchFn,
    }))).resolves.toMatchObject({
      ok: false,
      failure_code: 'resume_parent_cleanup_unconfirmed',
      cleanup_status: 'missing',
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(store.recordLaunchReceipt).not.toHaveBeenCalled();
  });

  it('cancels and exact-fails the child when its launch receipt cannot be persisted', async () => {
    const store = resumeStore(null);
    const fetchFn = vi.fn(async (url) => {
      if (url === `${BRIDGE_URL}/harness/attempts/${PARENT_ID}`) {
        return response(200, { status: 'running' });
      }
      if (url === `${BRIDGE_URL}/harness/attempts/${PARENT_ID}/cancel`) {
        return response(200, { status: 'cancelled' });
      }
      if (url === `${BRIDGE_URL}/harness/attempts`) {
        return response(202, {
          status: 'accepted',
          job_id: 'child-job',
          actual_machine_id: 'xian-mac-m4',
          attestation: signMachineAttestation({
            secret: SECRET,
            attemptId: CHILD_ID,
            machineId: 'xian-mac-m4',
            jobId: 'child-job',
          }),
        });
      }
      if (url === `${BRIDGE_URL}/harness/attempts/${CHILD_ID}/cancel`) {
        return response(200, { status: 'cancelled', job_id: 'child-job' });
      }
      throw new Error(`unexpected request ${url}`);
    });

    await expect(resumeKernelAttempt(childAttempt(), resumeOptions({
      attemptStore: store,
      fetchFn,
    }))).resolves.toMatchObject({
      ok: false,
      failure_code: 'resume_receipt_persist_failed',
      cleanup_status: 'cancelled',
    });

    expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([
      `${BRIDGE_URL}/harness/attempts/${PARENT_ID}`,
      `${BRIDGE_URL}/harness/attempts/${PARENT_ID}/cancel`,
      `${BRIDGE_URL}/harness/attempts`,
      `${BRIDGE_URL}/harness/attempts/${CHILD_ID}/cancel`,
    ]);
    expect(store.fail).toHaveBeenCalledWith(CHILD_ID, {
      code: 'resume_receipt_persist_failed',
      message: expect.stringContaining('launch receipt was not persisted'),
    }, {
      leaseOwner: 'watchdog:test',
      leaseGeneration: 0,
    });
  });

  it('passes immutable original and reclaimed parent claims and exact-fails both generations', async () => {
    const original = parentAttempt();
    const reclaimed = {
      ...original,
      lease_owner: 'watchdog:test',
      lease_generation: 4,
    };
    const child = {
      ...childAttempt(),
      status: 'queued',
      lease_owner: null,
    };
    const store = {
      getById: vi.fn(async () => original),
      reclaim: vi.fn(async () => reclaimed),
      rotateCallbackSecret: vi.fn(async () => reclaimed),
      createAttempt: vi.fn(async () => child),
      markStarting: vi.fn(async () => childAttempt()),
      fail: vi.fn(async () => ({ attempt: {}, deduped: false })),
    };
    const resumeAttempt = vi.fn(async () => ({
      ok: false,
      failure_code: 'resume_parent_cleanup_unconfirmed',
    }));

    await reconcileExpiredKernelAttempt({
      db: { query: vi.fn() },
      attemptStore: store,
      attemptId: PARENT_ID,
      leaseOwner: 'watchdog:test',
      resumeAttempt,
      reservedChildHop: 8,
      randomUUIDFn: () => CHILD_ID,
    });

    expect(store.markStarting).toHaveBeenCalledTimes(1);
    expect(resumeAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        id: CHILD_ID,
        lease_owner: 'watchdog:test',
        lease_generation: 0,
      }),
      expect.objectContaining({
        originalParentAttempt: original,
        reclaimedParentAttempt: reclaimed,
      }),
    );
    expect(store.fail).toHaveBeenCalledWith(CHILD_ID, expect.any(Object), {
      leaseOwner: 'watchdog:test',
      leaseGeneration: 0,
    });
    expect(store.fail).toHaveBeenCalledWith(PARENT_ID, expect.any(Object), {
      leaseOwner: 'watchdog:test',
      leaseGeneration: 4,
    });
  });
});
