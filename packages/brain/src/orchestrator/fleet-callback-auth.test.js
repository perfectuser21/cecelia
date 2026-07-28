import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  buildFleetHeartbeatAck,
  buildFleetResultReceiptAck,
  parseFleetHeartbeat,
  parseFleetResultDelivery,
} from './fleet-callback-auth.js';

const secret = 'kernel-fleet-bridge-secret-at-least-32-bytes';
const attemptId = '22222222-2222-4222-8222-222222222222';
const runId = '11111111-1111-4111-8111-111111111111';
const deliveryId = '55555555-5555-4555-8555-555555555555';
const resultNonce = '66666666-6666-4666-8666-666666666666';
const heartbeatNonce = '88888888-8888-4888-8888-888888888888';

function fixture() {
  const resultBytes = Buffer.from(JSON.stringify({
    contract_version: '1.0',
    attempt_id: attemptId,
    status: 'completed',
  }));
  const body = {
    schema_version: 'fleet-attempt-result-delivery/v1',
    delivery_id: deliveryId,
    result_nonce: resultNonce,
    result_sha256: createHash('sha256').update(resultBytes).digest('hex'),
    result_bytes: resultBytes.length,
    terminal_status: 'completed',
    result_b64: resultBytes.toString('base64'),
  };
  const signed = {
    worker: 'xian-mac-m4',
    run: runId,
    job: 'job-7',
    owner: 'brain-1:123',
    generation: '2',
    delivery: deliveryId,
    digest: body.result_sha256,
  };
  const callbackPayload = `${[
    'cecelia-fleet-callback/v1',
    attemptId,
    signed.worker,
    signed.run,
    signed.job,
    signed.owner,
    signed.generation,
    signed.delivery,
    signed.digest,
    body.result_nonce,
    String(body.result_bytes),
    body.terminal_status,
    body.result_b64,
  ].join('\n')}\n`;
  const authorization = `Cecelia-Fleet-HMAC-SHA256 ${
    createHmac('sha256', secret).update(callbackPayload).digest('hex')
  }`;
  const rawHeaders = [
    'X-Cecelia-Fleet-Protocol', 'fleet-callback/v1',
    'X-Cecelia-Fleet-Worker-Id', signed.worker,
    'X-Cecelia-Fleet-Run-Id', signed.run,
    'X-Cecelia-Fleet-Job-Id', signed.job,
    'X-Cecelia-Fleet-Lease-Owner', signed.owner,
    'X-Cecelia-Fleet-Lease-Generation', signed.generation,
    'X-Cecelia-Fleet-Delivery-Id', signed.delivery,
    'X-Cecelia-Fleet-Result-Sha256', signed.digest,
    'Authorization', authorization,
  ];
  return { body, rawHeaders };
}

