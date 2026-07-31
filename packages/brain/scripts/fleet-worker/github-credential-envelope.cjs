'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MACHINES = new Set(['us-mac-m4', 'xian-mac-m4', 'xian-mac-m1']);
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const MAX_ENCODED_PAYLOAD_CHARS = 21_848;
const FIELDS = new Set([
  'contract_version',
  'credential_ref',
  'attempt_id',
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
    fail('github_credential_payload_invalid');
  }
  const decoded = Buffer.from(value, 'base64').toString('utf8');
  if (
    decoded.length === 0
    || /[\r\n\0]/.test(decoded)
    || Buffer.from(decoded, 'utf8').toString('base64') !== value
  ) {
    fail('github_credential_payload_invalid');
  }
  return decoded;
}

function createGitHubCredentialEnvelopeConsumer({
  consumptionRoot,
  now = Date.now,
} = {}) {
  if (
    typeof consumptionRoot !== 'string'
    || !path.isAbsolute(consumptionRoot)
    || consumptionRoot === path.parse(consumptionRoot).root
  ) {
    fail('github_credential_consumption_root_invalid');
  }

  return Object.freeze({
    consume(envelope, {
      attemptId,
      machineId,
    } = {}) {
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
        fail('github_credential_envelope_required');
      }
      for (const field of Object.keys(envelope)) {
        if (!FIELDS.has(field)) {
          fail(`github_credential_envelope_unknown_field:${field}`);
        }
      }
      if (envelope.contract_version !== 'github-credential-envelope/v1') {
        fail('github_credential_envelope_version_invalid');
      }
      if (!UUID_PATTERN.test(envelope.credential_ref ?? '')) {
        fail('github_credential_ref_invalid');
      }
      if (!UUID_PATTERN.test(attemptId ?? '') || envelope.attempt_id !== attemptId) {
        fail('github_credential_attempt_mismatch');
      }
      if (!MACHINES.has(machineId) || envelope.machine_id !== machineId) {
        fail('github_credential_machine_mismatch');
      }
      const issuedMs = Date.parse(envelope.issued_at);
      const expiryMs = Date.parse(envelope.expires_at);
      const nowMs = now();
      if (!Number.isFinite(nowMs) || Math.abs(nowMs) > 8_640_000_000_000_000) {
        fail('github_credential_clock_invalid');
      }
      if (!Number.isFinite(issuedMs) || issuedMs > nowMs + 60_000) {
        fail('github_credential_envelope_issued_at_invalid');
      }
      if (!Number.isFinite(expiryMs) || expiryMs <= issuedMs) {
        fail('github_credential_envelope_expiry_invalid');
      }
      if (expiryMs <= nowMs) {
        fail('github_credential_envelope_expired');
      }
      if (!HASH_PATTERN.test(envelope.payload_hash ?? '')) {
        fail('github_credential_payload_hash_invalid');
      }
      const token = decodePayload(envelope.payload);
      const actualHash = `sha256:${createHash('sha256').update(token, 'utf8').digest('hex')}`;
      if (actualHash !== envelope.payload_hash) {
        fail('github_credential_payload_hash_mismatch');
      }

      fs.mkdirSync(consumptionRoot, { recursive: true, mode: 0o700 });
      const marker = path.join(
        consumptionRoot,
        `${envelope.credential_ref}.json`,
      );
      const metadata = {
        credential_ref: envelope.credential_ref,
        attempt_id: envelope.attempt_id,
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
        if (error?.code === 'EEXIST') {
          fail('github_credential_envelope_replayed');
        }
        fail('github_credential_consumption_failed');
      }
      return Object.freeze({
        credentialRef: envelope.credential_ref,
        token,
        metadata: Object.freeze(metadata),
      });
    },
  });
}

module.exports = {
  createGitHubCredentialEnvelopeConsumer,
};
