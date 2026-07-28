import {
  createHash,
  createHmac,
  timingSafeEqual,
} from 'node:crypto';
import { TextDecoder } from 'node:util';

export const FLEET_CALLBACK_PROTOCOL = 'fleet-callback/v1';
export const FLEET_HEARTBEAT_PROTOCOL = 'fleet-heartbeat/v1';
export const FLEET_HEARTBEAT_SCHEMA = 'fleet-attempt-heartbeat/v1';
export const FLEET_HEARTBEAT_ACK_SCHEMA = 'fleet-attempt-heartbeat-ack/v1';
export const FLEET_DELIVERY_SCHEMA = 'fleet-attempt-result-delivery/v1';
export const FLEET_RECEIPT_SCHEMA = 'fleet-attempt-result-receipt/v1';
export const FLEET_CALLBACK_AUTH_SCHEME = 'Cecelia-Fleet-HMAC-SHA256';
export const FLEET_RESULT_HARD_MAX_BYTES = 1024 * 1024;

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
const BODY_FIELDS = Object.freeze([
  'schema_version',
  'delivery_id',
  'result_nonce',
  'result_sha256',
  'result_bytes',
  'terminal_status',
  'result_b64',
]);
const SIGNED_HEADER_NAMES = Object.freeze([
  'x-cecelia-fleet-protocol',
  'x-cecelia-fleet-worker-id',
  'x-cecelia-fleet-run-id',
  'x-cecelia-fleet-job-id',
  'x-cecelia-fleet-lease-owner',
  'x-cecelia-fleet-lease-generation',
  'x-cecelia-fleet-delivery-id',
  'x-cecelia-fleet-result-sha256',
]);
const HEARTBEAT_BODY_FIELDS = Object.freeze([
  'schema_version',
  'heartbeat_nonce',
  'observed_at',
  'lease_seconds',
  'provider_session_id',
]);
const HEARTBEAT_SIGNED_HEADER_NAMES = Object.freeze([
  'x-cecelia-fleet-protocol',
  'x-cecelia-fleet-worker-id',
  'x-cecelia-fleet-run-id',
  'x-cecelia-fleet-job-id',
  'x-cecelia-fleet-lease-owner',
  'x-cecelia-fleet-lease-generation',
  'x-cecelia-fleet-heartbeat-nonce',
]);
const MAX_HEARTBEAT_CLOCK_SKEW_MS = 120_000;

export class FleetCallbackProtocolError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = 'FleetCallbackProtocolError';
    this.code = code;
    this.status = status;
  }
}

function fail(code, status = 400) {
  throw new FleetCallbackProtocolError(code, status);
}

function exactObjectKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${stableJson(value[key])}`,
  ).join(',')}}`;
}

export function computeFleetAuthoritySha256(value) {
  return createHash('sha256').update(stableJson(value), 'utf8').digest('hex');
}

function canonicalUnsignedInteger(value, code) {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(value)) fail(code);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) fail(code);
  return parsed;
}

function requireHeader(rawHeaders, name) {
  const values = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (String(rawHeaders[index]).toLowerCase() === name) {
      values.push(String(rawHeaders[index + 1] ?? ''));
    }
  }
  if (values.length !== 1) fail(`fleet_${name}_required`);
  const value = values[0];
  if (!value || value !== value.trim() || /[\r\n\0]/.test(value)) {
    fail(`fleet_${name}_invalid`);
  }
  return value;
}

function secureHexEqual(actualHex, expectedHex) {
  if (!SHA256_PATTERN.test(actualHex) || !SHA256_PATTERN.test(expectedHex)) return false;
  return timingSafeEqual(Buffer.from(actualHex, 'hex'), Buffer.from(expectedHex, 'hex'));
}

function callbackSigningPayload(attemptId, header, body) {
  return `${[
    'cecelia-fleet-callback/v1',
    attemptId,
    header.workerId,
    header.runId,
    header.jobId,
    header.leaseOwner,
    String(header.leaseGeneration),
    header.deliveryId,
    header.resultSha256,
    body.result_nonce,
    String(body.result_bytes),
    body.terminal_status,
    body.result_b64,
  ].join('\n')}\n`;
}

