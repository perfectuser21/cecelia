import { createHash, createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  store: {
    getById: vi.fn(),
    assertFreshRoleSession: vi.fn(),
    persistFleetResultReceipt: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
  },
  pool: { query: vi.fn() },
}));

const require = createRequire(import.meta.url);
const { finalizeRoleResult } = require(
  '../../../../../docker/cecelia-runner/result-channel-finalizer.cjs',
);

vi.mock('../../orchestrator/attempt-store.js', () => ({
  createAttemptStore: () => mocks.store,
}));
vi.mock('../../db.js', () => ({ default: mocks.pool }));
vi.mock('../../lib/harness-thread-lookup.js', () => ({ lookupHarnessThread: vi.fn() }));
vi.mock('../../notifier.js', () => ({ sendBark: vi.fn() }));
vi.mock('../../lib/harness-orphan-guard.js', () => ({
  handleRelayExitConsistency: vi.fn(async () => ({ action: 'noop' })),
}));

const secret = 'kernel-fleet-bridge-secret-at-least-32-bytes';
const attemptId = '22222222-2222-4222-8222-222222222222';
const runId = '11111111-1111-4111-8111-111111111111';
const deliveryId = '55555555-5555-4555-8555-555555555555';
const resultNonce = '66666666-6666-4666-8666-666666666666';
const receiptId = '77777777-7777-4777-8777-777777777777';
const taskId = '44444444-4444-4444-8444-444444444444';
const workerId = 'xian-mac-m4';
const jobId = 'job-7';
const leaseOwner = 'brain-1:123';
const leaseGeneration = 2;
const persistedAt = '2026-07-28T01:00:00.000Z';
const sprintDir = 'sprints/07280905-kernel-result-channel-bootstrap';

const result = finalizeRoleResult({
  expectedOutput: 'harness-result/planner-v1',
  binding: {
    task_id: taskId,
    run_id: runId,
    attempt_id: attemptId,
    role: 'planner',
  },
  providerResult: {
    contract_version: '1.0',
    attempt_id: attemptId,
    status: 'completed',
    summary: 'planner finished',
    artifacts: [],
    checks: [],
    decision: null,
    error: null,
    provider_metadata: { provider: 'claude', session_id: 'session-1' },
  },
  rawEnvelope: {
    verdict: 'DONE',
    branch: 'cp-result-channel',
    sprint_dir: sprintDir,
    planner_branch: 'cp-result-channel',
    review_required: false,
    status: 'DONE',
  },
  verifierEnvelope: {
    branch: 'cp-result-channel',
    sprint_dir: sprintDir,
    planner_branch: 'cp-result-channel',
    prd_sha256: `sha256:${'a'.repeat(64)}`,
    effective_review_required: false,
  },
});

function fleetAttempt(overrides = {}) {
  return {
    id: attemptId,
    run_id: runId,
    role: 'planner',
    provider: 'claude',
    provider_session_id: 'session-1',
    status: 'running',
    lease_owner: leaseOwner,
    lease_generation: leaseGeneration,
    requested_machine_id: workerId,
    actual_machine_id: workerId,
    execution_transport: 'fleet-worker',
    remote_job_id: jobId,
    machine_attestation_status: 'verified',
    task_bundle: {
      run_id: runId,
      attempt_id: attemptId,
      role: 'planner',
      expected_output: 'harness-result/planner-v1',
      inputs: { task_id: taskId, sprint_dir: sprintDir },
      result_channel: {
        version: 'attempt-result-file/v1',
        path: `/tmp/cecelia-prompts/${attemptId}.result.json`,
        max_bytes: 1024 * 1024,
        bindings: {
          task_id: taskId,
          run_id: runId,
          attempt_id: attemptId,
          role: 'planner',
        },
      },
    },
    ...overrides,
  };
}

function deliveryBody(resultValue = result, overrides = {}) {
  const raw = Buffer.from(JSON.stringify(resultValue), 'utf8');
  return {
    schema_version: 'fleet-attempt-result-delivery/v1',
    delivery_id: deliveryId,
    result_nonce: resultNonce,
    result_sha256: createHash('sha256').update(raw).digest('hex'),
    result_bytes: raw.length,
    terminal_status: resultValue.status,
    result_b64: raw.toString('base64'),
    ...overrides,
  };
}

