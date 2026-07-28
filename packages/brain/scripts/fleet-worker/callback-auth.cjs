#!/usr/bin/env node
'use strict';

const {
  createHash,
  createHmac,
  timingSafeEqual,
} = require('node:crypto');

const CALLBACK_PROTOCOL = 'fleet-callback/v1';
const HEARTBEAT_PROTOCOL = 'fleet-heartbeat/v1';
const HEARTBEAT_SCHEMA = 'fleet-attempt-heartbeat/v1';
const HEARTBEAT_ACK_SCHEMA = 'fleet-attempt-heartbeat-ack/v1';
const DELIVERY_SCHEMA = 'fleet-attempt-result-delivery/v1';
const RECEIPT_SCHEMA = 'fleet-attempt-result-receipt/v1';
const AUTH_SCHEME = 'Cecelia-Fleet-HMAC-SHA256';
const MAX_RESULT_BYTES = 1024 * 1024;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const TERMINAL_STATUSES = new Set([
  'completed',
  'completed_with_concerns',
  'needs_context',
  'blocked',
  'failed',
  'cancelled',
]);
const RECEIPT_FIELDS = Object.freeze([
  'schema_version',
  'receipt_id',
  'attempt_id',
  'run_id',
  'worker_id',
  'job_id',
  'lease_owner',
  'lease_generation',
  'delivery_id',
  'result_nonce',
  'result_sha256',
  'result_bytes',
  'terminal_status',
  'receipt_status',
  'persisted_at',
  'receipt_hmac',
]);
const HEARTBEAT_ACK_FIELDS = Object.freeze([
  'schema_version',
  'attempt_id',
  'run_id',
  'worker_id',
  'job_id',
  'lease_owner',
  'lease_generation',
  'heartbeat_nonce',
  'provider_session_id',
  'heartbeat_at',
  'lease_expires_at',
  'receipt_hmac',
]);

function fail(code) {
  throw new Error(`fleet_callback_auth: ${code}`);
}

function exactObject(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    fail(code);
  }
}

function secret(value) {
  if (
    typeof value !== 'string'
    || Buffer.byteLength(value, 'utf8') < 32
    || /[\r\n\0]/.test(value)
  ) {
    fail('secret_invalid');
  }
  return value;
}

function uuid(value, code) {
  if (!UUID_PATTERN.test(value ?? '')) fail(code);
  return value;
}

function identifier(value, code) {
  if (!IDENTIFIER_PATTERN.test(value ?? '')) fail(code);
  return value;
}

function unsignedInteger(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) fail(code);
  return value;
}

function positiveInteger(value, code, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) fail(code);
  return value;
}

function terminalStatus(value) {
  if (!TERMINAL_STATUSES.has(value)) fail('terminal_status_invalid');
  return value;
}

function canonicalTimestamp(value, code) {
  if (
    typeof value !== 'string'
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) {
    fail(code);
  }
  return value;
}

function nullableSession(value, code) {
  if (value === null) return value;
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 512
    || /[\r\n\0]/.test(value)
  ) {
    fail(code);
  }
  return value;
}

