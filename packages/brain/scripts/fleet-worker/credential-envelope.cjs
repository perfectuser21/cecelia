'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ACCOUNT_PATTERN = /^team[1-5]$/;
const MACHINES = new Set(['us-mac-m4', 'xian-mac-m4', 'xian-mac-m1']);
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const MAX_ENCODED_PAYLOAD_CHARS = 262_144;
const FIELDS = new Set([
  'contract_version',
  'credential_ref',
  'attempt_id',
  'account_id',
  'machine_id',
  'issued_at',
  'expires_at',
  'payload_hash',
  'payload',
]);

function fail(code) {
  throw new Error(code);
}

function decodePayload(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_ENCODED_PAYLOAD_CHARS
  ) {
    fail('credential_payload_invalid');
  }
  let decoded;
  try {
    decoded = Buffer.from(value, 'base64').toString('utf8');
    if (Buffer.from(decoded, 'utf8').toString('base64') !== value) {
      fail('credential_payload_invalid');
    }
    const auth = JSON.parse(decoded);
    if (
      !auth
      || typeof auth !== 'object'
      || Array.isArray(auth)
      || typeof auth.tokens?.access_token !== 'string'
      || auth.tokens.access_token.length === 0
    ) {
      fail('credential_payload_invalid');
    }
  } catch (error) {
    if (error?.message === 'credential_payload_invalid') throw error;
    fail('credential_payload_invalid');
  }
  return decoded;
}

function createCredentialEnvelopeConsumer({
  consumptionRoot,
  now = Date.now,
} = {}) {
  if (
    typeof consumptionRoot !== 'string'
    || !path.isAbsolute(consumptionRoot)
    || consumptionRoot === path.parse(consumptionRoot).root
  ) {
    fail('credential_consumption_root_invalid');
  }

  return Object.freeze({
    consume(envelope, {
      attemptId,
      accountId,
      machineId,
    } = {}) {
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
        fail('credential_envelope_required');
      }
      for (const field of Object.keys(envelope)) {
        if (!FIELDS.has(field)) fail(`credential_envelope_unknown_field:${field}`);
      }
      if (envelope.contract_version !== 'credential-envelope/v1') {
        fail('credential_envelope_version_invalid');
      }
      if (!UUID_PATTERN.test(envelope.credential_ref ?? '')) fail('credential_ref_invalid');
      if (!UUID_PATTERN.test(attemptId ?? '') || envelope.attempt_id !== attemptId) {
        fail('credential_attempt_mismatch');
      }
      if (!ACCOUNT_PATTERN.test(accountId ?? '') || envelope.account_id !== accountId) {
        fail('credential_account_mismatch');
      }
      if (!MACHINES.has(machineId) || envelope.machine_id !== machineId) {
        fail('credential_machine_mismatch');
      }
      const issuedMs = Date.parse(envelope.issued_at);
      const expiryMs = Date.parse(envelope.expires_at);
      const nowMs = now();
      if (
        !Number.isFinite(nowMs)
        || Math.abs(nowMs) > 8_640_000_000_000_000
      ) {
        fail('credential_clock_invalid');
      }
      if (!Number.isFinite(issuedMs) || issuedMs > nowMs + 60_000) {
        fail('credential_envelope_issued_at_invalid');
      }
      if (!Number.isFinite(expiryMs) || expiryMs <= issuedMs) {
        fail('credential_envelope_expiry_invalid');
      }
      if (expiryMs <= nowMs) {
        fail('credential_envelope_expired');
      }
      if (!HASH_PATTERN.test(envelope.payload_hash ?? '')) {
        fail('credential_payload_hash_invalid');
      }
      const authJson = decodePayload(envelope.payload);
      const actualHash = `sha256:${createHash('sha256').update(authJson, 'utf8').digest('hex')}`;
      if (actualHash !== envelope.payload_hash) {
        fail('credential_payload_hash_mismatch');
      }

      fs.mkdirSync(consumptionRoot, { recursive: true, mode: 0o700 });
      const marker = path.join(consumptionRoot, `${envelope.credential_ref}.json`);
      const metadata = {
        credential_ref: envelope.credential_ref,
        attempt_id: envelope.attempt_id,
        account_id: envelope.account_id,
        machine_id: envelope.machine_id,
        issued_at: envelope.issued_at,
        expires_at: envelope.expires_at,
        payload_hash: envelope.payload_hash,
      };
      try {
        fs.writeFileSync(marker, `${JSON.stringify(metadata)}\n`, {
          encoding: 'utf8',
          mode: 0o600,
          flag: 'wx',
        });
      } catch (error) {
        if (error?.code === 'EEXIST') fail('credential_envelope_replayed');
        fail('credential_consumption_failed');
      }
      return Object.freeze({
        credentialRef: envelope.credential_ref,
        accountId: envelope.account_id,
        authJson,
        metadata: Object.freeze(metadata),
      });
    },
  });
}

module.exports = {
  createCredentialEnvelopeConsumer,
};