function callbackSignature(body, headers) {
  const values = [
    'cecelia-fleet-callback/v1',
    attemptId,
    headers['X-Cecelia-Fleet-Worker-Id'],
    headers['X-Cecelia-Fleet-Run-Id'],
    headers['X-Cecelia-Fleet-Job-Id'],
    headers['X-Cecelia-Fleet-Lease-Owner'],
    headers['X-Cecelia-Fleet-Lease-Generation'],
    headers['X-Cecelia-Fleet-Delivery-Id'],
    headers['X-Cecelia-Fleet-Result-Sha256'],
    body.result_nonce,
    String(body.result_bytes),
    body.terminal_status,
    body.result_b64,
  ];
  return createHmac('sha256', secret).update(`${values.join('\n')}\n`, 'utf8').digest('hex');
}

function signedHeaders(body, overrides = {}) {
  const headers = {
    'X-Cecelia-Fleet-Protocol': 'fleet-callback/v1',
    'X-Cecelia-Fleet-Worker-Id': workerId,
    'X-Cecelia-Fleet-Run-Id': runId,
    'X-Cecelia-Fleet-Job-Id': jobId,
    'X-Cecelia-Fleet-Lease-Owner': leaseOwner,
    'X-Cecelia-Fleet-Lease-Generation': String(leaseGeneration),
    'X-Cecelia-Fleet-Delivery-Id': body.delivery_id,
    'X-Cecelia-Fleet-Result-Sha256': body.result_sha256,
    ...overrides,
  };
  headers.Authorization = `Cecelia-Fleet-HMAC-SHA256 ${callbackSignature(body, headers)}`;
  return headers;
}

function postFleet(app, body, headerOverrides = {}) {
  const headers = signedHeaders(body, headerOverrides);
  let call = request(app).post(`/api/brain/harness/attempts/${attemptId}/callback`);
  for (const [name, value] of Object.entries(headers)) call = call.set(name, value);
  return call.send(body);
}