function safeHexEqual(actual, expected) {
  if (!SHA256_PATTERN.test(actual ?? '') || !SHA256_PATTERN.test(expected ?? '')) {
    return false;
  }
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function callbackSigningPayload(input, body) {
  return `${[
    'cecelia-fleet-callback/v1',
    input.attemptId,
    input.workerId,
    input.runId,
    input.jobId,
    input.leaseOwner,
    String(input.leaseGeneration),
    input.deliveryId,
    body.result_sha256,
    input.resultNonce,
    String(body.result_bytes),
    input.terminalStatus,
    body.result_b64,
  ].join('\n')}\n`;
}

function receiptSigningPayload(receipt) {
  return `${[
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
  ].join('\n')}\n`;
}

function heartbeatSigningPayload(input, body) {
  return `${[
    'cecelia-fleet-heartbeat/v1',
    input.attemptId,
    input.workerId,
    input.runId,
    input.jobId,
    input.leaseOwner,
    String(input.leaseGeneration),
    input.heartbeatNonce,
    body.observed_at,
    String(body.lease_seconds),
    body.provider_session_id ?? '',
  ].join('\n')}\n`;
}

function heartbeatAckSigningPayload(ack) {
  return `${[
    'cecelia-fleet-heartbeat-ack/v1',
    ack.attempt_id,
    ack.run_id,
    ack.worker_id,
    ack.job_id,
    ack.lease_owner,
    String(ack.lease_generation),
    ack.heartbeat_nonce,
    ack.provider_session_id ?? '',
    ack.heartbeat_at,
    ack.lease_expires_at,
  ].join('\n')}\n`;
}

function buildFleetHeartbeat(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('heartbeat_input_invalid');
  }
  const signingSecret = secret(input.secret);
  uuid(input.attemptId, 'heartbeat_attempt_id_invalid');
  uuid(input.runId, 'heartbeat_run_id_invalid');
  identifier(input.workerId, 'heartbeat_worker_id_invalid');
  identifier(input.jobId, 'heartbeat_job_id_invalid');
  identifier(input.leaseOwner, 'heartbeat_lease_owner_invalid');
  unsignedInteger(input.leaseGeneration, 'heartbeat_lease_generation_invalid');
  uuid(input.heartbeatNonce, 'heartbeat_nonce_invalid');
  canonicalTimestamp(input.observedAt, 'heartbeat_observed_at_invalid');
  positiveInteger(input.leaseSeconds, 'heartbeat_lease_seconds_invalid', 600);
  if (input.leaseSeconds < 30) fail('heartbeat_lease_seconds_invalid');
  nullableSession(input.providerSessionId, 'heartbeat_provider_session_id_invalid');

  const body = Object.freeze({
    schema_version: HEARTBEAT_SCHEMA,
    heartbeat_nonce: input.heartbeatNonce,
    observed_at: input.observedAt,
    lease_seconds: input.leaseSeconds,
    provider_session_id: input.providerSessionId,
  });
  const signature = createHmac('sha256', signingSecret)
    .update(heartbeatSigningPayload(input, body), 'utf8')
    .digest('hex');
  return Object.freeze({
    body,
    headers: Object.freeze({
      'Content-Type': 'application/json',
      'X-Cecelia-Fleet-Protocol': HEARTBEAT_PROTOCOL,
      'X-Cecelia-Fleet-Worker-Id': input.workerId,
      'X-Cecelia-Fleet-Run-Id': input.runId,
      'X-Cecelia-Fleet-Job-Id': input.jobId,
      'X-Cecelia-Fleet-Lease-Owner': input.leaseOwner,
      'X-Cecelia-Fleet-Lease-Generation': String(input.leaseGeneration),
      'X-Cecelia-Fleet-Heartbeat-Nonce': input.heartbeatNonce,
      Authorization: `${AUTH_SCHEME} ${signature}`,
    }),
  });
}

function verifyFleetHeartbeatAck({ ack, secret: rawSecret, expected } = {}) {
  const signingSecret = secret(rawSecret);
  exactObject(ack, HEARTBEAT_ACK_FIELDS, 'heartbeat_ack_fields_invalid');
  if (ack.schema_version !== HEARTBEAT_ACK_SCHEMA) {
    fail('heartbeat_ack_schema_invalid');
  }
  uuid(ack.attempt_id, 'heartbeat_ack_attempt_id_invalid');
  uuid(ack.run_id, 'heartbeat_ack_run_id_invalid');
  identifier(ack.worker_id, 'heartbeat_ack_worker_id_invalid');
  identifier(ack.job_id, 'heartbeat_ack_job_id_invalid');
  identifier(ack.lease_owner, 'heartbeat_ack_lease_owner_invalid');
  unsignedInteger(
    ack.lease_generation,
    'heartbeat_ack_lease_generation_invalid',
  );
  uuid(ack.heartbeat_nonce, 'heartbeat_ack_nonce_invalid');
  nullableSession(
    ack.provider_session_id,
    'heartbeat_ack_provider_session_id_invalid',
  );
  canonicalTimestamp(ack.heartbeat_at, 'heartbeat_ack_heartbeat_at_invalid');
  canonicalTimestamp(
    ack.lease_expires_at,
    'heartbeat_ack_lease_expires_at_invalid',
  );
  const pairs = [
    ['attempt_id', expected?.attemptId],
    ['run_id', expected?.runId],
    ['worker_id', expected?.workerId],
    ['job_id', expected?.jobId],
    ['lease_owner', expected?.leaseOwner],
    ['lease_generation', expected?.leaseGeneration],
    ['heartbeat_nonce', expected?.heartbeatNonce],
    ['provider_session_id', expected?.providerSessionId],
  ];
  if (pairs.some(([field, value]) => ack[field] !== value)) {
    fail('heartbeat_ack_binding_mismatch');
  }
  const expectedHmac = createHmac('sha256', signingSecret)
    .update(heartbeatAckSigningPayload(ack), 'utf8')
    .digest('hex');
  if (!safeHexEqual(ack.receipt_hmac, expectedHmac)) {
    fail('heartbeat_ack_hmac_invalid');
  }
  return Object.freeze({ ...ack });
}

