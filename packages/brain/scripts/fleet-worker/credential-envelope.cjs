'use strict';

const {
  createHash,
  createHmac,
  timingSafeEqual,
} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MACHINES = new Set(['us-mac-m4', 'xian-mac-m4', 'xian-mac-m1']);
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SIGNATURE_PATTERN = /^hmac-sha256:[a-f0-9]{64}$/;
const MAX_ENCODED_PAYLOAD_CHARS = 262_144;
const PROVIDER_ACCOUNTS = Object.freeze({
  codex: /^team[1-5]$/,
  claude: /^account[1-3]$/,
  grok: /^grok$/,
});
const SIGNED_FIELDS = Object.freeze([
  'contract_version',
  'credential_ref',
  'delivery_nonce',
  'attempt_id',
  'run_id',
  'provider',
  'account_id',
  'machine_id',
  'lease_owner',
  'lease_generation',
  'issued_at',
  'expires_at',
  'payload_hash',
  'payload',
]);
const FIELDS = new Set([...SIGNED_FIELDS, 'signature']);

function fail(code) {
  throw new Error(code);
}

function canonicalEnvelope(value) {
  const canonical = {};
  for (const field of SIGNED_FIELDS) canonical[field] = value[field];
  return JSON.stringify(canonical);
}

function verifySignature(envelope, signingSecret) {
  if (!SIGNATURE_PATTERN.test(envelope.signature ?? '')) {
    fail('credential_envelope_signature_invalid');
  }
  const expected = Buffer.from(
    `hmac-sha256:${createHmac('sha256', signingSecret)
      .update(canonicalEnvelope(envelope), 'utf8')
      .digest('hex')}`,
    'utf8',
  );
  const actual = Buffer.from(envelope.signature, 'utf8');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    fail('credential_envelope_signature_invalid');
  }
}

function validateProviderPayload(auth, provider) {
  if (provider === 'codex') {
    if (
      typeof auth.tokens?.access_token !== 'string'
      || auth.tokens.access_token.length === 0
    ) {
      fail('credential_payload_invalid');
    }
    return;
  }
  if (provider === 'claude') {
    if (
      typeof auth.claudeAiOauth?.accessToken !== 'string'
      || auth.claudeAiOauth.accessToken.length === 0
      || typeof auth.claudeAiOauth?.refreshToken !== 'string'
      || auth.claudeAiOauth.refreshToken.length === 0
    ) {
      fail('credential_payload_invalid');
    }
    return;
  }
  if (provider === 'grok') {
    const record = Object.values(auth).find((value) => (
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && typeof value.key === 'string'
      && value.key.length > 0
      && typeof value.refresh_token === 'string'
      && value.refresh_token.length > 0
    ));
    if (!record) fail('credential_payload_invalid');
    return;
  }
  fail('credential_provider_mismatch');
}

function decodePayload(value, provider) {
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
    if (!auth || typeof auth !== 'object' || Array.isArray(auth)) {
      fail('credential_payload_invalid');
    }
    validateProviderPayload(auth, provider);
  } catch (error) {
    if (error?.message === 'credential_payload_invalid') throw error;
    fail('credential_payload_invalid');
  }
  return decoded;
}

function validSigningSecret(value) {
  return typeof value === 'string'
    && Buffer.byteLength(value, 'utf8') >= 32
    && Buffer.byteLength(value, 'utf8') <= 8_192
    && !/[\r\n\0]/.test(value);
}

function createCredentialEnvelopeConsumer({
  consumptionRoot,
  signingSecret,
  now = Date.now,
} = {}) {
  if (
    typeof consumptionRoot !== 'string'
    || !path.isAbsolute(consumptionRoot)
    || consumptionRoot === path.parse(consumptionRoot).root
  ) {
    fail('credential_consumption_root_invalid');
  }
  if (!validSigningSecret(signingSecret)) {
    fail('credential_signing_secret_invalid');
  }

  return Object.freeze({
    consume(envelope, {
      attemptId,
      runId,
      provider,
      accountId,
      machineId,
      leaseOwner,
      leaseGeneration,
    } = {}) {
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
        fail('credential_envelope_required');
      }
      for (const field of Object.keys(envelope)) {
        if (!FIELDS.has(field)) fail(`credential_envelope_unknown_field:${field}`);
      }
      if (
        Object.keys(envelope).length !== FIELDS.size
        || [...FIELDS].some((field) => !Object.hasOwn(envelope, field))
      ) {
        fail('credential_envelope_fields_invalid');
      }
      if (envelope.contract_version !== 'provider-credential-envelope/v2') {
        fail('credential_envelope_version_invalid');
      }
      if (!UUID_PATTERN.test(envelope.credential_ref ?? '')) {
        fail('credential_ref_invalid');
      }
      if (
        !UUID_PATTERN.test(envelope.delivery_nonce ?? '')
        || envelope.delivery_nonce === envelope.credential_ref
      ) {
        fail('credential_delivery_nonce_invalid');
      }
      if (!UUID_PATTERN.test(attemptId ?? '') || envelope.attempt_id !== attemptId) {
        fail('credential_attempt_mismatch');
      }
      if (!UUID_PATTERN.test(runId ?? '') || envelope.run_id !== runId) {
        fail('credential_run_mismatch');
      }
      if (!PROVIDER_ACCOUNTS[provider] || envelope.provider !== provider) {
        fail('credential_provider_mismatch');
      }
      if (
        !PROVIDER_ACCOUNTS[provider].test(accountId ?? '')
        || envelope.account_id !== accountId
      ) {
        fail('credential_account_mismatch');
      }
      if (!MACHINES.has(machineId) || envelope.machine_id !== machineId) {
        fail('credential_machine_mismatch');
      }
      if (
        typeof leaseOwner !== 'string'
        || leaseOwner.length === 0
        || /[\r\n\0]/.test(leaseOwner)
        || envelope.lease_owner !== leaseOwner
      ) {
        fail('credential_lease_owner_mismatch');
      }
      if (
        !Number.isInteger(leaseGeneration)
        || leaseGeneration < 0
        || envelope.lease_generation !== leaseGeneration
      ) {
        fail('credential_lease_generation_mismatch');
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
      verifySignature(envelope, signingSecret);
      const authJson = decodePayload(envelope.payload, provider);
      const actualHash = `sha256:${createHash('sha256')
        .update(authJson, 'utf8')
        .digest('hex')}`;
      if (actualHash !== envelope.payload_hash) {
        fail('credential_payload_hash_mismatch');
      }

      fs.mkdirSync(consumptionRoot, { recursive: true, mode: 0o700 });
      const marker = path.join(consumptionRoot, `${envelope.delivery_nonce}.json`);
      const metadata = {
        credential_ref: envelope.credential_ref,
        delivery_nonce: envelope.delivery_nonce,
        attempt_id: envelope.attempt_id,
        run_id: envelope.run_id,
        provider: envelope.provider,
        account_id: envelope.account_id,
        machine_id: envelope.machine_id,
        lease_owner: envelope.lease_owner,
        lease_generation: envelope.lease_generation,
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
        deliveryNonce: envelope.delivery_nonce,
        provider: envelope.provider,
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