describe('Fleet durable Harness result callback', () => {
  let app;

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();
    mocks.store.getById.mockResolvedValue(fleetAttempt());
    mocks.store.assertFreshRoleSession.mockResolvedValue(true);
    mocks.store.persistFleetResultReceipt.mockResolvedValue({
      attempt: { ...fleetAttempt(), status: 'completed', result },
      receipt: {
        receipt_id: receiptId,
        attempt_id: attemptId,
        run_id: runId,
        task_id: taskId,
        role: 'planner',
        worker_id: workerId,
        job_id: jobId,
        lease_owner: leaseOwner,
        lease_generation: leaseGeneration,
        delivery_id: deliveryId,
        result_nonce: resultNonce,
        result_sha256: deliveryBody().result_sha256,
        result_bytes: deliveryBody().result_bytes,
        terminal_status: 'completed',
        persisted_at: persistedAt,
      },
      deduped: false,
    });
    const { default: router } = await import('../harness-callback.js');
    app = express();
    app.set('pool', mocks.pool);
    app.set('kernelFleetBridgeToken', secret);
    app.use(express.json({ limit: '4mb' }));
    app.use('/api/brain', router);
  });

  it('authenticates the exact delivery and returns a digest-bound signed receipt', async () => {
    const body = deliveryBody();
    const response = await postFleet(app, body);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      schema_version: 'fleet-attempt-result-receipt/v1',
      receipt_id: receiptId,
      attempt_id: attemptId,
      run_id: runId,
      worker_id: workerId,
      job_id: jobId,
      lease_owner: leaseOwner,
      lease_generation: leaseGeneration,
      delivery_id: deliveryId,
      result_nonce: resultNonce,
      result_sha256: body.result_sha256,
      result_bytes: body.result_bytes,
      terminal_status: 'completed',
      receipt_status: 'accepted',
      persisted_at: persistedAt,
      receipt_hmac: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(Object.keys(response.body).sort()).toEqual([
      'attempt_id',
      'delivery_id',
      'job_id',
      'lease_generation',
      'lease_owner',
      'persisted_at',
      'receipt_hmac',
      'receipt_id',
      'receipt_status',
      'result_bytes',
      'result_nonce',
      'result_sha256',
      'run_id',
      'schema_version',
      'terminal_status',
      'worker_id',
    ]);
    expect(mocks.store.persistFleetResultReceipt).toHaveBeenCalledWith(expect.objectContaining({
      attemptId,
      runId,
      taskId,
      workerId,
      jobId,
      leaseOwner,
      leaseGeneration,
      deliveryId,
      resultNonce,
      resultSha256: body.result_sha256,
      resultBytes: body.result_bytes,
      terminalStatus: 'completed',
      result,
    }));
  });

  it('returns the same receipt as deduped for an exact retry', async () => {
    mocks.store.persistFleetResultReceipt.mockResolvedValueOnce({
      ...(await mocks.store.persistFleetResultReceipt()),
      deduped: true,
    });
    const response = await postFleet(app, deliveryBody());

    expect(response.status).toBe(200);
    expect(response.body.receipt_id).toBe(receiptId);
    expect(response.body.receipt_status).toBe('deduped');
  });

  it('rejects a bad HMAC before persisting', async () => {
    const body = deliveryBody();
    const headers = signedHeaders(body);
    headers.Authorization = `Cecelia-Fleet-HMAC-SHA256 ${'0'.repeat(64)}`;
    let call = request(app).post(`/api/brain/harness/attempts/${attemptId}/callback`);
    for (const [name, value] of Object.entries(headers)) call = call.set(name, value);
    const response = await call.send(body);

    expect(response.status).toBe(401);
    expect(mocks.store.persistFleetResultReceipt).not.toHaveBeenCalled();
  });

  it('does not let a Fleet Attempt downgrade to the legacy Bearer callback', async () => {
    mocks.store.getById.mockResolvedValueOnce(fleetAttempt({
      callback_secret_hash: createHash('sha256').update('retained-token').digest('hex'),
    }));
    mocks.store.complete.mockResolvedValueOnce({
      attempt: { ...fleetAttempt(), status: 'completed', result },
      deduped: false,
    });

    const response = await request(app)
      .post(`/api/brain/harness/attempts/${attemptId}/callback`)
      .set('Authorization', 'Bearer retained-token')
      .set('X-Harness-Lease-Owner', leaseOwner)
      .send(result);

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('fleet_callback_hmac_required');
    expect(mocks.store.complete).not.toHaveBeenCalled();
    expect(mocks.store.persistFleetResultReceipt).not.toHaveBeenCalled();
  });

  it('rejects digest, byte-count and non-canonical base64 mismatches', async () => {
    const cases = [
      deliveryBody(result, { result_sha256: 'b'.repeat(64) }),
      deliveryBody(result, { result_bytes: 1 }),
      deliveryBody(result, { result_b64: `${deliveryBody().result_b64}\n` }),
    ];
    for (const body of cases) {
      const response = await postFleet(app, body);
      expect(response.status).toBe(400);
    }
    expect(mocks.store.persistFleetResultReceipt).not.toHaveBeenCalled();
  });

  it('requires the verified six-role result envelope for Fleet attempts', async () => {
    const withoutRoleResult = { ...result };
    delete withoutRoleResult.role_result;

    const response = await postFleet(app, deliveryBody(withoutRoleResult));

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('role_result_required_for_fleet_result');
    expect(mocks.store.persistFleetResultReceipt).not.toHaveBeenCalled();
  });

  it.each(['needs_context', 'blocked', 'failed', 'cancelled'])(
    'durably receipts the Runner pass-through terminal status %s without role evidence',
    async (status) => {
      const passThrough = {
        contract_version: '1.0',
        attempt_id: attemptId,
        status,
        summary: `${status} before verified role output`,
        artifacts: [],
        checks: [],
        decision: null,
        error: ['failed', 'cancelled'].includes(status)
          ? { code: 'provider_exit', message: status }
          : null,
        provider_metadata: { provider: 'claude', session_id: 'session-1' },
      };
      const body = deliveryBody(passThrough);
      mocks.store.persistFleetResultReceipt.mockResolvedValueOnce({
        attempt: { ...fleetAttempt(), status, result: passThrough },
        receipt: {
          receipt_id: receiptId,
          attempt_id: attemptId,
          run_id: runId,
          task_id: taskId,
          role: 'planner',
          worker_id: workerId,
          job_id: jobId,
          lease_owner: leaseOwner,
          lease_generation: leaseGeneration,
          delivery_id: deliveryId,
          result_nonce: resultNonce,
          result_sha256: body.result_sha256,
          result_bytes: body.result_bytes,
          terminal_status: status,
          persisted_at: persistedAt,
        },
        deduped: false,
      });

      const response = await postFleet(app, body);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        receipt_id: receiptId,
        terminal_status: status,
        receipt_status: 'accepted',
      });
      expect(mocks.store.persistFleetResultReceipt).toHaveBeenCalledWith(
        expect.objectContaining({ terminalStatus: status }),
      );
    },
  );

  it('rejects oversized raw bytes and malformed or non-UTF8 JSON', async () => {
    mocks.store.getById.mockResolvedValue(fleetAttempt({
      task_bundle: {
        ...fleetAttempt().task_bundle,
        result_channel: {
          ...fleetAttempt().task_bundle.result_channel,
          max_bytes: 16,
        },
      },
    }));
    const oversized = deliveryBody();
    const malformedRaw = Buffer.from('{', 'utf8');
    const malformed = deliveryBody(result, {
      result_b64: malformedRaw.toString('base64'),
      result_bytes: malformedRaw.length,
      result_sha256: createHash('sha256').update(malformedRaw).digest('hex'),
    });
    const invalidUtf8Raw = Buffer.from([0xc3, 0x28]);
    const invalidUtf8 = deliveryBody(result, {
      result_b64: invalidUtf8Raw.toString('base64'),
      result_bytes: invalidUtf8Raw.length,
      result_sha256: createHash('sha256').update(invalidUtf8Raw).digest('hex'),
    });

    expect((await postFleet(app, oversized)).status).toBe(413);
    expect((await postFleet(app, malformed)).status).toBe(400);
    expect((await postFleet(app, invalidUtf8)).status).toBe(400);
    expect(mocks.store.persistFleetResultReceipt).not.toHaveBeenCalled();
  });

  it('rejects missing launch receipt and server-owned authority mismatches', async () => {
    const body = deliveryBody();
    mocks.store.getById.mockResolvedValueOnce(fleetAttempt({ remote_job_id: null }));
    const missingLaunch = await postFleet(app, body);

    mocks.store.getById.mockResolvedValueOnce(fleetAttempt());
    const wrongRun = await postFleet(app, body, {
      'X-Cecelia-Fleet-Run-Id': '99999999-9999-4999-8999-999999999999',
    });

    mocks.store.getById.mockResolvedValueOnce(fleetAttempt({
      provider_session_id: 'different-session',
    }));
    const wrongSession = await postFleet(app, body);

    expect(missingLaunch.status).toBe(409);
    expect(wrongRun.status).toBe(409);
    expect(wrongSession.status).toBe(409);
    expect(mocks.store.persistFleetResultReceipt).not.toHaveBeenCalled();
  });

  it('returns 409 when the durable store reports a conflicting terminal receipt', async () => {
    mocks.store.persistFleetResultReceipt.mockRejectedValueOnce(
      Object.assign(new Error('conflicting Fleet result receipt'), {
        code: 'fleet_result_conflict',
      }),
    );

    const response = await postFleet(app, deliveryBody());

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('fleet_result_conflict');
  });

  it('keeps legacy Bearer callbacks on the existing path', async () => {
    mocks.store.getById.mockResolvedValueOnce({
      ...fleetAttempt(),
      execution_transport: 'local-docker',
      callback_secret_hash: createHash('sha256').update('legacy-token').digest('hex'),
    });
    mocks.store.complete = vi.fn().mockResolvedValue({
      attempt: { ...fleetAttempt(), status: 'completed', result },
      deduped: false,
    });
    const response = await request(app)
      .post(`/api/brain/harness/attempts/${attemptId}/callback`)
      .set('Authorization', 'Bearer legacy-token')
      .set('X-Harness-Lease-Owner', leaseOwner)
      .send(result);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, deduped: false });
    expect(mocks.store.persistFleetResultReceipt).not.toHaveBeenCalled();
  });
});