function buildFleetResultDelivery(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('delivery_input_invalid');
  }
  const signingSecret = secret(input.secret);
  uuid(input.attemptId, 'attempt_id_invalid');
  uuid(input.runId, 'run_id_invalid');
  identifier(input.workerId, 'worker_id_invalid');
  identifier(input.jobId, 'job_id_invalid');
  identifier(input.leaseOwner, 'lease_owner_invalid');
  unsignedInteger(input.leaseGeneration, 'lease_generation_invalid');
  uuid(input.deliveryId, 'delivery_id_invalid');
  uuid(input.resultNonce, 'result_nonce_invalid');
  terminalStatus(input.terminalStatus);
  if (!Buffer.isBuffer(input.resultBytes)) fail('result_bytes_buffer_required');
  positiveInteger(input.resultBytes.length, 'result_bytes_invalid', MAX_RESULT_BYTES);

  const body = Object.freeze({
    schema_version: DELIVERY_SCHEMA,
    delivery_id: input.deliveryId,
    result_nonce: input.resultNonce,
    result_sha256: createHash('sha256').update(input.resultBytes).digest('hex'),
    result_bytes: input.resultBytes.length,
    terminal_status: input.terminalStatus,
    result_b64: input.resultBytes.toString('base64'),
  });
  const signature = createHmac('sha256', signingSecret)
    .update(callbackSigningPayload(input, body), 'utf8')
    .digest('hex');
  return Object.freeze({
    body,
    headers: Object.freeze({
      'Content-Type': 'application/json',
      'X-Cecelia-Fleet-Protocol': CALLBACK_PROTOCOL,
      'X-Cecelia-Fleet-Worker-Id': input.workerId,
      'X-Cecelia-Fleet-Run-Id': input.runId,
      'X-Cecelia-Fleet-Job-Id': input.jobId,
      'X-Cecelia-Fleet-Lease-Owner': input.leaseOwner,
      'X-Cecelia-Fleet-Lease-Generation': String(input.leaseGeneration),
      'X-Cecelia-Fleet-Delivery-Id': input.deliveryId,
      'X-Cecelia-Fleet-Result-Sha256': body.result_sha256,
      Authorization: `${AUTH_SCHEME} ${signature}`,
    }),
  });
}

function exactExpectedReceipt(receipt, expected) {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) {
    fail('expected_receipt_binding_invalid');
  }
  const pairs = [
    ['attempt_id', expected.attemptId],
    ['run_id', expected.runId],
    ['worker_id', expected.workerId],
    ['job_id', expected.jobId],
    ['lease_owner', expected.leaseOwner],
    ['lease_generation', expected.leaseGeneration],
    ['delivery_id', expected.deliveryId],
    ['result_nonce', expected.resultNonce],
    ['result_sha256', expected.resultSha256],
    ['result_bytes', expected.resultBytes],
    ['terminal_status', expected.terminalStatus],
  ];
  if (pairs.some(([field, value]) => receipt[field] !== value)) {
    fail('receipt_binding_mismatch');
  }
}

function verifyFleetResultReceiptAck({ receipt, secret: rawSecret, expected } = {}) {
  const signingSecret = secret(rawSecret);
  exactObject(receipt, RECEIPT_FIELDS, 'receipt_fields_invalid');
  if (receipt.schema_version !== RECEIPT_SCHEMA) fail('receipt_schema_invalid');
  uuid(receipt.receipt_id, 'receipt_id_invalid');
  uuid(receipt.attempt_id, 'receipt_attempt_id_invalid');
  uuid(receipt.run_id, 'receipt_run_id_invalid');
  identifier(receipt.worker_id, 'receipt_worker_id_invalid');
  identifier(receipt.job_id, 'receipt_job_id_invalid');
  identifier(receipt.lease_owner, 'receipt_lease_owner_invalid');
  unsignedInteger(receipt.lease_generation, 'receipt_lease_generation_invalid');
  uuid(receipt.delivery_id, 'receipt_delivery_id_invalid');
  uuid(receipt.result_nonce, 'receipt_result_nonce_invalid');
  if (!SHA256_PATTERN.test(receipt.result_sha256 ?? '')) {
    fail('receipt_result_sha256_invalid');
  }
  positiveInteger(receipt.result_bytes, 'receipt_result_bytes_invalid', MAX_RESULT_BYTES);
  terminalStatus(receipt.terminal_status);
  if (!['accepted', 'deduped'].includes(receipt.receipt_status)) {
    fail('receipt_status_invalid');
  }
  if (
    typeof receipt.persisted_at !== 'string'
    || Number.isNaN(Date.parse(receipt.persisted_at))
    || new Date(receipt.persisted_at).toISOString() !== receipt.persisted_at
  ) {
    fail('receipt_persisted_at_invalid');
  }
  exactExpectedReceipt(receipt, expected);
  const expectedHmac = createHmac('sha256', signingSecret)
    .update(receiptSigningPayload(receipt), 'utf8')
    .digest('hex');
  if (!safeHexEqual(receipt.receipt_hmac, expectedHmac)) {
    fail('receipt_hmac_invalid');
  }
  return Object.freeze({ ...receipt });
}

module.exports = {
  AUTH_SCHEME,
  CALLBACK_PROTOCOL,
  DELIVERY_SCHEMA,
  HEARTBEAT_ACK_SCHEMA,
  HEARTBEAT_PROTOCOL,
  HEARTBEAT_SCHEMA,
  MAX_RESULT_BYTES,
  RECEIPT_SCHEMA,
  buildFleetHeartbeat,
  buildFleetResultDelivery,
  verifyFleetHeartbeatAck,
  verifyFleetResultReceiptAck,
};
