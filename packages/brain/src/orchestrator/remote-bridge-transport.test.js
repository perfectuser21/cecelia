import { describe, expect, it, vi } from 'vitest';
import {
  SHARED_SECRET,
  CALLBACK_TOKEN,
  BRIDGE_URL,
  BRAIN_URL,
  MACHINE,
  ENVELOPE,
  jsonResponse,
  prepareInput,
  acceptedPrepareResponse,
  createTransport,
  operationInput,
  cleanupReceipt
} from './remote-bridge-transport.fixture.js';

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

  it('accepts a bounded terminal tombstone when start is replayed after response loss', async () => {
    const fetchFn = vi.fn()
      .mockRejectedValueOnce(new Error('response lost after Worker start'))
      .mockResolvedValueOnce(jsonResponse(200, {
        status: 'terminal',
        attempt_id: 'attempt-1',
        terminal_status: 'cleaned',
        credential: 'must-not-cross',
      }));
    const transport = createTransport({ fetchFn });

    await expect(transport.start(operationInput('start'))).rejects.toThrow(
      'remote_bridge_start_request_failed',
    );
    await expect(transport.start(operationInput('start'))).resolves.toEqual({
      status: 'terminal',
      attempt_id: 'attempt-1',
      terminal_status: 'cleaned',
    });
  });

  it.each([
    [undefined, 'remote_bridge_start_invalid_terminal_status'],
    ['unknown-terminal', 'remote_bridge_start_invalid_terminal_status'],
  ])('rejects malformed terminal start status %j', async (terminalStatus, errorCode) => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {
      status: 'terminal',
      attempt_id: 'attempt-1',
      ...(terminalStatus === undefined ? {} : { terminal_status: terminalStatus }),
    }));
    const transport = createTransport({ fetchFn });

    await expect(transport.start(operationInput('start'))).rejects.toThrow(errorCode);
  });

  it('rejects a terminal start tombstone for a different Attempt', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {
      status: 'terminal',
      attempt_id: 'attempt-2',
      terminal_status: 'cleaned',
    }));
    const transport = createTransport({ fetchFn });

    await expect(transport.start(operationInput('start'))).rejects.toThrow(
      'remote_bridge_start_attempt_mismatch',
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

  it('accepts an attested retained-candidate terminal receipt', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, cleanupReceipt({
      status: 'retained',
    })));
    const transport = createTransport({ fetchFn });

    await expect(transport.terminal(operationInput('terminal'))).resolves.toEqual({
      status: 'retained',
      attempt_id: 'attempt-1',
      actual_machine_id: MACHINE,
      attestation_status: 'verified',
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

});
