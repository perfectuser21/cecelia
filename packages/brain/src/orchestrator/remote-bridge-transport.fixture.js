import { vi } from 'vitest';

import { signMachineAttestation } from './machine-attestation.js';
import { createRemoteBridgeTransport } from './remote-bridge-transport.js';

const SHARED_SECRET = 'bridge-secret-that-is-at-least-32-bytes';
const CALLBACK_TOKEN = 'callback-token-that-must-never-leak';
const BRIDGE_URL = 'http://100.86.57.69:3458';
const BRAIN_URL = 'http://brain.internal:5221';
const MACHINE = 'xian-mac-m4';
const NOW_MS = Date.parse('2026-07-27T12:00:00.000Z');
const ENVELOPE = Object.freeze({
  contract_version: 'credential-envelope/v1',
  credential_ref: '33333333-3333-4333-8333-333333333333',
  attempt_id: 'attempt-1',
  account_id: 'team3',
  machine_id: MACHINE,
  issued_at: '2026-07-27T12:00:00.000Z',
  expires_at: '2026-07-27T14:00:00.000Z',
  payload_hash: `sha256:${'a'.repeat(64)}`,
  payload: 'eyJ0b2tlbnMiOnsiYWNjZXNzX3Rva2VuIjoic2VjcmV0In19',
});
const GITHUB_ENVELOPE = Object.freeze({
  contract_version: 'github-credential-envelope/v1',
  credential_ref: '44444444-4444-4444-8444-444444444444',
  attempt_id: 'attempt-1',
  machine_id: MACHINE,
  issued_at: '2026-07-27T12:00:00.000Z',
  expires_at: '2026-07-27T13:00:00.000Z',
  payload_hash: `sha256:${'b'.repeat(64)}`,
  payload: 'Z2l0aHViX3BhdF90ZXN0',
});

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn(async () => body),
  };
}

function prepareInput(overrides = {}) {
  const attempt = {
    id: 'attempt-1',
    run_id: 'run-1',
    lease_owner: 'dispatcher-1',
    lease_generation: 3,
    callbackSecret: CALLBACK_TOKEN,
    ...overrides.attempt,
  };
  const bundle = {
    opaque: 'must-not-be-sent',
    role: 'generator',
    inputs: {
      execution_surface: 'fleet-worker',
      workspace_spec: {
        repo: 'perfectuser21/cecelia',
        base_sha: '0123456789abcdef0123456789abcdef01234567',
        branch: 'cp-07272050-remote-worker',
        expected_head_sha: null,
        mode: 'read-write',
        run_id: 'run-1',
        attempt_id: 'attempt-1',
      },
    },
    constraints: { timeout_seconds: 3600 },
    ...overrides.bundle,
  };
  const spec = {
    provider: 'codex',
    command: 'codex',
    args: ['exec', '--json'],
    stdin: 'do the work',
    output: { format: 'jsonl' },
    environment: { MUST_NOT: 'be sent' },
    ...overrides.spec,
  };
  const target = {
    provider: 'codex',
    account: 'team3',
    machine: MACHINE,
    ...overrides.target,
  };
  return { attempt, bundle, spec, target };
}

function acceptedPrepareResponse(overrides = {}) {
  const values = {
    status: 'accepted',
    job_id: 'job-1',
    actual_machine_id: MACHINE,
    ...overrides,
  };
  return {
    ...values,
    attestation: overrides.attestation ?? signMachineAttestation({
      secret: SHARED_SECRET,
      attemptId: 'attempt-1',
      machineId: values.actual_machine_id,
      jobId: values.job_id,
    }),
  };
}

function createTransport(overrides = {}) {
  return createRemoteBridgeTransport({
    enabled: true,
    bridgeUrls: { [MACHINE]: BRIDGE_URL },
    sharedSecret: SHARED_SECRET,
    brainUrl: BRAIN_URL,
    fetchFn: vi.fn(async () => jsonResponse(202, acceptedPrepareResponse())),
    credentialBroker: { issue: vi.fn(async () => ENVELOPE) },
    githubCredentialBroker: { issue: vi.fn(async () => GITHUB_ENVELOPE) },
    now: () => NOW_MS,
    // 记录真实退避参数，测试无需等待生产环境的 5 秒间隔。
    sleepFn: vi.fn(async () => {}),
    ...overrides,
  });
}

function operationInput(operation) {
  if (operation === 'prepare') return prepareInput();
  return {
    attempt: {
      id: 'attempt-1',
      lease_owner: 'dispatcher-1',
      lease_generation: 3,
    },
    target: { machine: MACHINE },
  };
}

function cleanupReceipt(overrides = {}) {
  const values = {
    status: 'cleaned',
    attempt_id: 'attempt-1',
    actual_machine_id: MACHINE,
    ...overrides,
  };
  return {
    ...values,
    attestation: overrides.attestation ?? signMachineAttestation({
      secret: SHARED_SECRET,
      attemptId: values.attempt_id,
      machineId: values.actual_machine_id,
      jobId: `resource-cleanup:${values.status}`,
    }),
  };
}

function listenOnLoopback(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function closeServer(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
    server.closeAllConnections?.();
  });
}

function resolvesWithin(promise, timeoutMs) {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => resolve(false), timeoutMs);
    promise.then(() => {
      clearTimeout(timeoutId);
      resolve(true);
    });
  });
}


export {
  SHARED_SECRET,
  CALLBACK_TOKEN,
  BRIDGE_URL,
  BRAIN_URL,
  MACHINE,
  NOW_MS,
  ENVELOPE,
  GITHUB_ENVELOPE,
  jsonResponse,
  prepareInput,
  acceptedPrepareResponse,
  createTransport,
  operationInput,
  cleanupReceipt,
  listenOnLoopback,
  closeServer,
  resolvesWithin
};
