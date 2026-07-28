'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const {
  buildFleetHeartbeat,
  buildFleetResultDelivery,
  verifyFleetHeartbeatAck,
  verifyFleetResultReceiptAck,
} = require('./callback-auth.cjs');

const SECRET = 'kernel-fleet-bridge-secret-at-least-32-bytes';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const WORKER_ID = 'us-mac-m4';
const JOB_ID = 'container-attempt-1';
const LEASE_OWNER = 'dispatcher-1';
const LEASE_GENERATION = 2;
const DELIVERY_ID = '55555555-5555-4555-8555-555555555555';
const RESULT_NONCE = '66666666-6666-4666-8666-666666666666';
const RECEIPT_ID = '77777777-7777-4777-8777-777777777777';
const PERSISTED_AT = '2026-07-28T01:00:00.000Z';
const HEARTBEAT_NONCE = '88888888-8888-4888-8888-888888888888';
const OBSERVED_AT = '2026-07-28T00:59:59.000Z';
const RESULT_BYTES = Buffer.from(JSON.stringify({
  contract_version: '1.0',
  attempt_id: ATTEMPT_ID,
  status: 'completed',
  summary: 'done',
  artifacts: [],
  checks: [],
  decision: null,
  error: null,
  provider_metadata: { provider: 'codex', session_id: 'thread-1' },
}), 'utf8');

function deliveryInput(overrides = {}) {
  return {
    secret: SECRET,
    attemptId: ATTEMPT_ID,
    runId: RUN_ID,
    workerId: WORKER_ID,
    jobId: JOB_ID,
    leaseOwner: LEASE_OWNER,
    leaseGeneration: LEASE_GENERATION,
    deliveryId: DELIVERY_ID,
    resultNonce: RESULT_NONCE,
    resultBytes: RESULT_BYTES,
    terminalStatus: 'completed',
    ...overrides,
  };
}

function receiptHmac(receipt) {
  return crypto.createHmac('sha256', SECRET).update(`${[
    'cecelia-fleet-receipt/v1',
    receipt.receipt_id,
    receipt.attempt_id,
    receipt.run_id,
    receipt.worker_id,
    receipt.job_id,
    receipt.lease_owner,
    String(receipt.lease_generation),
    receipt.delivery_id,
    receipt.result_nonce,
    receipt.result_sha256,
    String(receipt.result_bytes),
    receipt.terminal_status,
    receipt.receipt_status,
    receipt.persisted_at,
  ].join('\n')}\n`, 'utf8').digest('hex');
}

function acceptedReceipt(delivery, overrides = {}) {
  const receipt = {
    schema_version: 'fleet-attempt-result-receipt/v1',
    receipt_id: RECEIPT_ID,
    attempt_id: ATTEMPT_ID,
    run_id: RUN_ID,
    worker_id: WORKER_ID,
    job_id: JOB_ID,
    lease_owner: LEASE_OWNER,
    lease_generation: LEASE_GENERATION,
    delivery_id: DELIVERY_ID,
    result_nonce: RESULT_NONCE,
    result_sha256: delivery.body.result_sha256,
    result_bytes: RESULT_BYTES.length,
    terminal_status: 'completed',
    receipt_status: 'accepted',
    persisted_at: PERSISTED_AT,
    ...overrides,
  };
  return { ...receipt, receipt_hmac: receiptHmac(receipt) };
}

