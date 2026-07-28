'use strict';

const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const test = require('node:test');

const {
  createFleetHeartbeatClient,
  createFleetMaintenance,
  createResultDeliveryClient,
} = require('./fleet-worker.cjs');

const SECRET = 'kernel-fleet-bridge-secret-at-least-32-bytes';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const DELIVERY_ID = '55555555-5555-4555-8555-555555555555';
const RESULT_NONCE = '66666666-6666-4666-8666-666666666666';
const RECEIPT_ID = '77777777-7777-4777-8777-777777777777';
const RESULT = Buffer.from(JSON.stringify({
  contract_version: '1.0',
  attempt_id: ATTEMPT_ID,
  status: 'completed',
}), 'utf8');
const STATE = Object.freeze({
  attempt_id: ATTEMPT_ID,
  run_id: RUN_ID,
  worker_id: 'us-mac-m4',
  container_id: 'container-attempt-1',
  lease_owner: 'dispatcher-1',
  lease_generation: 2,
  brain_url: 'http://brain.internal:5221',
});

function signReceipt(receipt) {
  return createHmac('sha256', SECRET).update(`${[
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

test('prepares stable secret-free metadata and verifies the exact Brain ACK', async () => {
  const ids = [DELIVERY_ID, RESULT_NONCE];
  let captured;
  const fetchFn = async (url, options) => {
    captured = { url: String(url), options };
    const body = JSON.parse(options.body);
    const receipt = {
      schema_version: 'fleet-attempt-result-receipt/v1',
      receipt_id: RECEIPT_ID,
      attempt_id: ATTEMPT_ID,
      run_id: RUN_ID,
      worker_id: STATE.worker_id,
      job_id: STATE.container_id,
      lease_owner: STATE.lease_owner,
      lease_generation: STATE.lease_generation,
      delivery_id: body.delivery_id,
      result_nonce: body.result_nonce,
      result_sha256: body.result_sha256,
      result_bytes: body.result_bytes,
      terminal_status: body.terminal_status,
      receipt_status: 'accepted',
      persisted_at: '2026-07-28T01:00:00.000Z',
    };
    receipt.receipt_hmac = signReceipt(receipt);
    return new Response(JSON.stringify(receipt), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const client = createResultDeliveryClient({
    secret: SECRET,
    fetchFn,
    randomUuid: () => ids.shift(),
  });
  const delivery = await client.prepare({
    resultBytes: RESULT,
    terminalStatus: 'completed',
  });

  assert.deepEqual(Object.keys(delivery).sort(), [
    'delivery_id',
    'result_bytes',
    'result_nonce',
    'result_sha256',
    'terminal_status',
  ]);
  assert.equal(JSON.stringify(delivery).includes(SECRET), false);

  const receipt = await client.deliver({
    state: STATE,
    resultBytes: RESULT,
    terminalStatus: 'completed',
    delivery,
  });

  assert.equal(receipt.receipt_id, RECEIPT_ID);
  assert.equal(
    captured.url,
    `http://brain.internal:5221/api/brain/harness/attempts/${ATTEMPT_ID}/callback`,
  );
  assert.equal(captured.options.method, 'POST');
  assert.match(
    captured.options.headers.Authorization,
    /^Cecelia-Fleet-HMAC-SHA256 [a-f0-9]{64}$/,
  );
  assert.equal(JSON.stringify(captured).includes(SECRET), false);
});

test('retains the same delivery identifiers across retries and rejects bad ACKs', async () => {
  const fetchFn = async () => new Response(JSON.stringify({
    schema_version: 'fleet-attempt-result-receipt/v1',
    receipt_id: RECEIPT_ID,
    attempt_id: ATTEMPT_ID,
    run_id: RUN_ID,
    worker_id: STATE.worker_id,
    job_id: STATE.container_id,
    lease_owner: STATE.lease_owner,
    lease_generation: STATE.lease_generation,
    delivery_id: DELIVERY_ID,
    result_nonce: RESULT_NONCE,
    result_sha256: '0'.repeat(64),
    result_bytes: RESULT.length,
    terminal_status: 'completed',
    receipt_status: 'accepted',
    persisted_at: '2026-07-28T01:00:00.000Z',
    receipt_hmac: '0'.repeat(64),
  }), { status: 200 });
  const client = createResultDeliveryClient({
    secret: SECRET,
    fetchFn,
    randomUuid: () => {
      throw new Error('retry must use persisted ids');
    },
  });
  const delivery = {
    delivery_id: DELIVERY_ID,
    result_nonce: RESULT_NONCE,
    result_sha256: require('node:crypto').createHash('sha256').update(RESULT).digest('hex'),
    result_bytes: RESULT.length,
    terminal_status: 'completed',
  };

  await assert.rejects(
    client.deliver({
      state: STATE,
      resultBytes: RESULT,
      terminalStatus: 'completed',
      delivery,
    }),
    /fleet_callback_auth:/,
  );
});

