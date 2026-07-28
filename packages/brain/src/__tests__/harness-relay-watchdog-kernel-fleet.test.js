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
const PR_HEAD_SHA = 'b'.repeat(40);
const PR_URL = 'https://github.com/perfectuser21/cecelia/pull/4380';

function testCredentialPayload() {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
  })).toString('base64url');
  return JSON.stringify({
    tokens: {
      access_token: `${header}.${claims}.test-signature`,
    },
  });
}

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
      execution_surface: 'fleet-worker',
      workspace_spec: {
        repo: 'perfectuser21/cecelia',
        base_sha: '0123456789abcdef0123456789abcdef01234567',
        branch: 'cp-watchdog-fleet',
        expected_head_sha: PR_HEAD_SHA,
        mode: 'read-only',
        run_id: RUN_ID,
        attempt_id: CHILD_ID,
      },
      pull_request: {
        type: 'pull_request',
        url: PR_URL,
        number: 4380,
        head_ref: 'cp-watchdog-fleet',
        head_sha: PR_HEAD_SHA,
        state: 'OPEN',
      },
      github_read_policy: {
        version: 'github-read/v1',
        repo: 'perfectuser21/cecelia',
        url: PR_URL,
        number: 4380,
        head_ref: 'cp-watchdog-fleet',
        head_sha: PR_HEAD_SHA,
        allowed_states: ['OPEN'],
      },
    },
    constraints: {
      read_only: true,
      fresh_session: false,
      timeout_seconds: 300,
    },
    expected_output: 'harness-result/evaluator-v1',
    result_channel: {
      version: 'attempt-result-file/v1',
      path: `/tmp/cecelia-prompts/${CHILD_ID}.result.json`,
      max_bytes: 1024 * 1024,
      bindings: {
        task_id: 'task-1',
        run_id: RUN_ID,
        attempt_id: CHILD_ID,
        role: 'evaluator',
      },
    },
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
    local_container_naming: 'generation-v1',
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
    local_container_naming: 'generation-v1',
  };
}

function remoteEnv(overrides = {}) {
  return {
    KERNEL_FLEET_REMOTE_ENABLED: 'true',
    FLEET_WORKER_US_MAC_M4_URL: BRIDGE_URL,
    FLEET_WORKER_XIAN_MAC_M4_URL: BRIDGE_URL,
    FLEET_WORKER_XIAN_MAC_M1_URL: BRIDGE_URL,
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
    loadCredential: vi.fn(async () => testCredentialPayload()),
    fetchFn: vi.fn(),
    spawnDetached: vi.fn(),
    removeContainer: vi.fn(),
    onRecoveryAlert: vi.fn(async () => {}),
    ...overrides,
  };
}

function successfulWorkerFetch(machineId = 'us-mac-m4') {
  return vi.fn(async (url, init) => {
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
        actual_machine_id: machineId,
        attestation: signMachineAttestation({
          secret: SECRET,
          attemptId: CHILD_ID,
          machineId,
          jobId: 'child-job',
        }),
      });
    }
    throw new Error(`unexpected request ${init?.method} ${url}`);
  });
}