test('builds the exact deterministic Fleet callback body and HMAC headers', () => {
  const first = buildFleetResultDelivery(deliveryInput());
  const second = buildFleetResultDelivery(deliveryInput());

  assert.deepEqual(first, second);
  assert.deepEqual(Object.keys(first).sort(), ['body', 'headers']);
  assert.deepEqual(Object.keys(first.body).sort(), [
    'delivery_id',
    'result_b64',
    'result_bytes',
    'result_nonce',
    'result_sha256',
    'schema_version',
    'terminal_status',
  ]);
  assert.deepEqual(first.body, {
    schema_version: 'fleet-attempt-result-delivery/v1',
    delivery_id: DELIVERY_ID,
    result_nonce: RESULT_NONCE,
    result_sha256: crypto.createHash('sha256').update(RESULT_BYTES).digest('hex'),
    result_bytes: RESULT_BYTES.length,
    terminal_status: 'completed',
    result_b64: RESULT_BYTES.toString('base64'),
  });
  const { Authorization, ...unsignedHeaders } = first.headers;
  assert.deepEqual(unsignedHeaders, {
    'Content-Type': 'application/json',
    'X-Cecelia-Fleet-Protocol': 'fleet-callback/v1',
    'X-Cecelia-Fleet-Worker-Id': WORKER_ID,
    'X-Cecelia-Fleet-Run-Id': RUN_ID,
    'X-Cecelia-Fleet-Job-Id': JOB_ID,
    'X-Cecelia-Fleet-Lease-Owner': LEASE_OWNER,
    'X-Cecelia-Fleet-Lease-Generation': String(LEASE_GENERATION),
    'X-Cecelia-Fleet-Delivery-Id': DELIVERY_ID,
    'X-Cecelia-Fleet-Result-Sha256': first.body.result_sha256,
  });
  assert.match(
    Authorization,
    /^Cecelia-Fleet-HMAC-SHA256 [a-f0-9]{64}$/,
  );
  assert.equal(JSON.stringify(first).includes(SECRET), false);
});

test('accepts only an exact signed accepted or deduped receipt', () => {
  const delivery = buildFleetResultDelivery(deliveryInput());
  const expected = {
    attemptId: ATTEMPT_ID,
    runId: RUN_ID,
    workerId: WORKER_ID,
    jobId: JOB_ID,
    leaseOwner: LEASE_OWNER,
    leaseGeneration: LEASE_GENERATION,
    deliveryId: DELIVERY_ID,
    resultNonce: RESULT_NONCE,
    resultSha256: delivery.body.result_sha256,
    resultBytes: RESULT_BYTES.length,
    terminalStatus: 'completed',
  };

  assert.deepEqual(
    verifyFleetResultReceiptAck({
      receipt: acceptedReceipt(delivery),
      secret: SECRET,
      expected,
    }),
    acceptedReceipt(delivery),
  );
  const deduped = acceptedReceipt(delivery, { receipt_status: 'deduped' });
  deduped.receipt_hmac = receiptHmac(deduped);
  assert.equal(
    verifyFleetResultReceiptAck({ receipt: deduped, secret: SECRET, expected })
      .receipt_status,
    'deduped',
  );
});

test('rejects every conflicting binding, status, field, HMAC and secret', () => {
  const delivery = buildFleetResultDelivery(deliveryInput());
  const expected = {
    attemptId: ATTEMPT_ID,
    runId: RUN_ID,
    workerId: WORKER_ID,
    jobId: JOB_ID,
    leaseOwner: LEASE_OWNER,
    leaseGeneration: LEASE_GENERATION,
    deliveryId: DELIVERY_ID,
    resultNonce: RESULT_NONCE,
    resultSha256: delivery.body.result_sha256,
    resultBytes: RESULT_BYTES.length,
    terminalStatus: 'completed',
  };
  const cases = [
    acceptedReceipt(delivery, { attempt_id: '99999999-9999-4999-8999-999999999999' }),
    acceptedReceipt(delivery, { receipt_status: 'pending' }),
    { ...acceptedReceipt(delivery), receipt_hmac: '0'.repeat(64) },
    { ...acceptedReceipt(delivery), attacker: true },
  ];

  for (const receipt of cases) {
    assert.throws(
      () => verifyFleetResultReceiptAck({ receipt, secret: SECRET, expected }),
      /fleet_callback_auth:/,
    );
  }
  assert.throws(
    () => buildFleetResultDelivery(deliveryInput({ secret: 'short' })),
    /fleet_callback_auth:/,
  );
  assert.throws(
    () => verifyFleetResultReceiptAck({
      receipt: acceptedReceipt(delivery),
      secret: 'short',
      expected,
    }),
    /fleet_callback_auth:/,
  );
});