describe('Fleet callback transport authentication', () => {
  it('rejects duplicate signed headers without accepting Node header coalescing', () => {
    const { body, rawHeaders } = fixture();
    rawHeaders.push('x-cecelia-fleet-worker-id', 'xian-mac-m4');

    expect(() => parseFleetResultDelivery({
      attemptId,
      rawHeaders,
      body,
      secret,
    })).toThrow(/x-cecelia-fleet-worker-id_required/);
  });

  it('rejects non-canonical decimal generation and whitespace', () => {
    const leadingZero = fixture();
    const generationIndex = leadingZero.rawHeaders.findIndex(
      (value) => value.toLowerCase() === 'x-cecelia-fleet-lease-generation',
    );
    leadingZero.rawHeaders[generationIndex + 1] = '02';

    expect(() => parseFleetResultDelivery({
      attemptId,
      ...leadingZero,
      secret,
    })).toThrow(/fleet_lease_generation_invalid/);

    const whitespace = fixture();
    const workerIndex = whitespace.rawHeaders.findIndex(
      (value) => value.toLowerCase() === 'x-cecelia-fleet-worker-id',
    );
    whitespace.rawHeaders[workerIndex + 1] = ' xian-mac-m4';
    expect(() => parseFleetResultDelivery({
      attemptId,
      ...whitespace,
      secret,
    })).toThrow(/x-cecelia-fleet-worker-id_invalid/);
  });

  it('rejects extra delivery fields before persistence', () => {
    const envelope = fixture();
    envelope.body.agent_authority = 'forged';

    expect(() => parseFleetResultDelivery({
      attemptId,
      ...envelope,
      secret,
    })).toThrow(/fleet_delivery_fields_invalid/);
  });

  it('signs every exact ACK field under the independent receipt domain', () => {
    const receipt = {
      receipt_id: '77777777-7777-4777-8777-777777777777',
      attempt_id: attemptId,
      run_id: runId,
      worker_id: 'xian-mac-m4',
      job_id: 'job-7',
      lease_owner: 'brain-1:123',
      lease_generation: 2,
      delivery_id: deliveryId,
      result_nonce: resultNonce,
      result_sha256: 'a'.repeat(64),
      result_bytes: 321,
      terminal_status: 'completed',
      persisted_at: '2026-07-28T01:00:00.000Z',
    };

    const ack = buildFleetResultReceiptAck({ receipt, deduped: true, secret });
    const expectedPayload = `${[
      'cecelia-fleet-receipt/v1',
      ack.receipt_id,
      ack.attempt_id,
      ack.run_id,
      ack.worker_id,
      ack.job_id,
      ack.lease_owner,
      String(ack.lease_generation),
      ack.delivery_id,
      ack.result_nonce,
      ack.result_sha256,
      String(ack.result_bytes),
      ack.terminal_status,
      ack.receipt_status,
      ack.persisted_at,
    ].join('\n')}\n`;

    expect(ack.receipt_hmac).toBe(
      createHmac('sha256', secret).update(expectedPayload).digest('hex'),
    );
  });

  it('parses and signs the exact domain-separated Fleet heartbeat contract', () => {
    const body = {
      schema_version: 'fleet-attempt-heartbeat/v1',
      heartbeat_nonce: heartbeatNonce,
      observed_at: '2026-07-28T01:00:00.000Z',
      lease_seconds: 180,
      provider_session_id: 'thread-live',
    };
    const signed = {
      worker: 'xian-mac-m4',
      run: runId,
      job: 'job-7',
      owner: 'brain-1:123',
      generation: '2',
    };
    const payload = `${[
      'cecelia-fleet-heartbeat/v1',
      attemptId,
      signed.worker,
      signed.run,
      signed.job,
      signed.owner,
      signed.generation,
      body.heartbeat_nonce,
      body.observed_at,
      String(body.lease_seconds),
      body.provider_session_id,
    ].join('\n')}\n`;
    const rawHeaders = [
      'X-Cecelia-Fleet-Protocol', 'fleet-heartbeat/v1',
      'X-Cecelia-Fleet-Worker-Id', signed.worker,
      'X-Cecelia-Fleet-Run-Id', signed.run,
      'X-Cecelia-Fleet-Job-Id', signed.job,
      'X-Cecelia-Fleet-Lease-Owner', signed.owner,
      'X-Cecelia-Fleet-Lease-Generation', signed.generation,
      'X-Cecelia-Fleet-Heartbeat-Nonce', heartbeatNonce,
      'Authorization', `Cecelia-Fleet-HMAC-SHA256 ${
        createHmac('sha256', secret).update(payload).digest('hex')
      }`,
    ];
    const parsed = parseFleetHeartbeat({
      attemptId,
      rawHeaders,
      body,
      secret,
      nowMs: Date.parse('2026-07-28T01:00:30.000Z'),
    });
    expect(parsed).toMatchObject({
      workerId: signed.worker,
      runId,
      jobId: signed.job,
      leaseOwner: signed.owner,
      leaseGeneration: 2,
      heartbeatNonce,
      providerSessionId: 'thread-live',
      leaseSeconds: 180,
      requestSha256: createHash('sha256').update(payload).digest('hex'),
    });

    expect(() => parseFleetHeartbeat({
      attemptId,
      rawHeaders,
      body,
      secret,
      nowMs: Date.parse('2026-07-29T01:00:00.000Z'),
    })).toThrow(/fleet_heartbeat_stale/);
    expect(parseFleetHeartbeat({
      attemptId,
      rawHeaders,
      body,
      secret,
      nowMs: Date.parse('2026-07-29T01:00:00.000Z'),
      allowStale: true,
    })).toMatchObject({
      heartbeatNonce,
      requestSha256: createHash('sha256').update(payload).digest('hex'),
    });

    const ack = buildFleetHeartbeatAck({
      heartbeat: parsed,
      attempt: {
        heartbeat_at: '2026-07-28T01:00:31.000Z',
        lease_expires_at: '2026-07-28T01:03:31.000Z',
        provider_session_id: 'thread-live',
      },
      attemptId,
      secret,
    });
    expect(ack.schema_version).toBe('fleet-attempt-heartbeat-ack/v1');
    expect(ack.heartbeat_nonce).toBe(heartbeatNonce);
    expect(ack.receipt_hmac).toMatch(/^[a-f0-9]{64}$/);
  });
});
