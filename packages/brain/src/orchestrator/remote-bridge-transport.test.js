import { createServer } from 'node:http';

import { describe, expect, it, vi } from 'vitest';

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
    ...overrides,
  });
}

function operationInput(operation) {
  if (operation === 'prepare') return prepareInput();
  if (operation === 'inspect') {
    return {
      attempt: { id: 'attempt-1' },
      target: { machine: MACHINE },
    };
  }
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

describe('remote Bridge prepare', () => {
  it('prepares through the two-phase endpoint and verifies the attested receipt', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(202, acceptedPrepareResponse()));
    const transport = createTransport({ fetchFn });

    expect(typeof transport.prepare).toBe('function');
    await expect(transport.prepare(prepareInput())).resolves.toEqual({
      jobId: 'job-1',
      actualMachineId: MACHINE,
      executionTransport: 'fleet-worker',
      remoteJobId: 'job-1',
      attestationStatus: 'verified',
    });
    expect(fetchFn).toHaveBeenCalledWith(
      `${BRIDGE_URL}/harness/attempts/prepare`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('rejects a prepared receipt with an invalid machine attestation', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(202, acceptedPrepareResponse({
      attestation: '0'.repeat(64),
    })));
    const transport = createTransport({ fetchFn });

    expect(typeof transport.prepare).toBe('function');
    await expect(transport.prepare(prepareInput())).rejects.toThrow(
      'remote_bridge_attestation_invalid',
    );
  });

  it('starts the exact Attempt with only its lease identity', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {
      status: 'running',
      attempt_id: 'attempt-1',
      credential: 'must-not-cross',
    }));
    const transport = createTransport({ fetchFn });

    expect(typeof transport.start).toBe('function');
    await expect(transport.start(operationInput('start'))).resolves.toEqual({
      status: 'running',
      attempt_id: 'attempt-1',
    });
    expect(fetchFn).toHaveBeenCalledWith(
      `${BRIDGE_URL}/harness/attempts/attempt-1/start`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          lease_owner: 'dispatcher-1',
          lease_generation: 3,
        }),
      }),
    );
  });

  it('posts the allowlisted payload with bearer authentication and verifies the receipt', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(202, acceptedPrepareResponse()));
    const transport = createTransport({ fetchFn });

    await expect(transport.prepare(prepareInput())).resolves.toEqual({
      jobId: 'job-1',
      actualMachineId: MACHINE,
      executionTransport: 'fleet-worker',
      remoteJobId: 'job-1',
      attestationStatus: 'verified',
    });
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(fetchFn).toHaveBeenCalledWith(
      `${BRIDGE_URL}/harness/attempts/prepare`,
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SHARED_SECRET}`,
          'Content-Type': 'application/json',
        },
        signal: expect.any(AbortSignal),
      }),
    );
    const requestBody = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(requestBody).toEqual({
      attempt_id: 'attempt-1',
      run_id: 'run-1',
      lease_owner: 'dispatcher-1',
      lease_generation: 3,
      timeout_seconds: 3600,
      target: {
        provider: 'codex',
        account: 'team3',
        machine: MACHINE,
        role: 'generator',
      },
      workspace_spec: {
        repo: 'perfectuser21/cecelia',
        base_sha: '0123456789abcdef0123456789abcdef01234567',
        branch: 'cp-07272050-remote-worker',
        expected_head_sha: null,
        mode: 'read-write',
        run_id: 'run-1',
        attempt_id: 'attempt-1',
      },
      provider_spec: {
        provider: 'codex',
        command: 'codex',
        args: ['exec', '--json'],
        stdin: 'do the work',
        output: { format: 'jsonl' },
      },
      credential_envelope: ENVELOPE,
      github_credential_envelope: GITHUB_ENVELOPE,
      callback_url: `${BRAIN_URL}/api/brain/harness/attempts/attempt-1/callback`,
      callback_token: CALLBACK_TOKEN,
    });
    expect(requestBody).not.toHaveProperty('bundle');
    expect(requestBody.provider_spec).not.toHaveProperty('environment');
  });

  // The frozen-baseline invariant is worthless if it is dropped in transit to
  // the Worker: the Worker is the only component that can bind it to a
  // server-observed checkout SHA before the Provider ever runs.
  it('forwards the frozen baseline invariant to the Worker', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(202, acceptedPrepareResponse()));
    const transport = createTransport({ fetchFn });
    const input = prepareInput();
    input.bundle.inputs.workspace_spec = {
      ...input.bundle.inputs.workspace_spec,
      frozen_baseline: true,
    };

    await transport.prepare(input);

    const requestBody = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(requestBody.workspace_spec).toMatchObject({ frozen_baseline: true });
  });

  it('projects runtime resources to the single bounded PostgreSQL boolean', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(202, acceptedPrepareResponse()));
    const transport = createTransport({ fetchFn });
    const input = prepareInput();
    input.bundle.inputs.runtime_resources = {
      postgres: true,
      database_url: 'postgresql://attacker:secret@outside.invalid/db',
      token: 'must-not-cross',
    };

    await transport.prepare(input);

    const requestBody = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(requestBody.runtime_resources).toEqual({ postgres: true });
    expect(JSON.stringify(requestBody.runtime_resources)).not.toMatch(
      /url|password|cookie|token|secret/i,
    );
  });

  it('terminalizes the exact leased Attempt and verifies the bounded cleanup receipt', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, cleanupReceipt()));
    const transport = createTransport({ fetchFn });
    const input = operationInput('terminal');

    await expect(transport.terminal(input)).resolves.toEqual({
      status: 'cleaned',
      attempt_id: 'attempt-1',
      actual_machine_id: MACHINE,
      attestation_status: 'verified',
    });

    expect(fetchFn.mock.calls[0][0]).toBe(
      `${BRIDGE_URL}/harness/attempts/attempt-1/terminal`,
    );
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({
      lease_owner: 'dispatcher-1',
      lease_generation: 3,
    });
  });

  it('rejects invalid prepare timeouts before credentials or Worker transport', async () => {
    const invalidCases = [
      ['codex', undefined],
      ['claude', 0],
      ['grok', -1],
      ['codex', 1.5],
      ['claude', Number.MAX_SAFE_INTEGER + 1],
    ];
    for (const [provider, timeoutSeconds] of invalidCases) {
      const fetchFn = vi.fn();
      const issue = vi.fn();
      const transport = createTransport({
        fetchFn,
        credentialBroker: { issue },
      });

      await expect(transport.prepare(prepareInput({
        bundle: {
          constraints: timeoutSeconds === undefined
            ? {}
            : { timeout_seconds: timeoutSeconds },
        },
        spec: { provider, command: provider },
        target: { provider, account: `${provider}-account` },
      }))).rejects.toThrow('remote_bridge_invalid_attempt_timeout');

      expect(issue).not.toHaveBeenCalled();
      expect(fetchFn).not.toHaveBeenCalled();
    }
  });

  it('binds one Codex credential envelope to the selected attempt, account, machine, and deadline', async () => {
    const issue = vi.fn(async () => ENVELOPE);
    const transport = createTransport({ credentialBroker: { issue } });

    await transport.prepare(prepareInput());

    expect(issue).toHaveBeenCalledOnce();
    expect(issue).toHaveBeenCalledWith({
      attemptId: 'attempt-1',
      accountId: 'team3',
      machineId: MACHINE,
      deadlineAt: '2026-07-27T13:00:00.000Z',
    });
  });

  it.each(['planner', 'proposer', 'generator', 'evaluator'])(
    'binds one GitHub credential envelope to a %s Attempt and deadline',
    async (role) => {
      const issue = vi.fn(async () => GITHUB_ENVELOPE);
      const fetchFn = vi.fn(async () => jsonResponse(202, acceptedPrepareResponse()));
      const transport = createTransport({
        fetchFn,
        githubCredentialBroker: { issue },
      });

      await transport.prepare(prepareInput({
        bundle: {
          role,
          inputs: prepareInput().bundle.inputs,
          constraints: { timeout_seconds: 3600 },
        },
      }));

      expect(issue).toHaveBeenCalledOnce();
      expect(issue).toHaveBeenCalledWith({
        attemptId: 'attempt-1',
        machineId: MACHINE,
        deadlineAt: '2026-07-27T13:00:00.000Z',
      });
      expect(JSON.parse(fetchFn.mock.calls[0][1].body))
        .toHaveProperty('github_credential_envelope', GITHUB_ENVELOPE);
    },
  );

  it('fails closed before contacting Worker when a GitHub writer broker is unavailable', async () => {
    const fetchFn = vi.fn();
    const transport = createTransport({
      fetchFn,
      githubCredentialBroker: undefined,
    });

    await expect(transport.prepare(prepareInput())).rejects.toThrow(
      'remote_bridge_github_credential_broker_unavailable',
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each(['reviewer', 'reporter'])(
    'does not issue a GitHub credential envelope for read-only role %s',
    async (role) => {
      const issue = vi.fn();
      const fetchFn = vi.fn(async () => jsonResponse(202, acceptedPrepareResponse()));
      const transport = createTransport({
        fetchFn,
        githubCredentialBroker: { issue },
      });

      await transport.prepare(prepareInput({
        bundle: {
          role,
          inputs: prepareInput().bundle.inputs,
          constraints: { timeout_seconds: 3600 },
        },
      }));

      expect(issue).not.toHaveBeenCalled();
      expect(JSON.parse(fetchFn.mock.calls[0][1].body))
        .not.toHaveProperty('github_credential_envelope');
    },
  );

  it('fails closed before contacting the Worker when a Codex broker is unavailable', async () => {
    const fetchFn = vi.fn();
    const transport = createTransport({ fetchFn, credentialBroker: undefined });

    await expect(transport.prepare(prepareInput())).rejects.toThrow(
      'remote_bridge_credential_broker_unavailable',
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('fails closed before contacting the Worker when the broker returns no envelope', async () => {
    const fetchFn = vi.fn();
    const transport = createTransport({
      fetchFn,
      credentialBroker: { issue: vi.fn(async () => undefined) },
    });

    await expect(transport.prepare(prepareInput())).rejects.toThrow(
      'remote_bridge_credential_envelope_invalid',
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('fails closed before contacting the Worker when the computed deadline is outside the ISO date range', async () => {
    const fetchFn = vi.fn();
    const issue = vi.fn();
    const transport = createTransport({
      fetchFn,
      credentialBroker: { issue },
      now: () => 8_640_000_000_000_000 - 1000,
    });

    await expect(transport.prepare(prepareInput())).rejects.toThrow(
      'remote_bridge_invalid_attempt_timeout',
    );
    expect(issue).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('does not issue or send a Codex credential envelope for another provider', async () => {
    const issue = vi.fn();
    const fetchFn = vi.fn(async () => jsonResponse(202, acceptedPrepareResponse()));
    const transport = createTransport({ fetchFn, credentialBroker: { issue } });

    await transport.prepare(prepareInput({
      spec: { provider: 'claude', command: 'claude' },
      target: { provider: 'claude', account: 'claude-team1' },
    }));

    expect(issue).not.toHaveBeenCalled();
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).not.toHaveProperty(
      'credential_envelope',
    );
  });

  it('uses zero when lease generation is absent', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(202, acceptedPrepareResponse()));
    const transport = createTransport({ fetchFn });
    const input = prepareInput();
    delete input.attempt.lease_generation;

    await transport.prepare(input);

    expect(JSON.parse(fetchFn.mock.calls[0][1].body).lease_generation).toBe(0);
  });

  it('converts only the server-owned canary sentinel into a path-free workspace capability', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(202, acceptedPrepareResponse()));
    const transport = createTransport({ fetchFn });

    await transport.prepare(prepareInput({
      bundle: {
        inputs: {
          worktree_path: '/var/empty/kernel-fleet-canary',
        },
      },
      spec: {
        cwd: '/Users/attacker/repos/cecelia',
        workspace: {
          kind: 'disposable-canary-v1',
          path: '/Users/attacker/repos/cecelia',
        },
      },
    }));

    const requestBody = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(requestBody.provider_spec.workspace).toEqual({
      kind: 'disposable-canary-v1',
      attempt_id: 'attempt-1',
    });
    expect(JSON.stringify(requestBody.provider_spec)).not.toContain('/Users/attacker');
    expect(requestBody.provider_spec).not.toHaveProperty('cwd');
  });

  it('does not trust a provider cwd or workspace when the bundle is not a canary', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(202, acceptedPrepareResponse()));
    const transport = createTransport({ fetchFn });

    await transport.prepare(prepareInput({
      bundle: {
        inputs: {
          worktree_path: '/Users/operator/repos/cecelia',
        },
      },
      spec: {
        cwd: '/var/empty/kernel-fleet-canary',
        workspace: {
          kind: 'disposable-canary-v1',
          attempt_id: 'attempt-1',
        },
      },
    }));

    const providerSpec = JSON.parse(fetchFn.mock.calls[0][1].body).provider_spec;
    expect(providerSpec).not.toHaveProperty('workspace');
    expect(providerSpec).not.toHaveProperty('cwd');
  });

  it('freezes a successful prepare receipt', async () => {
    const transport = createTransport();

    const result = await transport.prepare(prepareInput());

    expect(Object.isFrozen(result)).toBe(true);
  });

  it('copies and freezes URL routing at construction instead of trusting later mutations', async () => {
    const bridgeUrls = { [MACHINE]: BRIDGE_URL };
    const fetchFn = vi.fn(async () => jsonResponse(202, acceptedPrepareResponse()));
    const transport = createTransport({ bridgeUrls, fetchFn });
    bridgeUrls[MACHINE] = 'http://attacker.invalid:9000';
    bridgeUrls['xian-mac-m1'] = 'http://attacker.invalid:9001';

    await transport.prepare(prepareInput());

    expect(fetchFn.mock.calls[0][0]).toBe(`${BRIDGE_URL}/harness/attempts/prepare`);
    await expect(transport.prepare(prepareInput({
      target: { machine: 'xian-mac-m1' },
    }))).rejects.toThrow('remote_bridge_unknown_machine');
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it.each([
    ['disabled transport', { enabled: false }, 'remote_bridge_disabled'],
    ['short shared secret', { sharedSecret: 'short' }, 'remote_bridge_invalid_shared_secret'],
    ['missing machine URL', { bridgeUrls: {} }, 'remote_bridge_unknown_machine'],
    ['invalid machine URL', { bridgeUrls: { [MACHINE]: 'file:///tmp/bridge.sock' } }, 'remote_bridge_invalid_bridge_url'],
    ['invalid Brain URL', { brainUrl: 'ftp://brain.internal' }, 'remote_bridge_invalid_brain_url'],
  ])('fails closed for %s without making a request', async (_case, config, errorCode) => {
    const fetchFn = vi.fn();
    const transport = createTransport({ fetchFn, ...config });

    await expect(transport.prepare(prepareInput())).rejects.toThrow(errorCode);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects inherited URL-map keys as unknown machines', async () => {
    const bridgeUrls = Object.create({ [MACHINE]: BRIDGE_URL });
    const fetchFn = vi.fn();
    const transport = createTransport({ bridgeUrls, fetchFn });

    await expect(transport.prepare(prepareInput())).rejects.toThrow(
      'remote_bridge_unknown_machine',
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    ['attempt id', { attempt: { id: '' } }, 'remote_bridge_invalid_attempt_id'],
    ['run id', { attempt: { run_id: '' } }, 'remote_bridge_invalid_run_id'],
    ['lease owner', { attempt: { lease_owner: '' } }, 'remote_bridge_invalid_lease_owner'],
    ['callback token', { attempt: { callbackSecret: '' } }, 'remote_bridge_invalid_callback_token'],
    ['machine', { target: { machine: '' } }, 'remote_bridge_invalid_machine'],
  ])('requires a nonempty %s before prepare', async (_field, inputOverride, errorCode) => {
    const fetchFn = vi.fn();
    const transport = createTransport({ fetchFn });

    await expect(transport.prepare(prepareInput(inputOverride))).rejects.toThrow(errorCode);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    [200, 'remote_bridge_prepare_http_200'],
    [301, 'remote_bridge_prepare_http_301'],
    [302, 'remote_bridge_prepare_http_302'],
    [307, 'remote_bridge_prepare_http_307'],
    [308, 'remote_bridge_prepare_http_308'],
    [409, 'remote_bridge_prepare_conflict'],
    [500, 'remote_bridge_prepare_http_500'],
  ])('accepts only HTTP 202 (received %s)', async (status, errorCode) => {
    const fetchFn = vi.fn(async () => jsonResponse(status, { secret: CALLBACK_TOKEN }));
    const transport = createTransport({ fetchFn });

    const prepare = transport.prepare(prepareInput());

    await expect(prepare).rejects.toThrow(errorCode);
    await expect(prepare).rejects.not.toThrow(CALLBACK_TOKEN);
  });

  it.each([
    ['non-accepted response', { status: 'queued' }, 'remote_bridge_prepare_not_accepted'],
    ['empty job id', {
      job_id: '',
      attestation: '0'.repeat(64),
    }, 'remote_bridge_prepare_invalid_job_id'],
    ['mismatched machine', { actual_machine_id: 'xian-mac-m1' }, 'remote_bridge_machine_mismatch'],
    ['bad attestation', { attestation: '0'.repeat(64) }, 'remote_bridge_attestation_invalid'],
    ['uppercase attestation', {
      attestation: signMachineAttestation({
        secret: SHARED_SECRET,
        attemptId: 'attempt-1',
        machineId: MACHINE,
        jobId: 'job-1',
      }).toUpperCase(),
    }, 'remote_bridge_attestation_invalid'],
  ])('rejects a 202 response with %s', async (_case, responseOverride, errorCode) => {
    const fetchFn = vi.fn(async () => jsonResponse(
      202,
      acceptedPrepareResponse(responseOverride),
    ));
    const transport = createTransport({ fetchFn });

    await expect(transport.prepare(prepareInput())).rejects.toThrow(errorCode);
  });

  it('rejects malformed JSON with a sanitized error', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 202,
      json: async () => {
        throw new Error(`parser exposed ${SHARED_SECRET} ${CALLBACK_TOKEN}`);
      },
    }));
    const transport = createTransport({ fetchFn });

    const prepare = transport.prepare(prepareInput());

    await expect(prepare).rejects.toThrow('remote_bridge_prepare_invalid_json');
    await expect(prepare).rejects.not.toThrow(SHARED_SECRET);
    await expect(prepare).rejects.not.toThrow(CALLBACK_TOKEN);
  });

  it('aborts timed-out requests and reports a sanitized timeout', async () => {
    const fetchFn = vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        reject(new Error(`aborted ${SHARED_SECRET} ${CALLBACK_TOKEN}`));
      }, { once: true });
    }));
    const transport = createTransport({ fetchFn, timeoutMs: 5 });

    const prepare = transport.prepare(prepareInput());

    await expect(prepare).rejects.toThrow('remote_bridge_prepare_timeout');
    await expect(prepare).rejects.not.toThrow(SHARED_SECRET);
    await expect(prepare).rejects.not.toThrow(CALLBACK_TOKEN);
    expect(fetchFn.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('sanitizes network failures', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error(`network exposed ${SHARED_SECRET} ${CALLBACK_TOKEN}`);
    });
    const transport = createTransport({ fetchFn });

    const prepare = transport.prepare(prepareInput());

    await expect(prepare).rejects.toThrow('remote_bridge_prepare_request_failed');
    await expect(prepare).rejects.not.toThrow(SHARED_SECRET);
    await expect(prepare).rejects.not.toThrow(CALLBACK_TOKEN);
  });
});

describe('remote Bridge operation deadlines', () => {
  it.each(['prepare', 'inspect', 'cancel'])(
    'keeps the %s deadline active while consuming the response body',
    async (operation) => {
      let requestSignal;
      const fetchFn = vi.fn(async (_url, options) => {
        requestSignal = options.signal;
        return {
          ok: true,
          status: operation === 'prepare' ? 202 : 200,
          json: () => new Promise((_resolve, reject) => {
            requestSignal.addEventListener('abort', () => {
              reject(new Error(`body exposed ${SHARED_SECRET} ${CALLBACK_TOKEN}`));
            }, { once: true });
          }),
        };
      });
      const transport = createTransport({ fetchFn, timeoutMs: 5 });

      const outcome = await Promise.race([
        transport[operation](operationInput(operation)).then(
          () => ({ status: 'resolved' }),
          (error) => ({ status: 'rejected', message: error.message }),
        ),
        new Promise((resolve) => {
          setTimeout(() => resolve({ status: 'hung' }), 50);
        }),
      ]);

      expect(outcome).toEqual({
        status: 'rejected',
        message: `remote_bridge_${operation}_timeout`,
      });
      expect(requestSignal.aborted).toBe(true);
      expect(outcome.message).not.toContain(SHARED_SECRET);
      expect(outcome.message).not.toContain(CALLBACK_TOKEN);
    },
  );
});

describe('remote Bridge unread response cleanup', () => {
  it.each([
    [
      'prepare',
      409,
      { status: 'rejected', message: 'remote_bridge_prepare_conflict' },
    ],
    [
      'prepare',
      503,
      { status: 'rejected', message: 'remote_bridge_prepare_http_503' },
    ],
    [
      'inspect',
      404,
      { status: 'resolved', value: { status: 'missing', httpStatus: 404 } },
    ],
    [
      'inspect',
      503,
      { status: 'rejected', message: 'remote_bridge_inspect_http_503' },
    ],
    [
      'cancel',
      404,
      { status: 'resolved', value: { status: 'missing', httpStatus: 404 } },
    ],
    [
      'cancel',
      503,
      { status: 'rejected', message: 'remote_bridge_cancel_http_503' },
    ],
  ])(
    'closes an unread %s HTTP %s response without changing its outcome',
    async (operation, httpStatus, expectedOutcome) => {
      let resolveConnectionClosed;
      const connectionClosed = new Promise((resolve) => {
        resolveConnectionClosed = resolve;
      });
      const server = createServer((_request, response) => {
        response.writeHead(httpStatus, { 'Content-Type': 'application/json' });
        response.write('{"stream":"');
        const streamInterval = setInterval(() => response.write('x'), 10);
        response.once('close', () => {
          clearInterval(streamInterval);
          resolveConnectionClosed();
        });
      });

      try {
        const bridgeUrl = await listenOnLoopback(server);
        const transport = createTransport({
          bridgeUrls: { [MACHINE]: bridgeUrl },
          fetchFn: globalThis.fetch,
          timeoutMs: 1000,
        });

        const outcome = await transport[operation](operationInput(operation)).then(
          (value) => ({ status: 'resolved', value }),
          (error) => ({ status: 'rejected', message: error.message }),
        );

        expect(outcome).toEqual(expectedOutcome);
        expect(await resolvesWithin(connectionClosed, 100)).toBe(true);
      } finally {
        await closeServer(server);
      }
    },
  );
});

describe('remote Bridge redirect policy', () => {
  it.each(['prepare', 'inspect', 'cancel'])(
    'locks %s requests to redirect:error',
    async (operation) => {
      const fetchFn = vi.fn(async () => jsonResponse(
        operation === 'prepare' ? 202 : 200,
        operation === 'prepare'
          ? acceptedPrepareResponse()
          : { status: 'running' },
      ));
      const transport = createTransport({ fetchFn });

      await transport[operation](operationInput(operation));

      expect(fetchFn.mock.calls[0][1].redirect).toBe('error');
    },
  );

  it('does not send sensitive prepare JSON to a 307 redirect target', async () => {
    let redirectedBody = '';
    let targetUrl;
    const targetServer = createServer(async (request, response) => {
      request.setEncoding('utf8');
      for await (const chunk of request) {
        redirectedBody += chunk;
      }
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end('{}');
    });
    const redirectServer = createServer((request, response) => {
      request.resume();
      response.writeHead(307, { Location: `${targetUrl}/capture` });
      response.end();
    });

    try {
      targetUrl = await listenOnLoopback(targetServer);
      const redirectUrl = await listenOnLoopback(redirectServer);
      const transport = createTransport({
        bridgeUrls: { [MACHINE]: redirectUrl },
        fetchFn: globalThis.fetch,
        timeoutMs: 1000,
      });

      let prepareError;
      try {
        await transport.prepare(prepareInput());
      } catch (error) {
        prepareError = error;
      }

      expect(prepareError?.message).toBe('remote_bridge_prepare_request_failed');
      expect(prepareError?.message).not.toContain(SHARED_SECRET);
      expect(prepareError?.message).not.toContain(CALLBACK_TOKEN);
      expect(redirectedBody).toBe('');
      expect(redirectedBody).not.toContain(CALLBACK_TOKEN);
      expect(redirectedBody).not.toContain('do the work');
    } finally {
      await Promise.all([
        closeServer(redirectServer),
        closeServer(targetServer),
      ]);
    }
  });
});

describe('remote Bridge inspect', () => {
  it('gets the allowlisted attempt URL with bearer authentication and returns JSON', async () => {
    const responseBody = { status: 'running', job_id: 'job-1' };
    const fetchFn = vi.fn(async () => jsonResponse(200, responseBody));
    const transport = createTransport({ fetchFn });

    await expect(transport.inspect({
      attempt: { id: 'attempt-1' },
      target: { machine: MACHINE },
    })).resolves.toEqual(responseBody);
    expect(fetchFn).toHaveBeenCalledWith(
      `${BRIDGE_URL}/harness/attempts/attempt-1`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${SHARED_SECRET}` },
        signal: expect.any(AbortSignal),
        redirect: 'error',
      },
    );
  });

  it.each([
    [404, { status: 'missing', httpStatus: 404 }],
    [409, { status: 'conflict', httpStatus: 409 }],
  ])('returns a structured result for HTTP %s', async (status, expected) => {
    const fetchFn = vi.fn(async () => jsonResponse(status, { ignored: true }));
    const transport = createTransport({ fetchFn });

    await expect(transport.inspect({
      attempt: { id: 'attempt-1' },
      target: { machine: MACHINE },
    })).resolves.toEqual(expected);
  });

  it('throws on other non-success responses', async () => {
    const transport = createTransport({
      fetchFn: vi.fn(async () => jsonResponse(503, { token: CALLBACK_TOKEN })),
    });

    await expect(transport.inspect({
      attempt: { id: 'attempt-1' },
      target: { machine: MACHINE },
    })).rejects.toThrow('remote_bridge_inspect_http_503');
  });
});