test('never serializes a callback secret into delivery metadata', () => {
  const delivery = buildFleetResultDelivery(deliveryInput());
  const metadata = {
    delivery_id: delivery.body.delivery_id,
    result_nonce: delivery.body.result_nonce,
    result_sha256: delivery.body.result_sha256,
    result_bytes: delivery.body.result_bytes,
    terminal_status: delivery.body.terminal_status,
  };

  assert.equal(JSON.stringify(metadata).includes(SECRET), false);
  assert.equal(Object.hasOwn(metadata, 'result_b64'), false);
  assert.equal(Object.hasOwn(metadata, 'authorization'), false);
});

test('builds and verifies an exact domain-separated Fleet heartbeat', () => {
  const wire = buildFleetHeartbeat({
    secret: SECRET,
    attemptId: ATTEMPT_ID,
    runId: RUN_ID,
    workerId: WORKER_ID,
    jobId: JOB_ID,
    leaseOwner: LEASE_OWNER,
    leaseGeneration: LEASE_GENERATION,
    heartbeatNonce: HEARTBEAT_NONCE,
    observedAt: OBSERVED_AT,
    leaseSeconds: 180,
    providerSessionId: 'thread-1',
  });
  assert.deepEqual(wire.body, {
    schema_version: 'fleet-attempt-heartbeat/v1',
    heartbeat_nonce: HEARTBEAT_NONCE,
    observed_at: OBSERVED_AT,
    lease_seconds: 180,
    provider_session_id: 'thread-1',
  });
  assert.equal(
    wire.headers['X-Cecelia-Fleet-Protocol'],
    'fleet-heartbeat/v1',
  );
  assert.match(
    wire.headers.Authorization,
    /^Cecelia-Fleet-HMAC-SHA256 [a-f0-9]{64}$/,
  );

  const unsignedAck = {
    schema_version: 'fleet-attempt-heartbeat-ack/v1',
    attempt_id: ATTEMPT_ID,
    run_id: RUN_ID,
    worker_id: WORKER_ID,
    job_id: JOB_ID,
    lease_owner: LEASE_OWNER,
    lease_generation: LEASE_GENERATION,
    heartbeat_nonce: HEARTBEAT_NONCE,
    provider_session_id: 'thread-1',
    heartbeat_at: PERSISTED_AT,
    lease_expires_at: '2026-07-28T01:03:00.000Z',
  };
  const receipt_hmac = crypto.createHmac('sha256', SECRET).update(`${[
    'cecelia-fleet-heartbeat-ack/v1',
    unsignedAck.attempt_id,
    unsignedAck.run_id,
    unsignedAck.worker_id,
    unsignedAck.job_id,
    unsignedAck.lease_owner,
    String(unsignedAck.lease_generation),
    unsignedAck.heartbeat_nonce,
    unsignedAck.provider_session_id,
    unsignedAck.heartbeat_at,
    unsignedAck.lease_expires_at,
  ].join('\n')}\n`, 'utf8').digest('hex');
  const ack = { ...unsignedAck, receipt_hmac };

  assert.deepEqual(verifyFleetHeartbeatAck({
    ack,
    secret: SECRET,
    expected: {
      attemptId: ATTEMPT_ID,
      runId: RUN_ID,
      workerId: WORKER_ID,
      jobId: JOB_ID,
      leaseOwner: LEASE_OWNER,
      leaseGeneration: LEASE_GENERATION,
      heartbeatNonce: HEARTBEAT_NONCE,
      providerSessionId: 'thread-1',
    },
  }), ack);
  assert.throws(
    () => verifyFleetHeartbeatAck({
      ack: { ...ack, heartbeat_nonce: DELIVERY_ID },
      secret: SECRET,
      expected: {
        attemptId: ATTEMPT_ID,
        runId: RUN_ID,
        workerId: WORKER_ID,
        jobId: JOB_ID,
        leaseOwner: LEASE_OWNER,
        leaseGeneration: LEASE_GENERATION,
        heartbeatNonce: HEARTBEAT_NONCE,
        providerSessionId: 'thread-1',
      },
    }),
    /fleet_callback_auth:/,
  );
});