describe('kernel fleet watchdog recovery', () => {
  it('resumes on the receipt-proven actual machine instead of the requested fallback origin', async () => {
    const originalParentAttempt = {
      ...parentAttempt(),
      requested_machine_id: 'xian-mac-m4',
      actual_machine_id: 'xian-mac-m1',
    };
    const fetchFn = successfulWorkerFetch('xian-mac-m1');
    const loadCredential = vi.fn(async () => testCredentialPayload());

    await expect(resumeKernelAttempt({
      ...childAttempt(),
      machine_id: 'xian-mac-m1',
      requested_machine_id: 'xian-mac-m1',
    }, resumeOptions({
      originalParentAttempt,
      reclaimedParentAttempt: {
        ...originalParentAttempt,
        lease_owner: 'watchdog:test',
        lease_generation: 4,
      },
      fetchFn,
      loadCredential,
    }))).resolves.toMatchObject({ ok: true, resumed: true });

    const launchBodyText = fetchFn.mock.calls[2][1].body;
    const launchBody = JSON.parse(launchBodyText);
    expect(launchBody).toMatchObject({
      target: {
        provider: 'codex',
        account: 'team3',
        machine: 'xian-mac-m1',
      },
      credential_envelope: {
        contract_version: 'provider-credential-envelope/v2',
        attempt_id: CHILD_ID,
        run_id: RUN_ID,
        provider: 'codex',
        account_id: 'team3',
        machine_id: 'xian-mac-m1',
        lease_owner: 'watchdog:test',
        lease_generation: 0,
        signature: expect.stringMatching(/^hmac-sha256:[a-f0-9]{64}$/),
      },
    });
    expect(loadCredential).toHaveBeenCalledWith('codex', 'team3');
    expect(launchBodyText).not.toContain(SECRET);
  });

  it('fails closed before credential reads or fleet effects when controller signing authority is absent', async () => {
    const loadCredential = vi.fn(async () => testCredentialPayload());
    const fetchFn = vi.fn();

    await expect(resumeKernelAttempt(childAttempt(), resumeOptions({
      env: remoteEnv({ KERNEL_FLEET_BRIDGE_TOKEN: undefined }),
      loadCredential,
      fetchFn,
    }))).rejects.toThrow('credential_signing_secret_invalid');

    expect(loadCredential).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

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
      executionTransport: 'fleet-worker',
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
      brain_url: 'https://brain.public.example',
    });
    expect(JSON.parse(fetchFn.mock.calls[2][1].body)).not.toHaveProperty('callback_url');
    expect(store.recordLaunchReceipt).toHaveBeenCalledWith(CHILD_ID, {
      leaseOwner: 'watchdog:test',
      leaseGeneration: 0,
      actualMachineId: 'xian-mac-m4',
      executionTransport: 'fleet-worker',
      remoteJobId: 'child-job',
      attestationStatus: 'verified',
    });
    expect(spawnDetached).not.toHaveBeenCalled();
    expect(removeContainer).not.toHaveBeenCalled();
  });

  it('cleans a migrated local parent through the Worker Attempt API before launching the child', async () => {
    const originalParentAttempt = {
      ...parentAttempt(),
      machine_id: 'us-mac-m4',
      requested_machine_id: 'us-mac-m4',
      remote_job_id: null,
      execution_transport: 'local-docker',
      local_container_naming: 'generation-v1',
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
    const fetchFn = successfulWorkerFetch();
    const store = resumeStore();

    await expect(resumeKernelAttempt(child, resumeOptions({
      originalParentAttempt,
      reclaimedParentAttempt,
      attemptStore: store,
      fetchFn,
      removeContainer,
    }))).resolves.toMatchObject({
      ok: true,
      executionTransport: 'fleet-worker',
      remoteJobId: 'child-job',
    });

    expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([
      `${BRIDGE_URL}/harness/attempts/${PARENT_ID}`,
      `${BRIDGE_URL}/harness/attempts/${PARENT_ID}/cancel`,
      `${BRIDGE_URL}/harness/attempts`,
    ]);
    expect(removeContainer).not.toHaveBeenCalled();
  });

  it('cleans a provable rolling legacy local parent before launching its child through Worker', async () => {
    const originalParentAttempt = {
      ...parentAttempt(),
      machine_id: 'us-mac-m4',
      requested_machine_id: 'us-mac-m4',
      lease_generation: 0,
      actual_machine_id: 'us-mac-m4',
      execution_transport: 'local-docker',
      remote_job_id: 'legacy-container-receipt',
      machine_attestation_status: 'local',
      attestation_status: 'local',
      local_container_naming: 'legacy-unsuffixed',
    };
    const reclaimedParentAttempt = {
      ...originalParentAttempt,
      lease_owner: 'watchdog:test',
      lease_generation: 1,
    };
    const child = {
      ...childAttempt(),
      machine_id: 'us-mac-m4',
      requested_machine_id: 'us-mac-m4',
    };
    const removeContainer = vi.fn(async () => true);
    const fetchFn = successfulWorkerFetch();

    await expect(resumeKernelAttempt(child, resumeOptions({
      originalParentAttempt,
      reclaimedParentAttempt,
      fetchFn,
      removeContainer,
    }))).resolves.toMatchObject({
      ok: true,
      executionTransport: 'fleet-worker',
      remoteJobId: 'child-job',
    });

    expect(removeContainer.mock.calls.map(([containerId]) => containerId)).toEqual([
      'cecelia-harness-11111111',
    ]);
    expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([
      `${BRIDGE_URL}/harness/attempts`,
    ]);
  });

  it('cleans a receipt-null modern parent through Worker ownership instead of guessing a container', async () => {
    const originalParentAttempt = {
      ...parentAttempt(),
      machine_id: 'us-mac-m4',
      requested_machine_id: 'us-mac-m4',
      lease_generation: 0,
      actual_machine_id: null,
      execution_transport: null,
      remote_job_id: null,
      machine_attestation_status: null,
      attestation_status: null,
      local_container_naming: 'generation-v1',
    };
    const reclaimedParentAttempt = {
      ...originalParentAttempt,
      lease_owner: 'watchdog:test',
      lease_generation: 1,
    };
    const child = {
      ...childAttempt(),
      machine_id: 'us-mac-m4',
      requested_machine_id: 'us-mac-m4',
    };
    const removeContainer = vi.fn(async () => true);
    const fetchFn = successfulWorkerFetch();

    await expect(resumeKernelAttempt(child, resumeOptions({
      originalParentAttempt,
      reclaimedParentAttempt,
      fetchFn,
      removeContainer,
    }))).resolves.toMatchObject({
      ok: true,
      executionTransport: 'fleet-worker',
      remoteJobId: 'child-job',
    });

    expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([
      `${BRIDGE_URL}/harness/attempts/${PARENT_ID}`,
      `${BRIDGE_URL}/harness/attempts/${PARENT_ID}/cancel`,
      `${BRIDGE_URL}/harness/attempts`,
    ]);
    expect(removeContainer).not.toHaveBeenCalled();
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
    const onRecoveryAlert = vi.fn(async () => {});
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
      onRecoveryAlert,
    }))).resolves.toMatchObject({
      ok: false,
      failure_code: 'resume_parent_cleanup_unconfirmed',
      cleanup_status: 'missing',
      recovery_alert: expect.objectContaining({
        kind: 'cleanup_unconfirmed',
        attemptId: PARENT_ID,
      }),
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(store.recordLaunchReceipt).not.toHaveBeenCalled();
    expect(onRecoveryAlert).not.toHaveBeenCalled();
  });

  it('returns deferred receipt-failure evidence without terminal or alert side effects', async () => {
    const store = resumeStore(null);
    const onRecoveryAlert = vi.fn(async () => {});
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
      onRecoveryAlert,
    }))).resolves.toMatchObject({
      ok: false,
      failure_code: 'resume_receipt_persist_failed',
      cleanup_status: 'cancelled',
      cleanup_diagnostic: null,
      lifecycle_detail: expect.stringContaining('launch receipt was not persisted'),
      recovery_alert: null,
    });

    expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([
      `${BRIDGE_URL}/harness/attempts/${PARENT_ID}`,
      `${BRIDGE_URL}/harness/attempts/${PARENT_ID}/cancel`,
      `${BRIDGE_URL}/harness/attempts`,
      `${BRIDGE_URL}/harness/attempts/${CHILD_ID}/cancel`,
    ]);
    expect(store.fail).not.toHaveBeenCalled();
    expect(onRecoveryAlert).not.toHaveBeenCalled();
  });

  it('cancels the exact claimed child after the Bridge accepts but returns invalid attestation', async () => {
    const store = resumeStore();
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
          attestation: 'invalid-attestation',
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
      failure_code: 'resume_launch_failed',
      cleanup_status: 'cancelled',
      error: 'remote_bridge_attestation_invalid',
    });

    expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([
      `${BRIDGE_URL}/harness/attempts/${PARENT_ID}`,
      `${BRIDGE_URL}/harness/attempts/${PARENT_ID}/cancel`,
      `${BRIDGE_URL}/harness/attempts`,
      `${BRIDGE_URL}/harness/attempts/${CHILD_ID}/cancel`,
    ]);
    expect(JSON.parse(fetchFn.mock.calls[3][1].body)).toEqual({
      lease_owner: 'watchdog:test',
      lease_generation: 0,
    });
  });

  it('cancels the exact claimed child after the Bridge accepts but its response body times out', async () => {
    const store = resumeStore();
    const fetchFn = vi.fn(async (url, options) => {
      if (url === `${BRIDGE_URL}/harness/attempts/${PARENT_ID}`) {
        return response(200, { status: 'running' });
      }
      if (url === `${BRIDGE_URL}/harness/attempts/${PARENT_ID}/cancel`) {
        return response(200, { status: 'cancelled' });
      }
      if (url === `${BRIDGE_URL}/harness/attempts`) {
        return {
          ok: true,
          status: 202,
          json: () => new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => {
              reject(new Error('raw bridge body timeout'));
            }, { once: true });
          }),
        };
      }
      if (url === `${BRIDGE_URL}/harness/attempts/${CHILD_ID}/cancel`) {
        return response(200, { status: 'cancelled', job_id: 'child-job' });
      }
      throw new Error(`unexpected request ${url}`);
    });

    await expect(resumeKernelAttempt(childAttempt(), resumeOptions({
      attemptStore: store,
      fetchFn,
      remoteBridgeTimeoutMs: 5,
    }))).resolves.toMatchObject({
      ok: false,
      failure_code: 'resume_launch_failed',
      cleanup_status: 'cancelled',
      error: 'remote_bridge_launch_timeout',
    });

    expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([
      `${BRIDGE_URL}/harness/attempts/${PARENT_ID}`,
      `${BRIDGE_URL}/harness/attempts/${PARENT_ID}/cancel`,
      `${BRIDGE_URL}/harness/attempts`,
      `${BRIDGE_URL}/harness/attempts/${CHILD_ID}/cancel`,
    ]);
  });

  it('alerts when child cleanup after a failed launch is not confirmed safe', async () => {
    const onRecoveryAlert = vi.fn(async () => {});
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
          attestation: 'invalid-attestation',
        });
      }
      if (url === `${BRIDGE_URL}/harness/attempts/${CHILD_ID}/cancel`) {
        return response(404, { status: 'missing' });
      }
      throw new Error(`unexpected request ${url}`);
    });

    await expect(resumeKernelAttempt(childAttempt(), resumeOptions({
      fetchFn,
      onRecoveryAlert,
    }))).resolves.toMatchObject({
      ok: false,
      failure_code: 'resume_child_cleanup_unconfirmed',
      cleanup_status: 'missing',
      error: expect.stringContaining('orphan cancellation unsafe: missing'),
      recovery_alert: expect.objectContaining({
        kind: 'cleanup_unconfirmed',
        attemptId: CHILD_ID,
      }),
    });

    expect(onRecoveryAlert).not.toHaveBeenCalled();
  });

  it('surfaces a sanitized error when an unconfirmed-cleanup alert itself is rejected', async () => {
    const original = parentAttempt();
    const reclaimed = {
      ...original,
      lease_owner: 'watchdog:test',
      lease_generation: 4,
    };
    const store = {
      getById: vi.fn(async () => original),
      reclaim: vi.fn(async () => reclaimed),
      rotateCallbackSecret: vi.fn(async () => reclaimed),
      createAttempt: vi.fn(async () => ({ ...childAttempt(), status: 'queued', lease_owner: null })),
      markStarting: vi.fn(async () => childAttempt()),
      fail: vi.fn(async () => ({ attempt: {}, deduped: false })),
    };
    const onRecoveryAlert = vi.fn(async () => {
      throw new Error('alert transport leaked fleet-secret-value');
    });

    let thrown;
    try {
      await reconcileExpiredKernelAttempt({
        db: { query: vi.fn() },
        attemptStore: store,
        attemptId: PARENT_ID,
        leaseOwner: 'watchdog:test',
        resumeAttempt: vi.fn(async () => ({
          ok: false,
          failure_code: 'resume_parent_cleanup_unconfirmed',
          recovery_alert: {
            kind: 'cleanup_unconfirmed',
            attemptId: PARENT_ID,
            lifecycleCode: 'resume_parent_cleanup_unconfirmed',
            cleanupStatus: 'missing',
            diagnostic: 'orphan cancellation unsafe: missing',
          },
        })),
        reservedChildHop: 8,
        randomUUIDFn: () => CHILD_ID,
        onRecoveryAlert,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AggregateError);
    expect(thrown.message).toContain(
      'kernel_recovery_alert_failed:resume_parent_cleanup_unconfirmed',
    );
    expect(thrown.message).not.toContain('fleet-secret-value');
    expect(store.fail).toHaveBeenCalledTimes(2);
    expect(store.fail.mock.invocationCallOrder[0])
      .toBeLessThan(onRecoveryAlert.mock.invocationCallOrder[0]);
    expect(store.fail.mock.invocationCallOrder[1])
      .toBeLessThan(onRecoveryAlert.mock.invocationCallOrder[0]);
  });

  it('attempts both terminal writes before cleanup P1 when persistence and alert both reject', async () => {
    const original = parentAttempt();
    const reclaimed = {
      ...original,
      lease_owner: 'watchdog:test',
      lease_generation: 4,
    };
    const store = {
      getById: vi.fn(async () => original),
      reclaim: vi.fn(async () => reclaimed),
      rotateCallbackSecret: vi.fn(async () => reclaimed),
      createAttempt: vi.fn(async () => ({ ...childAttempt(), status: 'queued', lease_owner: null })),
      markStarting: vi.fn(async () => childAttempt()),
      fail: vi.fn(async (attemptId) => {
        if (attemptId === CHILD_ID) throw new Error('child terminal persistence rejected');
        return { attempt: {}, deduped: false };
      }),
    };
    const onRecoveryAlert = vi.fn(async () => {
      throw new Error('alert rejected with HARNESS_CALLBACK_TOKEN=raw-secret');
    });

    let thrown;
    try {
      await reconcileExpiredKernelAttempt({
        db: { query: vi.fn() },
        attemptStore: store,
        attemptId: PARENT_ID,
        leaseOwner: 'watchdog:test',
        resumeAttempt: vi.fn(async () => ({
          ok: false,
          failure_code: 'resume_child_cleanup_unconfirmed',
          recovery_alert: {
            kind: 'cleanup_unconfirmed',
            attemptId: CHILD_ID,
            lifecycleCode: 'resume_child_cleanup_unconfirmed',
            cleanupStatus: 'missing',
            diagnostic: 'child cleanup missing',
          },
        })),
        reservedChildHop: 8,
        randomUUIDFn: () => CHILD_ID,
        onRecoveryAlert,
      });
    } catch (error) {
      thrown = error;
    }

    expect(store.fail).toHaveBeenCalledTimes(2);
    expect(store.fail.mock.calls.map(([attemptId]) => attemptId)).toEqual([
      CHILD_ID,
      PARENT_ID,
    ]);
    expect(store.fail.mock.invocationCallOrder[1])
      .toBeLessThan(onRecoveryAlert.mock.invocationCallOrder[0]);
    expect(thrown).toBeInstanceOf(AggregateError);
    expect(thrown.message).toContain(
      'failure_persistence_failed: child terminal persistence rejected',
    );
    expect(thrown.message).toContain(
      'kernel_recovery_alert_failed:resume_child_cleanup_unconfirmed',
    );
    expect(thrown.message).not.toContain('raw-secret');
  });

  it('terminalizes both claims before preserving an aggregate raised inside resume', async () => {
    const original = parentAttempt();
    const reclaimed = {
      ...original,
      lease_owner: 'watchdog:test',
      lease_generation: 4,
    };
    const store = {
      getById: vi.fn(async () => original),
      reclaim: vi.fn(async () => reclaimed),
      rotateCallbackSecret: vi.fn(async () => reclaimed),
      createAttempt: vi.fn(async () => ({ ...childAttempt(), status: 'queued', lease_owner: null })),
      markStarting: vi.fn(async () => childAttempt()),
      fail: vi.fn(async () => ({ attempt: {}, deduped: false })),
    };
    const resumeError = new AggregateError(
      [new Error('cleanup alert delivery rejected')],
      'kernel_recovery_alert_failed:resume_receipt_persist_failed',
    );
    resumeError.failureCode = 'resume_receipt_persist_failed';

    let thrown;
    try {
      await reconcileExpiredKernelAttempt({
        db: { query: vi.fn() },
        attemptStore: store,
        attemptId: PARENT_ID,
        leaseOwner: 'watchdog:test',
        resumeAttempt: vi.fn(async () => {
          throw resumeError;
        }),
        reservedChildHop: 8,
        randomUUIDFn: () => CHILD_ID,
      });
    } catch (error) {
      thrown = error;
    }

    expect(store.fail.mock.calls.map(([attemptId]) => attemptId)).toEqual([
      CHILD_ID,
      PARENT_ID,
    ]);
    expect(thrown).toBeInstanceOf(AggregateError);
    expect(thrown.message).toContain(
      'kernel_recovery_alert_failed:resume_receipt_persist_failed',
    );
  });

  it('orders production receipt recovery as child fail, parent fail, then deferred cleanup P1', async () => {
    const events = [];
    const original = parentAttempt();
    const reclaimed = {
      ...original,
      lease_owner: 'watchdog:test',
      lease_generation: 4,
    };
    const store = {
      getById: vi.fn(async () => original),
      reclaim: vi.fn(async () => reclaimed),
      rotateCallbackSecret: vi.fn(async () => reclaimed),
      createAttempt: vi.fn(async () => ({ ...childAttempt(), status: 'queued', lease_owner: null })),
      markStarting: vi.fn(async () => childAttempt()),
      recordLaunchReceipt: vi.fn(async () => null),
      fail: vi.fn(async (attemptId) => {
        events.push(attemptId === CHILD_ID ? 'fail-child' : 'fail-parent');
        return { attempt: {}, deduped: false };
      }),
    };
    const launcher = {
      inspect: vi.fn(async () => ({ status: 'running' })),
      cancel: vi.fn()
        .mockResolvedValueOnce({ status: 'cancelled' })
        .mockResolvedValueOnce({ status: 'missing' }),
      launch: vi.fn(async () => ({
        jobId: 'child-job',
        actualMachineId: 'xian-mac-m4',
        executionTransport: 'remote-bridge',
        remoteJobId: 'child-job',
        attestationStatus: 'verified',
      })),
    };
    const onRecoveryAlert = vi.fn(async () => {
      events.push('alert');
      throw new Error('cleanup P1 rejected callback_token=raw-callback-secret');
    });

    let thrown;
    try {
      await reconcileExpiredKernelAttempt({
        db: { query: vi.fn() },
        attemptStore: store,
        attemptId: PARENT_ID,
        leaseOwner: 'watchdog:test',
        resumeAttempt: (child, context) => resumeKernelAttempt(child, {
          ...context,
          task: { id: 'task-1', payload: {} },
          dbPool: { query: vi.fn() },
          launcher,
        }),
        reservedChildHop: 8,
        randomUUIDFn: () => CHILD_ID,
        onRecoveryAlert,
      });
    } catch (error) {
      thrown = error;
    }

    expect(events).toEqual(['fail-child', 'fail-parent', 'alert']);
    expect(store.fail).toHaveBeenCalledTimes(2);
    expect(store.fail).toHaveBeenNthCalledWith(1, CHILD_ID, expect.objectContaining({
      code: 'resume_receipt_persist_failed',
      message: expect.stringContaining('resume receipt persistence failed'),
    }), {
      leaseOwner: 'watchdog:test',
      leaseGeneration: 0,
    });
    expect(store.fail).toHaveBeenNthCalledWith(2, PARENT_ID, expect.objectContaining({
      code: 'resume_receipt_persist_failed',
      message: expect.stringContaining('resume receipt persistence failed'),
    }), {
      leaseOwner: 'watchdog:test',
      leaseGeneration: 4,
    });
    expect(thrown).toBeInstanceOf(AggregateError);
    expect(thrown.message).toContain(
      'kernel_recovery_alert_failed:resume_receipt_persist_failed',
    );
    expect(thrown.message).not.toContain('raw-callback-secret');
  });

  it('sanitizes deferred receipt evidence without consulting terminal persistence', async () => {
    const store = resumeStore(null);
    store.recordLaunchReceipt.mockRejectedValueOnce(
      new Error('HARNESS_CALLBACK_TOKEN=raw-receipt-secret'),
    );
    store.fail.mockRejectedValueOnce(new Error('child terminal write rejected'));
    const onRecoveryAlert = vi.fn(async () => {
      throw new Error('must remain deferred');
    });
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
        return response(404, { status: 'missing' });
      }
      throw new Error(`unexpected request ${url}`);
    });

    const result = await resumeKernelAttempt(childAttempt(), resumeOptions({
      attemptStore: store,
      fetchFn,
      onRecoveryAlert,
    }));

    expect(result).toMatchObject({
      ok: false,
      failure_code: 'resume_receipt_persist_failed',
      cleanup_status: 'missing',
      cleanup_diagnostic: 'orphan cancellation unsafe: missing (HTTP 404)',
      lifecycle_detail: expect.stringContaining('[REDACTED]'),
      recovery_alert: expect.objectContaining({
        kind: 'cleanup_unconfirmed',
        attemptId: CHILD_ID,
        lifecycleCode: 'resume_receipt_persist_failed',
      }),
    });
    expect(result.lifecycle_detail).not.toContain('raw-receipt-secret');
    expect(store.fail).not.toHaveBeenCalled();
    expect(onRecoveryAlert).not.toHaveBeenCalled();
  });

  it('passes immutable original and reclaimed parent claims and exact-fails both generations', async () => {
    const original = {
      ...parentAttempt(),
      actual_machine_id: 'xian-mac-m1',
      task_bundle: {
        ...bundle(),
        attempt_id: PARENT_ID,
        hop: 7,
        constraints: {
          ...bundle().constraints,
          fresh_session: true,
        },
        inputs: {
          ...bundle().inputs,
          workspace_spec: {
            ...bundle().inputs.workspace_spec,
            attempt_id: PARENT_ID,
          },
        },
      },
    };
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
    expect(store.createAttempt).toHaveBeenCalledWith(expect.objectContaining({
      id: CHILD_ID,
      machineId: 'xian-mac-m1',
      bundle: expect.objectContaining({
        attempt_id: CHILD_ID,
        hop: 8,
        constraints: expect.objectContaining({ fresh_session: false }),
        inputs: expect.objectContaining({
          workspace_spec: expect.objectContaining({ attempt_id: CHILD_ID }),
        }),
      }),
    }));
    expect(resumeAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        id: CHILD_ID,
        lease_owner: 'watchdog:test',
        lease_generation: 0,
      }),
      expect.objectContaining({
        parentAttempt: reclaimed,
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

  it('throws the shared aggregate when exact-failing a claimed child is rejected', async () => {
    const original = parentAttempt();
    const reclaimed = {
      ...original,
      lease_owner: 'watchdog:test',
      lease_generation: 4,
    };
    const store = {
      getById: vi.fn(async () => original),
      reclaim: vi.fn(async () => reclaimed),
      rotateCallbackSecret: vi.fn(async () => reclaimed),
      createAttempt: vi.fn(async () => ({ ...childAttempt(), status: 'queued', lease_owner: null })),
      markStarting: vi.fn(async () => childAttempt()),
      fail: vi.fn(async (attemptId) => {
        if (attemptId === CHILD_ID) throw new Error('child fail write rejected');
        return { attempt: {}, deduped: false };
      }),
    };
    const onRecoveryAlert = vi.fn(async () => {});

    let thrown;
    try {
      await reconcileExpiredKernelAttempt({
        db: { query: vi.fn() },
        attemptStore: store,
        attemptId: PARENT_ID,
        leaseOwner: 'watchdog:test',
        resumeAttempt: vi.fn(async () => ({ ok: false, failure_code: 'resume_launch_failed' })),
        reservedChildHop: 8,
        randomUUIDFn: () => CHILD_ID,
        onRecoveryAlert,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AggregateError);
    expect(thrown.message).toContain('resume child launch failed: resume_launch_failed');
    expect(thrown.message).toContain('failure_persistence_failed: child fail write rejected');
    expect(onRecoveryAlert).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'failure_persistence',
      attemptId: CHILD_ID,
    }));
  });

  it('throws the shared aggregate when exact-failing the reclaimed parent is rejected', async () => {
    const original = parentAttempt();
    const reclaimed = {
      ...original,
      lease_owner: 'watchdog:test',
      lease_generation: 4,
    };
    const store = {
      getById: vi.fn(async () => original),
      reclaim: vi.fn(async () => reclaimed),
      rotateCallbackSecret: vi.fn(async () => reclaimed),
      createAttempt: vi.fn(async () => ({ ...childAttempt(), status: 'queued', lease_owner: null })),
      markStarting: vi.fn(async () => childAttempt()),
      fail: vi.fn(async (attemptId) => {
        if (attemptId === PARENT_ID) throw new Error('parent fail write rejected');
        return { attempt: {}, deduped: false };
      }),
    };
    const onRecoveryAlert = vi.fn(async () => {});

    let thrown;
    try {
      await reconcileExpiredKernelAttempt({
        db: { query: vi.fn() },
        attemptStore: store,
        attemptId: PARENT_ID,
        leaseOwner: 'watchdog:test',
        resumeAttempt: vi.fn(async () => ({ ok: false, failure_code: 'resume_launch_failed' })),
        reservedChildHop: 8,
        randomUUIDFn: () => CHILD_ID,
        onRecoveryAlert,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AggregateError);
    expect(thrown.message).toContain('expired attempt resume failed: resume_launch_failed');
    expect(thrown.message).toContain('failure_persistence_failed: parent fail write rejected');
    expect(onRecoveryAlert).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'failure_persistence',
      attemptId: PARENT_ID,
    }));
  });
});