describe('remote Bridge cancel', () => {
  it.each(['cleaned', 'already_clean', 'quarantined'])(
    'posts the lease identity and accepts exact %s Worker JSON',
    async (status) => {
      const responseBody = { status, attempt_id: 'attempt-1' };
      const fetchFn = vi.fn(async () => jsonResponse(200, responseBody));
      const transport = createTransport({ fetchFn });

      await expect(transport.cancel({
        attempt: {
          id: 'attempt-1',
          lease_owner: 'dispatcher-1',
          lease_generation: 3,
        },
        target: { machine: MACHINE },
      })).resolves.toEqual(responseBody);
      expect(fetchFn).toHaveBeenCalledWith(
        `${BRIDGE_URL}/harness/attempts/attempt-1/cancel`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${SHARED_SECRET}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            lease_owner: 'dispatcher-1',
            lease_generation: 3,
          }),
          signal: expect.any(AbortSignal),
          redirect: 'error',
        },
      );
    },
  );

  it.each([
    ['null body', null, 'remote_bridge_cancel_invalid_response'],
    ['array body', [], 'remote_bridge_cancel_invalid_response'],
    [
      'missing Attempt identity',
      { status: 'cleaned' },
      'remote_bridge_cancel_invalid_attempt_id',
    ],
    [
      'mismatched Attempt identity',
      { status: 'cleaned', attempt_id: 'stale-attempt' },
      'remote_bridge_cancel_attempt_mismatch',
    ],
    [
      'non-protocol status',
      { status: 'cancelled', attempt_id: 'attempt-1' },
      'remote_bridge_cancel_invalid_status',
    ],
  ])('rejects a 2xx response with %s', async (_case, body, errorCode) => {
    const transport = createTransport({
      fetchFn: vi.fn(async () => jsonResponse(200, body)),
    });

    await expect(transport.cancel(operationInput('cancel'))).rejects.toThrow(errorCode);
  });

  it('rejects malformed cancel JSON with a bounded error', async () => {
    const transport = createTransport({
      fetchFn: vi.fn(async () => ({
        ok: true,
        status: 200,
        json: vi.fn(async () => {
          throw new Error(`parser exposed ${SHARED_SECRET} ${CALLBACK_TOKEN}`);
        }),
      })),
    });

    const cancel = transport.cancel(operationInput('cancel'));

    await expect(cancel).rejects.toThrow('remote_bridge_cancel_invalid_json');
    await expect(cancel).rejects.not.toThrow(SHARED_SECRET);
    await expect(cancel).rejects.not.toThrow(CALLBACK_TOKEN);
  });

  it.each([
    [404, { status: 'missing', httpStatus: 404 }],
    [409, { status: 'rejected', httpStatus: 409 }],
  ])('returns a structured result for HTTP %s', async (status, expected) => {
    const fetchFn = vi.fn(async () => jsonResponse(status, { ignored: true }));
    const transport = createTransport({ fetchFn });

    await expect(transport.cancel({
      attempt: {
        id: 'attempt-1',
        lease_owner: 'dispatcher-1',
        lease_generation: 3,
      },
      target: { machine: MACHINE },
    })).resolves.toEqual(expected);
  });

  it('requires the lease owner and generation before cancelling', async () => {
    const fetchFn = vi.fn();
    const transport = createTransport({ fetchFn });

    await expect(transport.cancel({
      attempt: { id: 'attempt-1', lease_owner: '' },
      target: { machine: MACHINE },
    })).rejects.toThrow('remote_bridge_invalid_lease_owner');
    await expect(transport.cancel({
      attempt: { id: 'attempt-1', lease_owner: 'dispatcher-1', lease_generation: -1 },
      target: { machine: MACHINE },
    })).rejects.toThrow('remote_bridge_invalid_lease_generation');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('throws on other non-success responses', async () => {
    const transport = createTransport({
      fetchFn: vi.fn(async () => jsonResponse(500, { token: CALLBACK_TOKEN })),
    });

    await expect(transport.cancel({
      attempt: {
        id: 'attempt-1',
        lease_owner: 'dispatcher-1',
        lease_generation: 3,
      },
      target: { machine: MACHINE },
    })).rejects.toThrow('remote_bridge_cancel_http_500');
  });
});
