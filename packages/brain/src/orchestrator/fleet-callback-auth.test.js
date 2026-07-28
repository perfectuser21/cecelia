import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  buildFleetResultReceiptAck,
  parseFleetResultDelivery,
} from './fleet-callback-auth.js';

const secret = 'kernel-fleet-bridge-secret-at-least-32-bytes';
const attemptId = '22222222-2222-4222-8222-222222222222';
const runId = '11111111-1111-4111-8111-111111111111';
const deliveryId = '55555555-5555-4555-8555-555555555555';
const resultNonce = '66666666-6666-4666-8666-666666666666';

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
});
