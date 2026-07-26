import { createServer } from 'node:http';

import { describe, expect, it, vi } from 'vitest';

import { signMachineAttestation } from './machine-attestation.js';
import { createRemoteBridgeTransport } from './remote-bridge-transport.js';

const SHARED_SECRET = 'bridge-secret-that-is-at-least-32-bytes';
const CALLBACK_TOKEN = 'callback-token-that-must-never-leak';
const BRIDGE_URL = 'http://100.86.57.69:3458';
const BRAIN_URL = 'http://brain.internal:5221';
const MACHINE = 'xian-mac-m4';

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn(async () => body),
  };
}

function launchInput(overrides = {}) {
  const attempt = {
    id: 'attempt-1',
    run_id: 'run-1',
    lease_owner: 'dispatcher-1',
    lease_generation: 3,
    callbackSecret: CALLBACK_TOKEN,
    ...overrides.attempt,
  };
  const bundle = { opaque: 'must-not-be-sent', ...overrides.bundle };
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

function acceptedLaunchResponse(overrides = {}) {
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
    fetchFn: vi.fn(async () => jsonResponse(202, acceptedLaunchResponse())),
    ...overrides,
  });
}

function operationInput(operation) {
  if (operation === 'launch') return launchInput();
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

describe('remote Bridge launch', () => {
  it('posts the allowlisted payload with bearer authentication and verifies the receipt', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(202, acceptedLaunchResponse()));
    const transport = createTransport({ fetchFn });

    await expect(transport.launch(launchInput())).resolves.toEqual({
      jobId: 'job-1',
      actualMachineId: MACHINE,
      executionTransport: 'remote-bridge',
      remoteJobId: 'job-1',
      attestationStatus: 'verified',
    });
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(fetchFn).toHaveBeenCalledWith(
      `${BRIDGE_URL}/harness/attempts`,
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
      target: {
        provider: 'codex',
        account: 'team3',
        machine: MACHINE,
      },
      provider_spec: {
        provider: 'codex',
        command: 'codex',
        args: ['exec', '--json'],
        stdin: 'do the work',
        output: { format: 'jsonl' },
      },
      callback_url: `${BRAIN_URL}/api/brain/harness/attempts/attempt-1/callback`,
      callback_token: CALLBACK_TOKEN,
    });
    expect(requestBody).not.toHaveProperty('bundle');
    expect(requestBody.provider_spec).not.toHaveProperty('environment');
  });

  it('uses zero when lease generation is absent', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(202, acceptedLaunchResponse()));
    const transport = createTransport({ fetchFn });
    const input = launchInput();
    delete input.attempt.lease_generation;

    await transport.launch(input);

    expect(JSON.parse(fetchFn.mock.calls[0][1].body).lease_generation).toBe(0);
  });

  it('freezes a successful launch receipt', async () => {
    const transport = createTransport();

    const result = await transport.launch(launchInput());

    expect(Object.isFrozen(result)).toBe(true);
  });

  it('copies and freezes URL routing at construction instead of trusting later mutations', async () => {
    const bridgeUrls = { [MACHINE]: BRIDGE_URL };
    const fetchFn = vi.fn(async () => jsonResponse(202, acceptedLaunchResponse()));
    const transport = createTransport({ bridgeUrls, fetchFn });
    bridgeUrls[MACHINE] = 'http://attacker.invalid:9000';
    bridgeUrls['xian-mac-m1'] = 'http://attacker.invalid:9001';

    await transport.launch(launchInput());

    expect(fetchFn.mock.calls[0][0]).toBe(`${BRIDGE_URL}/harness/attempts`);
    await expect(transport.launch(launchInput({
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

    await expect(transport.launch(launchInput())).rejects.toThrow(errorCode);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects inherited URL-map keys as unknown machines', async () => {
    const bridgeUrls = Object.create({ [MACHINE]: BRIDGE_URL });
    const fetchFn = vi.fn();
    const transport = createTransport({ bridgeUrls, fetchFn });

    await expect(transport.launch(launchInput())).rejects.toThrow(
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
  ])('requires a nonempty %s before launch', async (_field, inputOverride, errorCode) => {
    const fetchFn = vi.fn();
    const transport = createTransport({ fetchFn });

    await expect(transport.launch(launchInput(inputOverride))).rejects.toThrow(errorCode);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    [200, 'remote_bridge_launch_http_200'],
    [301, 'remote_bridge_launch_http_301'],
    [302, 'remote_bridge_launch_http_302'],
    [307, 'remote_bridge_launch_http_307'],
    [308, 'remote_bridge_launch_http_308'],
    [409, 'remote_bridge_launch_conflict'],
    [500, 'remote_bridge_launch_http_500'],
  ])('accepts only HTTP 202 (received %s)', async (status, errorCode) => {
    const fetchFn = vi.fn(async () => jsonResponse(status, { secret: CALLBACK_TOKEN }));
    const transport = createTransport({ fetchFn });

    const launch = transport.launch(launchInput());

    await expect(launch).rejects.toThrow(errorCode);
    await expect(launch).rejects.not.toThrow(CALLBACK_TOKEN);
  });

  it.each([
    ['non-accepted response', { status: 'queued' }, 'remote_bridge_launch_not_accepted'],
    ['empty job id', {
      job_id: '',
      attestation: '0'.repeat(64),
    }, 'remote_bridge_launch_invalid_job_id'],
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
      acceptedLaunchResponse(responseOverride),
    ));
    const transport = createTransport({ fetchFn });

    await expect(transport.launch(launchInput())).rejects.toThrow(errorCode);
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

    const launch = transport.launch(launchInput());

    await expect(launch).rejects.toThrow('remote_bridge_launch_invalid_json');
    await expect(launch).rejects.not.toThrow(SHARED_SECRET);
    await expect(launch).rejects.not.toThrow(CALLBACK_TOKEN);
  });

  it('aborts timed-out requests and reports a sanitized timeout', async () => {
    const fetchFn = vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        reject(new Error(`aborted ${SHARED_SECRET} ${CALLBACK_TOKEN}`));
      }, { once: true });
    }));
    const transport = createTransport({ fetchFn, timeoutMs: 5 });

    const launch = transport.launch(launchInput());

    await expect(launch).rejects.toThrow('remote_bridge_launch_timeout');
    await expect(launch).rejects.not.toThrow(SHARED_SECRET);
    await expect(launch).rejects.not.toThrow(CALLBACK_TOKEN);
    expect(fetchFn.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('sanitizes network failures', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error(`network exposed ${SHARED_SECRET} ${CALLBACK_TOKEN}`);
    });
    const transport = createTransport({ fetchFn });

    const launch = transport.launch(launchInput());

    await expect(launch).rejects.toThrow('remote_bridge_launch_request_failed');
    await expect(launch).rejects.not.toThrow(SHARED_SECRET);
    await expect(launch).rejects.not.toThrow(CALLBACK_TOKEN);
  });
});