test('Fleet-owned heartbeat verifies the exact signed Brain ACK', async () => {
  const heartbeatNonce = '88888888-8888-4888-8888-888888888888';
  let captured;
  const fetchFn = async (url, options) => {
    captured = { url: String(url), options };
    const requestBody = JSON.parse(options.body);
    const ack = {
      schema_version: 'fleet-attempt-heartbeat-ack/v1',
      attempt_id: ATTEMPT_ID,
      run_id: RUN_ID,
      worker_id: STATE.worker_id,
      job_id: STATE.container_id,
      lease_owner: STATE.lease_owner,
      lease_generation: STATE.lease_generation,
      heartbeat_nonce: heartbeatNonce,
      provider_session_id: 'thread-live',
      heartbeat_at: '2026-07-28T01:00:01.000Z',
      lease_expires_at: '2026-07-28T01:03:01.000Z',
    };
    ack.receipt_hmac = createHmac('sha256', SECRET).update(`${[
      'cecelia-fleet-heartbeat-ack/v1',
      ack.attempt_id,
      ack.run_id,
      ack.worker_id,
      ack.job_id,
      ack.lease_owner,
      String(ack.lease_generation),
      ack.heartbeat_nonce,
      ack.provider_session_id,
      ack.heartbeat_at,
      ack.lease_expires_at,
    ].join('\n')}\n`, 'utf8').digest('hex');
    assert.equal(requestBody.heartbeat_nonce, heartbeatNonce);
    return new Response(JSON.stringify(ack), { status: 200 });
  };
  const client = createFleetHeartbeatClient({
    secret: SECRET,
    fetchFn,
    randomUuid: () => heartbeatNonce,
    now: () => new Date('2026-07-28T01:00:00.000Z'),
  });

  const ack = await client.deliver({
    state: STATE,
    session: {
      contract_version: 'provider-session/v1',
      attempt_id: ATTEMPT_ID,
      provider: 'codex',
      session_id: 'thread-live',
    },
  });

  assert.equal(ack.heartbeat_nonce, heartbeatNonce);
  assert.equal(
    captured.url,
    `http://brain.internal:5221/api/brain/harness/attempts/${ATTEMPT_ID}/heartbeat`,
  );
  assert.equal(captured.options.method, 'POST');
  assert.equal(JSON.stringify(captured).includes(SECRET), false);
});

test('maintenance heartbeats only owned live or callback-pending attempts', async () => {
  const foreign = { ...STATE, attempt_id: '33333333-3333-4333-8333-333333333333', worker_id: 'xian-mac-m4' };
  const cleaned = { ...STATE, attempt_id: '44444444-4444-4444-8444-444444444444', status: 'cleanup_pending' };
  const running = { ...STATE, status: 'running' };
  const pending = { ...STATE, attempt_id: '55555555-5555-4555-8555-555555555555', status: 'callback_pending' };
  const stateStore = {
    list: async () => [foreign, cleaned, running, pending],
  };
  const docker = {
    readSession: async ({ attemptId }) => (
      attemptId === ATTEMPT_ID
        ? {
            contract_version: 'provider-session/v1',
            attempt_id: ATTEMPT_ID,
            provider: 'codex',
            session_id: 'thread-live',
          }
        : null
    ),
  };
  const delivered = [];
  const maintenance = createFleetMaintenance({
    workerId: STATE.worker_id,
    stateStore,
    docker,
    heartbeatClient: {
      deliver: async (input) => {
        delivered.push(input);
        return { heartbeat_at: '2026-07-28T01:00:00.000Z' };
      },
    },
  });

  const outcome = await maintenance.heartbeatAll();

  assert.deepEqual(
    delivered.map(({ state }) => state.attempt_id),
    [ATTEMPT_ID, pending.attempt_id],
  );
  assert.deepEqual(outcome, {
    attempted: 2,
    accepted: 2,
    failed: 0,
  });
});
