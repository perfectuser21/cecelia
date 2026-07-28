import { Buffer } from 'node:buffer';
import {
  createHash,
  createHmac,
  randomUUID as nodeRandomUUID,
} from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  openSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MACHINES = new Set(['us-mac-m4', 'xian-mac-m4', 'xian-mac-m1']);
const MAX_AUTH_JSON_BYTES = 196_608;
const MAX_DELIVERY_TTL_MS = 5 * 60 * 1000;
const PROVIDER_SOURCES = Object.freeze({
  codex: Object.freeze({
    account: /^team[1-5]$/,
    filename: 'auth.json',
  }),
  claude: Object.freeze({
    account: /^account[1-3]$/,
    filename: '.credentials.json',
  }),
  grok: Object.freeze({
    account: /^grok$/,
    filename: 'auth.json',
  }),
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

function fail(code) {
  throw new Error(code);
}

function validTimestamp(value) {
  return Number.isFinite(value)
    && Math.abs(value) <= 8_640_000_000_000_000;
}

function requireProviderAccount(provider, accountId) {
  const source = PROVIDER_SOURCES[provider];
  if (!source) fail('credential_provider_not_allowed');
  if (!source.account.test(accountId ?? '')) fail('credential_account_not_allowed');
  return source;
}

function tokenExpiry(auth, provider) {
  if (provider === 'codex') {
    const token = auth?.tokens?.access_token;
    if (typeof token !== 'string' || token.length === 0) {
      fail('credential_payload_invalid');
    }
    const parts = token.split('.');
    if (parts.length !== 3) fail('credential_expiry_unavailable');
    try {
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      if (!Number.isInteger(claims.exp) || claims.exp <= 0) {
        fail('credential_expiry_unavailable');
      }
      return claims.exp * 1000;
    } catch (error) {
      if (error?.message === 'credential_expiry_unavailable') throw error;
      fail('credential_expiry_unavailable');
    }
  }

  if (provider === 'claude') {
    const oauth = auth?.claudeAiOauth;
    if (
      typeof oauth?.accessToken !== 'string'
      || oauth.accessToken.length === 0
      || typeof oauth?.refreshToken !== 'string'
      || oauth.refreshToken.length === 0
      || !Number.isFinite(oauth.expiresAt)
    ) {
      fail('credential_payload_invalid');
    }
    return oauth.expiresAt;
  }

  if (provider === 'grok') {
    const record = Object.values(auth ?? {}).find((value) => (
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && typeof value.key === 'string'
      && value.key.length > 0
      && typeof value.refresh_token === 'string'
      && value.refresh_token.length > 0
    ));
    if (!record) fail('credential_payload_invalid');
    const parsed = Date.parse(record.expires_at);
    if (!Number.isFinite(parsed)) fail('credential_expiry_unavailable');
    return parsed;
  }

  fail('credential_provider_not_allowed');
}

function parseDeadline(value, nowMs) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed <= nowMs) {
    fail('credential_deadline_invalid');
  }
  return parsed;
}

function canonicalEnvelope(value) {
  const canonical = {};
  for (const field of SIGNED_FIELDS) canonical[field] = value[field];
  return JSON.stringify(canonical);
}

function signEnvelope(value, signingSecret) {
  return `hmac-sha256:${createHmac('sha256', signingSecret)
    .update(canonicalEnvelope(value), 'utf8')
    .digest('hex')}`;
}

export function createFileCredentialLoader({
  accountHomeResolver,
  openFile = openSync,
  fstat = fstatSync,
  readFile = readFileSync,
  closeFile = closeSync,
  maximumBytes = MAX_AUTH_JSON_BYTES,
} = {}) {
  if (typeof accountHomeResolver !== 'function') {
    fail('credential_account_home_resolver_required');
  }
  if (!Number.isInteger(maximumBytes) || maximumBytes <= 0) {
    fail('credential_source_limit_invalid');
  }

  return async function loadFileCredential(provider, accountId) {
    const source = requireProviderAccount(provider, accountId);
    let descriptor;
    try {
      const accountHome = accountHomeResolver(provider, accountId);
      if (
        typeof accountHome !== 'string'
        || !path.isAbsolute(accountHome)
        || accountHome === path.parse(accountHome).root
      ) {
        fail('credential_source_path_invalid');
      }
      const credentialFile = path.join(accountHome, source.filename);
      descriptor = openFile(
        credentialFile,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
      );
      const stat = fstat(descriptor);
      const permissions = stat.mode & 0o777;
      if (
        !stat.isFile()
        || ![0o400, 0o600].includes(permissions)
        || (
          typeof process.getuid === 'function'
          && Number.isInteger(stat.uid)
          && stat.uid !== process.getuid()
        )
      ) {
        fail('credential_source_permissions');
      }
      if (!Number.isInteger(stat.size) || stat.size <= 0 || stat.size > maximumBytes) {
        fail('credential_source_size_invalid');
      }
      return readFile(descriptor, 'utf8');
    } catch (error) {
      if (error?.message?.startsWith('credential_')) throw error;
      if (['EACCES', 'ELOOP'].includes(error?.code)) {
        fail('credential_source_permissions');
      }
      fail('credential_source_unavailable');
    } finally {
      if (descriptor !== undefined) {
        try {
          closeFile(descriptor);
        } catch {
          // Reading has already finished; never expose filesystem details.
        }
      }
    }
  };
}

