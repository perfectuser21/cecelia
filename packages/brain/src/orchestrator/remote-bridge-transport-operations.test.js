import { describe, expect, it, vi } from 'vitest';
import {
  SHARED_SECRET,
  CALLBACK_TOKEN,
  BRIDGE_URL,
  MACHINE,
  jsonResponse,
  createTransport,
  operationInput
} from './remote-bridge-transport.fixture.js';

describe('remote Bridge inspect', () => {
  it('posts only the lease identity to the allowlisted inspect action', async () => {
    const responseBody = {
      status: 'running',
      attempt_id: 'attempt-1',
      container_id: 'job-1',
    };
    const fetchFn = vi.fn(async () => jsonResponse(200, responseBody));
    const transport = createTransport({ fetchFn });

    await expect(transport.inspect({
      attempt: {
        id: 'attempt-1',
        lease_owner: 'dispatcher-1',
        lease_generation: 3,
        callbackSecret: CALLBACK_TOKEN,
        opaque: 'must-not-be-sent',
      },
      target: { machine: MACHINE },
    })).resolves.toEqual(responseBody);
    expect(fetchFn).toHaveBeenCalledWith(
      `${BRIDGE_URL}/harness/attempts/attempt-1/inspect`,
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
    expect(fetchFn.mock.calls[0][1].body).not.toContain(CALLBACK_TOKEN);
    expect(fetchFn.mock.calls[0][1].body).not.toContain('opaque');
  });

  it.each([
    ['Attempt identity', { id: '' }, 'remote_bridge_invalid_attempt_id'],
    [
      'lease owner',
      { id: 'attempt-1', lease_owner: '' },
      'remote_bridge_invalid_lease_owner',
    ],
    [
      'lease generation',
      { id: 'attempt-1', lease_owner: 'dispatcher-1', lease_generation: -1 },
      'remote_bridge_invalid_lease_generation',
    ],
  ])('rejects invalid inspect %s before transport', async (_field, attempt, errorCode) => {
    const fetchFn = vi.fn();
    const transport = createTransport({ fetchFn });

    await expect(transport.inspect({
      attempt,
      target: { machine: MACHINE },
    })).rejects.toThrow(errorCode);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('treats a generic HTTP 404 as unavailable, never as exact missing evidence', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(404, { ignored: true }));
    const transport = createTransport({ fetchFn });

    await expect(transport.inspect({
      attempt: {
        id: 'attempt-1',
        lease_owner: 'dispatcher-1',
        lease_generation: 3,
      },
      target: { machine: MACHINE },
    })).rejects.toThrow('remote_bridge_inspect_http_404');
  });

  it('accepts exact Worker missing evidence only from a successful response', async () => {
    const responseBody = { status: 'missing', attempt_id: 'attempt-1' };
    const fetchFn = vi.fn(async () => jsonResponse(200, responseBody));
    const transport = createTransport({ fetchFn });

    await expect(transport.inspect({
      attempt: {
        id: 'attempt-1',
        lease_owner: 'dispatcher-1',
        lease_generation: 3,
      },
      target: { machine: MACHINE },
    })).resolves.toEqual(responseBody);
  });

  it('returns a structured result for HTTP 409', async () => {
    const status = 409;
    const expected = { status: 'conflict', attempt_id: 'attempt-1', httpStatus: 409 };
    const fetchFn = vi.fn(async () => jsonResponse(status, { ignored: true }));
    const transport = createTransport({ fetchFn });

    await expect(transport.inspect({
      attempt: {
        id: 'attempt-1',
        lease_owner: 'dispatcher-1',
        lease_generation: 3,
      },
      target: { machine: MACHINE },
    })).resolves.toEqual(expected);
  });

  it('throws on other non-success responses', async () => {
    const transport = createTransport({
      fetchFn: vi.fn(async () => jsonResponse(503, { token: CALLBACK_TOKEN })),
    });

    await expect(transport.inspect({
      attempt: {
        id: 'attempt-1',
        lease_owner: 'dispatcher-1',
        lease_generation: 3,
      },
      target: { machine: MACHINE },
    })).rejects.toThrow('remote_bridge_inspect_http_503');
  });

  it.each([
    ['null body', null, 'remote_bridge_inspect_invalid_response'],
    ['array body', [], 'remote_bridge_inspect_invalid_response'],
    [
      'missing Attempt identity',
      { status: 'running' },
      'remote_bridge_inspect_invalid_attempt_id',
    ],
    [
      'mismatched Attempt identity',
      { status: 'running', attempt_id: 'stale-attempt' },
      'remote_bridge_inspect_attempt_mismatch',
    ],
    [
      'non-protocol status',
      { status: 'invented', attempt_id: 'attempt-1' },
      'remote_bridge_inspect_invalid_status',
    ],
  ])('rejects a 2xx response with %s', async (_case, body, errorCode) => {
    const transport = createTransport({
      fetchFn: vi.fn(async () => jsonResponse(200, body)),
    });

    await expect(transport.inspect({
      attempt: {
        id: 'attempt-1',
        lease_owner: 'dispatcher-1',
        lease_generation: 3,
      },
      target: { machine: MACHINE },
    })).rejects.toThrow(errorCode);
  });

  it('rejects malformed inspect JSON with a bounded error', async () => {
    const transport = createTransport({
      fetchFn: vi.fn(async () => ({
        ok: true,
        status: 200,
        json: vi.fn(async () => {
          throw new Error(`parser exposed ${SHARED_SECRET} ${CALLBACK_TOKEN}`);
        }),
      })),
    });

    const inspect = transport.inspect({
      attempt: {
        id: 'attempt-1',
        lease_owner: 'dispatcher-1',
        lease_generation: 3,
      },
      target: { machine: MACHINE },
    });

    await expect(inspect).rejects.toThrow('remote_bridge_inspect_invalid_json');
    await expect(inspect).rejects.not.toThrow(SHARED_SECRET);
    await expect(inspect).rejects.not.toThrow(CALLBACK_TOKEN);
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
