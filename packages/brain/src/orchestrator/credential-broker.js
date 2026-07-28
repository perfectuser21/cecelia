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
import { sha256Canonical } from '../lib/kernel-equivalence-receipts.js';

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MACHINES = new Set(['us-mac-m4', 'xian-mac-m4', 'xian-mac-m1']);
const MAX_AUTH_JSON_BYTES = 196_608;
const MAX_DELIVERY_TTL_MS = 5 * 60 * 1000;
const CREDENTIAL_EQUIVALENCE_SEAM_ID = 'kernel.credential.attempt_lease';
const CREDENTIAL_EQUIVALENCE_EFFECTS = Object.freeze({
  normal: Object.freeze({
    observed_outcome: 'confirmed',
    effect_code: 'credential_lease_issued',
  }),
  violation: Object.freeze({
    observed_outcome: 'denied',
    effect_code: 'credential_lease_denied',
  }),
  recovery: Object.freeze({
    observed_outcome: 'recovered',
    effect_code: 'credential_lease_refreshed',
  }),
});
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

function equivalenceFail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
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

/**
 * Executes the real central Credential Broker behind a server-owned drill
 * authority. The caller supplies only the verified resource identity; issue
 * inputs and before/after observations are loaded by the seam owner.
 *
 * Credential bytes and signed delivery envelopes never enter the equivalence
 * receipt. Only canonical hashes of authority-sanitized snapshots are signed.
 */
export function createCredentialGuardEquivalenceSeam({
  credentialBroker,
  credentialAuthority,
  effectSigner,
} = {}) {
  if (typeof credentialBroker?.issue !== 'function') {
    equivalenceFail('credential_equivalence_broker_unavailable');
  }
  if (typeof effectSigner?.signEffectResult !== 'function') {
    equivalenceFail('seam_effect_signer_unavailable');
  }
  if (
    credentialAuthority?.owner_service !== CREDENTIAL_EQUIVALENCE_SEAM_ID
    || typeof credentialAuthority?.loadIssueRequest !== 'function'
    || typeof credentialAuthority?.snapshot !== 'function'
    || typeof credentialAuthority?.confirmDenial !== 'function'
    || typeof credentialAuthority?.confirmRefresh !== 'function'
    || typeof credentialAuthority?.cancel !== 'function'
    || typeof credentialAuthority?.cleanup !== 'function'
  ) {
    equivalenceFail('credential_equivalence_authority_unavailable');
  }

  return Object.freeze({
    owner_service: CREDENTIAL_EQUIVALENCE_SEAM_ID,

    async invoke({
      cell,
      grant,
      resource,
      predecessor = null,
      signal,
    } = {}) {
      signal?.throwIfAborted();
      const effect = CREDENTIAL_EQUIVALENCE_EFFECTS[cell?.scenario];
      if (
        cell?.seam_id !== CREDENTIAL_EQUIVALENCE_SEAM_ID
        || grant?.seam_id !== CREDENTIAL_EQUIVALENCE_SEAM_ID
        || grant?.adapter_id !== cell?.adapter_id
        || resource?.resource_id !== grant?.resource_id
        || resource?.resource_ref !== grant?.resource_ref
      ) {
        equivalenceFail('credential_equivalence_resource_invalid');
      }
      if (!effect) {
        equivalenceFail('credential_equivalence_scenario_invalid');
      }
      if (
        (cell.scenario === 'recovery' && predecessor == null)
        || (cell.scenario !== 'recovery' && predecessor != null)
      ) {
        equivalenceFail('credential_equivalence_predecessor_invalid');
      }

      const authorityResource = Object.freeze({
        resource_id: resource.resource_id,
        resource_ref: resource.resource_ref,
      });
      const request = await credentialAuthority.loadIssueRequest({
        cell,
        grant,
        resource: authorityResource,
        predecessor,
        signal,
      });
      signal?.throwIfAborted();
      const before = await credentialAuthority.snapshot({
        phase: 'before',
        cell,
        grant,
        resource: authorityResource,
        request,
        predecessor,
        signal,
      });
      signal?.throwIfAborted();

      let envelope = null;
      let issueError = null;
      try {
        envelope = await credentialBroker.issue(request);
      } catch (error) {
        issueError = error;
      }
      signal?.throwIfAborted();

      if (cell.scenario === 'violation') {
        const confirmed = await credentialAuthority.confirmDenial({
          cell,
          grant,
          resource: authorityResource,
          request,
          error: issueError,
          signal,
        });
        signal?.throwIfAborted();
        if (
          issueError == null
          || envelope != null
          || confirmed !== true
        ) {
          equivalenceFail('credential_denial_unconfirmed');
        }
      } else {
        if (issueError != null || envelope == null) {
          equivalenceFail('credential_lease_unconfirmed');
        }
        if (cell.scenario === 'recovery') {
          const refreshed = await credentialAuthority.confirmRefresh({
            cell,
            grant,
            resource: authorityResource,
            request,
            envelope,
            predecessor,
            signal,
          });
          signal?.throwIfAborted();
          if (refreshed !== true) {
            equivalenceFail('credential_refresh_unconfirmed');
          }
        }
      }

      const after = await credentialAuthority.snapshot({
        phase: 'after',
        cell,
        grant,
        resource: authorityResource,
        request,
        envelope,
        issue_error_code: issueError?.message ?? null,
        predecessor,
        signal,
      });
      signal?.throwIfAborted();
      if (
        !before
        || typeof before !== 'object'
        || Array.isArray(before)
        || !after
        || typeof after !== 'object'
        || Array.isArray(after)
      ) {
        equivalenceFail('credential_equivalence_snapshot_invalid');
      }

      return effectSigner.signEffectResult({
        cell,
        grant,
        observation: {
          observed_outcome: effect.observed_outcome,
          effect_code: effect.effect_code,
          before_hash: sha256Canonical(before),
          after_hash: sha256Canonical(after),
        },
        predecessor,
      });
    },

    async cancel(context = {}) {
      return credentialAuthority.cancel({
        ...context,
        resource: context?.resource == null
          ? null
          : {
            resource_id: context.resource.resource_id,
            resource_ref: context.resource.resource_ref,
          },
      });
    },

    async cleanup(context = {}) {
      return credentialAuthority.cleanup({
        ...context,
        resource: context?.resource == null
          ? null
          : {
            resource_id: context.resource.resource_id,
            resource_ref: context.resource.resource_ref,
          },
      });
    },
  });
}

export const __test__ = Object.freeze({
  canonicalEnvelope,
  tokenExpiry,
});