export function createCredentialBroker({
  controllerMachineId,
  signingSecret,
  loadCredential,
  now = Date.now,
  randomUUID = nodeRandomUUID,
  safetyMarginMs = 5 * 60 * 1000,
  deliveryTtlMs = 60_000,
} = {}) {
  if (typeof loadCredential !== 'function') {
    fail('credential_loader_required');
  }
  if (
    typeof signingSecret !== 'string'
    || Buffer.byteLength(signingSecret, 'utf8') < 32
    || Buffer.byteLength(signingSecret, 'utf8') > 8_192
    || /[\r\n\0]/.test(signingSecret)
  ) {
    fail('credential_signing_secret_invalid');
  }
  if (!Number.isFinite(safetyMarginMs) || safetyMarginMs < 0) {
    fail('credential_margin_invalid');
  }
  if (
    !Number.isInteger(deliveryTtlMs)
    || deliveryTtlMs <= 0
    || deliveryTtlMs > MAX_DELIVERY_TTL_MS
  ) {
    fail('credential_delivery_ttl_invalid');
  }

  return Object.freeze({
    async issue({
      attemptId,
      runId,
      provider,
      accountId,
      machineId,
      leaseOwner,
      leaseGeneration,
      deadlineAt,
    } = {}) {
      if (controllerMachineId !== 'us-mac-m4') {
        fail('credential_broker_us_authority_required');
      }
      if (!UUID_PATTERN.test(attemptId ?? '')) fail('credential_attempt_invalid');
      if (!UUID_PATTERN.test(runId ?? '')) fail('credential_run_invalid');
      requireProviderAccount(provider, accountId);
      if (!MACHINES.has(machineId)) fail('credential_machine_not_allowed');
      if (
        typeof leaseOwner !== 'string'
        || leaseOwner.length === 0
        || leaseOwner.length > 256
        || /[\r\n\0]/.test(leaseOwner)
      ) {
        fail('credential_lease_owner_invalid');
      }
      if (!Number.isInteger(leaseGeneration) || leaseGeneration < 0) {
        fail('credential_lease_generation_invalid');
      }

      const nowMs = now();
      if (!validTimestamp(nowMs)) fail('credential_clock_invalid');
      const deadlineMs = parseDeadline(deadlineAt, nowMs);
      let raw;
      let auth;
      try {
        const loaded = await loadCredential(provider, accountId);
        raw = Buffer.isBuffer(loaded) ? loaded.toString('utf8') : String(loaded);
        if (Buffer.byteLength(raw, 'utf8') > MAX_AUTH_JSON_BYTES) {
          fail('credential_payload_too_large');
        }
        auth = JSON.parse(raw);
      } catch (error) {
        if (error?.message === 'credential_payload_too_large') throw error;
        fail('credential_payload_invalid');
      }
      if (!auth || typeof auth !== 'object' || Array.isArray(auth)) {
        fail('credential_payload_invalid');
      }
      const credentialExpiryMs = tokenExpiry(auth, provider);
      if (!validTimestamp(credentialExpiryMs)) fail('credential_expiry_unavailable');
      if (credentialExpiryMs < deadlineMs + safetyMarginMs) {
        fail('credential_lifetime_insufficient');
      }
      const credentialRef = randomUUID();
      const deliveryNonce = randomUUID();
      if (!UUID_PATTERN.test(credentialRef ?? '')) fail('credential_ref_invalid');
      if (!UUID_PATTERN.test(deliveryNonce ?? '') || deliveryNonce === credentialRef) {
        fail('credential_delivery_nonce_invalid');
      }
      const payloadHash = createHash('sha256').update(raw, 'utf8').digest('hex');
      const unsigned = {
        contract_version: 'provider-credential-envelope/v2',
        credential_ref: credentialRef,
        delivery_nonce: deliveryNonce,
        attempt_id: attemptId,
        run_id: runId,
        provider,
        account_id: accountId,
        machine_id: machineId,
        lease_owner: leaseOwner,
        lease_generation: leaseGeneration,
        issued_at: new Date(nowMs).toISOString(),
        expires_at: new Date(nowMs + deliveryTtlMs).toISOString(),
        payload_hash: `sha256:${payloadHash}`,
        payload: Buffer.from(raw, 'utf8').toString('base64'),
      };
      return Object.freeze({
        ...unsigned,
        signature: signEnvelope(unsigned, signingSecret),
      });
    },
  });
}

export const __test__ = Object.freeze({
  canonicalEnvelope,
  tokenExpiry,
});