describe('remote Bridge operation deadlines', () => {
  it.each(['launch', 'inspect', 'cancel'])(
    'keeps the %s deadline active while consuming the response body',
    async (operation) => {
      let requestSignal;
      const fetchFn = vi.fn(async (_url, options) => {
        requestSignal = options.signal;
        return {
          ok: true,
          status: operation === 'launch' ? 202 : 200,
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

describe('remote Bridge redirect policy', () => {
  it.each(['launch', 'inspect', 'cancel'])(
    'locks %s requests to redirect:error',
    async (operation) => {
      const fetchFn = vi.fn(async () => jsonResponse(
        operation === 'launch' ? 202 : 200,
        operation === 'launch'
          ? acceptedLaunchResponse()
          : { status: 'running' },
      ));
      const transport = createTransport({ fetchFn });

      await transport[operation](operationInput(operation));

      expect(fetchFn.mock.calls[0][1].redirect).toBe('error');
    },
  );

  it('does not send sensitive launch JSON to a 307 redirect target', async () => {
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

      let launchError;
      try {
        await transport.launch(launchInput());
      } catch (error) {
        launchError = error;
      }

      expect(launchError?.message).toBe('remote_bridge_launch_request_failed');
      expect(launchError?.message).not.toContain(SHARED_SECRET);
      expect(launchError?.message).not.toContain(CALLBACK_TOKEN);
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
  it('posts the lease identity with bearer authentication and returns JSON', async () => {
    const responseBody = { status: 'cancelled', job_id: 'job-1' };
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