function decodeCanonicalBase64(value) {
  if (typeof value !== 'string' || value.length === 0) {
    fail('fleet_result_b64_invalid');
  }
  if (value.length > Math.ceil(FLEET_RESULT_HARD_MAX_BYTES / 3) * 4) {
    fail('fleet_result_too_large', 413);
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    fail('fleet_result_b64_invalid');
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) fail('fleet_result_b64_noncanonical');
  return decoded;
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

function nullableProviderSession(value, code) {
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

function heartbeatSigningPayload(attemptId, header, body) {
  return `${[
    'cecelia-fleet-heartbeat/v1',
    attemptId,
    header.workerId,
    header.runId,
    header.jobId,
    header.leaseOwner,
    String(header.leaseGeneration),
    header.heartbeatNonce,
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

export function parseFleetHeartbeat({
  attemptId,
  rawHeaders,
  body,
  secret,
  nowMs = Date.now(),
}) {
  if (!UUID_PATTERN.test(attemptId ?? '')) fail('fleet_attempt_id_invalid');
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32) {
    fail('fleet_callback_secret_unavailable', 503);
  }
  if (!Array.isArray(rawHeaders)) fail('fleet_headers_unavailable');
  if (!exactObjectKeys(body, HEARTBEAT_BODY_FIELDS)) {
    fail('fleet_heartbeat_fields_invalid');
  }
  const raw = Object.fromEntries(
    [...HEARTBEAT_SIGNED_HEADER_NAMES, 'authorization'].map((name) => [
      name,
      requireHeader(rawHeaders, name),
    ]),
  );
  if (raw['x-cecelia-fleet-protocol'] !== FLEET_HEARTBEAT_PROTOCOL) {
    fail('fleet_heartbeat_protocol_invalid');
  }
  const header = {
    workerId: raw['x-cecelia-fleet-worker-id'],
    runId: raw['x-cecelia-fleet-run-id'],
    jobId: raw['x-cecelia-fleet-job-id'],
    leaseOwner: raw['x-cecelia-fleet-lease-owner'],
    leaseGeneration: canonicalUnsignedInteger(
      raw['x-cecelia-fleet-lease-generation'],
      'fleet_lease_generation_invalid',
    ),
    heartbeatNonce: raw['x-cecelia-fleet-heartbeat-nonce'],
  };
  if (!IDENTIFIER_PATTERN.test(header.workerId)) fail('fleet_worker_id_invalid');
  if (!UUID_PATTERN.test(header.runId)) fail('fleet_run_id_invalid');
  if (!IDENTIFIER_PATTERN.test(header.jobId)) fail('fleet_job_id_invalid');
  if (!IDENTIFIER_PATTERN.test(header.leaseOwner)) fail('fleet_lease_owner_invalid');
  if (!UUID_PATTERN.test(header.heartbeatNonce)) fail('fleet_heartbeat_nonce_invalid');
  if (
    body.schema_version !== FLEET_HEARTBEAT_SCHEMA
    || body.heartbeat_nonce !== header.heartbeatNonce
    || !Number.isSafeInteger(body.lease_seconds)
    || body.lease_seconds < 30
    || body.lease_seconds > 600
  ) {
    fail('fleet_heartbeat_invalid');
  }
  canonicalTimestamp(body.observed_at, 'fleet_heartbeat_observed_at_invalid');
  nullableProviderSession(
    body.provider_session_id,
    'fleet_heartbeat_provider_session_id_invalid',
  );
  if (
    !Number.isSafeInteger(nowMs)
    || Math.abs(nowMs - Date.parse(body.observed_at)) > MAX_HEARTBEAT_CLOCK_SKEW_MS
  ) {
    fail('fleet_heartbeat_stale', 409);
  }
  const authorizationMatch = raw.authorization.match(
    new RegExp(`^${FLEET_CALLBACK_AUTH_SCHEME} ([a-f0-9]{64})$`),
  );
  if (!authorizationMatch) fail('fleet_callback_credential_invalid', 401);
  const expectedHmac = createHmac('sha256', secret)
    .update(heartbeatSigningPayload(attemptId, header, body), 'utf8')
    .digest('hex');
  if (!secureHexEqual(authorizationMatch[1], expectedHmac)) {
    fail('fleet_callback_credential_invalid', 401);
  }
  return Object.freeze({
    ...header,
    observedAt: body.observed_at,
    leaseSeconds: body.lease_seconds,
    providerSessionId: body.provider_session_id,
  });
}

export function buildFleetHeartbeatAck({
  heartbeat,
  attempt,
  attemptId,
  secret,
}) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32) {
    fail('fleet_callback_secret_unavailable', 503);
  }
  const heartbeatAt = attempt?.heartbeat_at instanceof Date
    ? attempt.heartbeat_at.toISOString()
    : canonicalTimestamp(
        attempt?.heartbeat_at,
        'fleet_heartbeat_ack_heartbeat_at_invalid',
      );
  const leaseExpiresAt = attempt?.lease_expires_at instanceof Date
    ? attempt.lease_expires_at.toISOString()
    : canonicalTimestamp(
        attempt?.lease_expires_at,
        'fleet_heartbeat_ack_lease_expires_at_invalid',
      );
  const ack = {
    schema_version: FLEET_HEARTBEAT_ACK_SCHEMA,
    attempt_id: attemptId,
    run_id: heartbeat.runId,
    worker_id: heartbeat.workerId,
    job_id: heartbeat.jobId,
    lease_owner: heartbeat.leaseOwner,
    lease_generation: heartbeat.leaseGeneration,
    heartbeat_nonce: heartbeat.heartbeatNonce,
    provider_session_id: heartbeat.providerSessionId,
    heartbeat_at: heartbeatAt,
    lease_expires_at: leaseExpiresAt,
  };
  return Object.freeze({
    ...ack,
    receipt_hmac: createHmac('sha256', secret)
      .update(heartbeatAckSigningPayload(ack), 'utf8')
      .digest('hex'),
  });
}

export function parseFleetResultDelivery({
  attemptId,
  rawHeaders,
  body,
  secret,
}) {
  if (!UUID_PATTERN.test(attemptId ?? '')) fail('fleet_attempt_id_invalid');
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32) {
    fail('fleet_callback_secret_unavailable', 503);
  }
  if (!Array.isArray(rawHeaders)) fail('fleet_headers_unavailable');
  if (!exactObjectKeys(body, BODY_FIELDS)) fail('fleet_delivery_fields_invalid');

  const raw = Object.fromEntries(
    [...SIGNED_HEADER_NAMES, 'authorization'].map((name) => [
      name,
      requireHeader(rawHeaders, name),
    ]),
  );
  if (raw['x-cecelia-fleet-protocol'] !== FLEET_CALLBACK_PROTOCOL) {
    fail('fleet_protocol_invalid');
  }

  const header = {
    workerId: raw['x-cecelia-fleet-worker-id'],
    runId: raw['x-cecelia-fleet-run-id'],
    jobId: raw['x-cecelia-fleet-job-id'],
    leaseOwner: raw['x-cecelia-fleet-lease-owner'],
    leaseGeneration: canonicalUnsignedInteger(
      raw['x-cecelia-fleet-lease-generation'],
      'fleet_lease_generation_invalid',
    ),
    deliveryId: raw['x-cecelia-fleet-delivery-id'],
    resultSha256: raw['x-cecelia-fleet-result-sha256'],
  };
  if (!IDENTIFIER_PATTERN.test(header.workerId)) fail('fleet_worker_id_invalid');
  if (!UUID_PATTERN.test(header.runId)) fail('fleet_run_id_invalid');
  if (!IDENTIFIER_PATTERN.test(header.jobId)) fail('fleet_job_id_invalid');
  if (!IDENTIFIER_PATTERN.test(header.leaseOwner)) fail('fleet_lease_owner_invalid');
  if (!UUID_PATTERN.test(header.deliveryId)) fail('fleet_delivery_id_invalid');
  if (!SHA256_PATTERN.test(header.resultSha256)) fail('fleet_result_sha256_invalid');

  if (
    body.schema_version !== FLEET_DELIVERY_SCHEMA
    || !UUID_PATTERN.test(body.delivery_id ?? '')
    || !UUID_PATTERN.test(body.result_nonce ?? '')
    || !SHA256_PATTERN.test(body.result_sha256 ?? '')
    || !Number.isSafeInteger(body.result_bytes)
    || body.result_bytes < 1
    || !TERMINAL_STATUSES.has(body.terminal_status)
    || body.delivery_id !== header.deliveryId
    || body.result_sha256 !== header.resultSha256
  ) {
    fail('fleet_delivery_invalid');
  }

  const authorization = raw.authorization;
  const authorizationMatch = authorization.match(
    new RegExp(`^${FLEET_CALLBACK_AUTH_SCHEME} ([a-f0-9]{64})$`),
  );
  if (!authorizationMatch) fail('fleet_callback_credential_invalid', 401);
  const expectedHmac = createHmac('sha256', secret)
    .update(callbackSigningPayload(attemptId, header, body), 'utf8')
    .digest('hex');
  if (!secureHexEqual(authorizationMatch[1], expectedHmac)) {
    fail('fleet_callback_credential_invalid', 401);
  }
  if (body.result_bytes > FLEET_RESULT_HARD_MAX_BYTES) {
    fail('fleet_result_too_large', 413);
  }

  const resultBytes = decodeCanonicalBase64(body.result_b64);
  if (resultBytes.length !== body.result_bytes) fail('fleet_result_bytes_mismatch');
  const resultSha256 = createHash('sha256').update(resultBytes).digest('hex');
  if (!secureHexEqual(resultSha256, body.result_sha256)) {
    fail('fleet_result_digest_mismatch');
  }
  if (resultBytes.length > FLEET_RESULT_HARD_MAX_BYTES) {
    fail('fleet_result_too_large', 413);
  }

  let resultText;
  try {
    resultText = new TextDecoder('utf-8', { fatal: true }).decode(resultBytes);
  } catch {
    fail('fleet_result_utf8_invalid');
  }
  let resultValue;
  try {
    resultValue = JSON.parse(resultText);
  } catch {
    fail('fleet_result_json_invalid');
  }
  if (!resultValue || typeof resultValue !== 'object' || Array.isArray(resultValue)) {
    fail('fleet_result_json_invalid');
  }

  return Object.freeze({
    ...header,
    resultNonce: body.result_nonce,
    resultBytes: body.result_bytes,
    terminalStatus: body.terminal_status,
    resultValue,
  });
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

export function buildFleetResultReceiptAck({ receipt, deduped, secret }) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32) {
    fail('fleet_callback_secret_unavailable', 503);
  }
  const persistedAt = receipt.persisted_at instanceof Date
    ? receipt.persisted_at.toISOString()
    : new Date(receipt.persisted_at).toISOString();
  const ack = {
    schema_version: FLEET_RECEIPT_SCHEMA,
    receipt_id: receipt.receipt_id,
    attempt_id: receipt.attempt_id,
    run_id: receipt.run_id,
    worker_id: receipt.worker_id,
    job_id: receipt.job_id,
    lease_owner: receipt.lease_owner,
    lease_generation: receipt.lease_generation,
    delivery_id: receipt.delivery_id,
    result_nonce: receipt.result_nonce,
    result_sha256: receipt.result_sha256,
    result_bytes: receipt.result_bytes,
    terminal_status: receipt.terminal_status,
    receipt_status: deduped ? 'deduped' : 'accepted',
    persisted_at: persistedAt,
  };
  return Object.freeze({
    ...ack,
    receipt_hmac: createHmac('sha256', secret)
      .update(receiptSigningPayload(ack), 'utf8')
      .digest('hex'),
  });
}
