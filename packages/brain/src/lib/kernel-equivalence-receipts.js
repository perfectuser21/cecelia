import {
  createHash,
  createPublicKey,
  verify as verifyBytes,
} from 'node:crypto';
import {
  verifyCleanupEvidence,
} from './kernel-equivalence-runtime-registry.js';

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;
const SAFE_RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SAFE_RESOURCE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const FORBIDDEN_RESOURCE = /(?:^|[/_.:-])(?:main|master|production|prod|release)(?:$|[/_.:-])/i;
const DENIAL_OUTCOMES = new Set(['denied', 'blocked', 'rejected', 'failed']);
const HISTORICAL_BUNDLE_VERIFICATION = Symbol(
  'kernel-equivalence-historical-bundle-verification',
);
const KEY_PURPOSES = new Set([
  'execution_grant',
  'effect_receipt',
  'collector_bundle',
]);
const REGISTRY_FIELDS = Object.freeze([
  'algorithm',
  'collector_bundle_max_age_seconds',
  'effect_receipt_max_age_seconds',
  'grant_max_age_seconds',
  'keys',
  'replay_nonce',
  'schema_version',
]);
const REPLAY_FIELDS = Object.freeze([
  'atomic_consumer_required',
  'single_use',
]);

const KEY_FIELDS = Object.freeze([
  'key_id',
  'not_after',
  'not_before',
  'public_key_pem',
  'purpose',
  'revoked_at',
  'rotates_key_id',
  'service_id',
]);

const GRANT_FIELDS = Object.freeze([
  'adapter_id',
  'artifact_sha',
  'attempt_id',
  'behavior_id',
  'brain_version',
  'cell_id',
  'engine_version',
  'environment',
  'expires_at',
  'grant_id',
  'issued_at',
  'key_id',
  'nonce',
  'provider',
  'resource_id',
  'resource_prefix',
  'resource_ref',
  'run_id',
  'scenario',
  'schema_version',
  'scopes',
  'seam_id',
  'signature',
]);

const EFFECT_FIELDS = Object.freeze([
  'adapter_id',
  'after_hash',
  'artifact_sha',
  'attempt_id',
  'before_hash',
  'behavior_id',
  'brain_version',
  'cell_id',
  'effect_code',
  'engine_version',
  'environment',
  'execution_mode',
  'expires_at',
  'grant_id',
  'issued_at',
  'key_id',
  'nonce',
  'observed_outcome',
  'predecessor_cell_id',
  'predecessor_receipt_hash',
  'predecessor_receipt_id',
  'provider',
  'receipt_id',
  'resource_id',
  'resource_ref',
  'run_id',
  'scenario',
  'schema_version',
  'seam_id',
  'service_id',
  'signature',
]);

const BUNDLE_FIELDS = Object.freeze([
  'adapter_id',
  'artifact_sha',
  'attempt_id',
  'behavior_id',
  'brain_version',
  'bundle_id',
  'bundle_payload_hash',
  'cell_id',
  'collector_service_id',
  'cleanup_evidence',
  'effect_receipts',
  'engine_version',
  'environment',
  'execution_grants',
  'expires_at',
  'grant_id',
  'grant_hashes',
  'issued_at',
  'key_id',
  'nonce',
  'previous_bundle_hash',
  'provider',
  'receipt_hashes',
  'resource_id',
  'resource_ref',
  'run_id',
  'scenario',
  'schema_version',
  'seam_id',
  'signature',
]);

export class EquivalenceReceiptError extends Error {
  constructor(code, detail = null) {
    super(code);
    this.name = 'EquivalenceReceiptError';
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, detail = null) {
  throw new EquivalenceReceiptError(code, detail);
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function nonEmpty(value) {
  return typeof value === 'string' && value.length > 0;
}

function canonicalValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonicalValue);
  const object = asObject(value);
  if (!object) fail('canonical_value_invalid');
  return Object.fromEntries(
    Object.keys(object)
      .sort()
      .map((key) => {
        if (object[key] === undefined) fail('canonical_value_invalid', key);
        return [key, canonicalValue(object[key])];
      }),
  );
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function sha256Canonical(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function exactFields(value, allowed, code) {
  const object = asObject(value);
  if (!object) fail(code);
  const actual = Object.keys(object).sort();
  const expected = [...allowed].sort();
  if (
    actual.length !== expected.length
    || actual.some((field, index) => field !== expected[index])
  ) {
    fail(code);
  }
}

function parseTime(value, code) {
  if (!nonEmpty(value)) fail(code);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail(code);
  return parsed;
}

export function validateTrustRegistry(registry) {
  try {
    exactFields(registry, REGISTRY_FIELDS, 'trust_registry_invalid');
    exactFields(
      registry.replay_nonce,
      REPLAY_FIELDS,
      'trust_registry_invalid',
    );
    if (
      registry.schema_version !== 'kernel-equivalence-trust-registry/v1'
      || registry.algorithm !== 'ed25519'
      || !Number.isInteger(registry.grant_max_age_seconds)
      || registry.grant_max_age_seconds < 1
      || !Number.isInteger(registry.effect_receipt_max_age_seconds)
      || registry.effect_receipt_max_age_seconds < 1
      || !Number.isInteger(registry.collector_bundle_max_age_seconds)
      || registry.collector_bundle_max_age_seconds < 1
      || registry.replay_nonce.single_use !== true
      || registry.replay_nonce.atomic_consumer_required !== true
      || !Array.isArray(registry.keys)
    ) {
      fail('trust_registry_invalid');
    }

    const keyIds = new Set();
    for (const key of registry.keys) {
      exactFields(key, KEY_FIELDS, 'trust_registry_invalid');
      const notBefore = parseTime(key.not_before, 'trust_registry_invalid');
      const notAfter = parseTime(key.not_after, 'trust_registry_invalid');
      const revokedAt = key.revoked_at == null
        ? null
        : parseTime(key.revoked_at, 'trust_registry_invalid');
      if (
        !nonEmpty(key.key_id)
        || keyIds.has(key.key_id)
        || !KEY_PURPOSES.has(key.purpose)
        || !nonEmpty(key.service_id)
        || notAfter <= notBefore
        || (revokedAt != null && revokedAt < notBefore)
        || (
          key.rotates_key_id != null
          && !nonEmpty(key.rotates_key_id)
        )
        || !nonEmpty(key.public_key_pem)
        || !key.public_key_pem.startsWith('-----BEGIN PUBLIC KEY-----')
        || key.public_key_pem.includes('PRIVATE KEY')
        || (
          key.purpose === 'execution_grant'
          && key.service_id !== 'brain.authority'
        )
        || (
          key.purpose === 'collector_bundle'
          && key.service_id !== 'kernel.equivalence.collector'
        )
      ) {
        fail('trust_registry_invalid');
      }
      let publicKey;
      try {
        publicKey = createPublicKey(key.public_key_pem);
      } catch {
        fail('trust_registry_invalid');
      }
      if (publicKey.asymmetricKeyType !== 'ed25519') {
        fail('trust_registry_invalid');
      }
      keyIds.add(key.key_id);
    }
    const keysById = new Map(registry.keys.map((key) => [key.key_id, key]));
    for (const key of registry.keys) {
      if (
        key.rotates_key_id != null
        && (
          key.rotates_key_id === key.key_id
          || !keyIds.has(key.rotates_key_id)
          || keysById.get(key.rotates_key_id)?.purpose !== key.purpose
          || keysById.get(key.rotates_key_id)?.service_id !== key.service_id
          || Date.parse(key.not_before)
            < Date.parse(keysById.get(key.rotates_key_id)?.not_before)
        )
      ) {
        fail('trust_registry_invalid');
      }
    }
    for (const start of registry.keys) {
      const seen = new Set();
      let current = start;
      while (current?.rotates_key_id != null) {
        if (seen.has(current.key_id)) fail('trust_registry_invalid');
        seen.add(current.key_id);
        current = keysById.get(current.rotates_key_id);
      }
    }
    return Object.freeze(structuredClone(registry));
  } catch (error) {
    if (error?.code === 'trust_registry_invalid') throw error;
    fail('trust_registry_invalid');
  }
}

function verifyWindow(value, now, maximumAgeSeconds, prefix) {
  const issuedAt = parseTime(value.issued_at, `${prefix}_time_invalid`);
  const expiresAt = parseTime(value.expires_at, `${prefix}_time_invalid`);
  if (issuedAt > now) fail(`${prefix}_not_yet_valid`);
  if (expiresAt <= now) fail(`${prefix}_expired`);
  if (
    expiresAt <= issuedAt
    || !Number.isInteger(maximumAgeSeconds)
    || maximumAgeSeconds < 1
    || expiresAt - issuedAt > maximumAgeSeconds * 1000
  ) {
    fail(`${prefix}_freshness_invalid`);
  }
}

function verifyNow(now) {
  if (typeof now !== 'number' || !Number.isFinite(now)) {
    fail('verification_time_invalid');
  }
}

function findKey(registry, {
  keyId,
  purpose,
  serviceId = null,
  now,
  code,
}) {
  validateTrustRegistry(registry);
  const key = registry.keys.find((candidate) => candidate?.key_id === keyId);
  if (!key) fail(code);
  exactFields(key, KEY_FIELDS, 'trust_key_fields_invalid');
  const notBefore = parseTime(key.not_before, 'trust_key_time_invalid');
  const notAfter = parseTime(key.not_after, 'trust_key_time_invalid');
  const revokedAt = key.revoked_at == null
    ? null
    : parseTime(key.revoked_at, 'trust_key_time_invalid');
  if (
    key.purpose !== purpose
    || (serviceId != null && key.service_id !== serviceId)
    || now < notBefore
    || now >= notAfter
    || (revokedAt != null && now >= revokedAt)
    || !nonEmpty(key.public_key_pem)
  ) {
    fail(code);
  }
  return key;
}

function unsignedPayload(value) {
  const payload = structuredClone(value);
  delete payload.signature;
  return payload;
}

function verifySignature(value, key, code) {
  if (
    !nonEmpty(value.signature)
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.signature)
  ) {
    fail(code);
  }
  let publicKey;
  try {
    publicKey = createPublicKey(key.public_key_pem);
  } catch {
    fail(code);
  }
  const valid = verifyBytes(
    null,
    Buffer.from(canonicalJson(unsignedPayload(value)), 'utf8'),
    publicKey,
    Buffer.from(value.signature, 'base64'),
  );
  if (!valid) fail(code);
}

function expectedPrefix(cell, runId, attemptId) {
  return cell?.isolation?.resource_prefix
    ?.replaceAll('{run_id}', runId)
    .replaceAll('{attempt_id}', attemptId);
}

function validRuntimePrefix(prefix) {
  if (
    !nonEmpty(prefix)
    || prefix.length > 512
    || !prefix.endsWith('/')
    || /[^\x20-\x7e]/.test(prefix)
    || /[{}:]/.test(prefix)
  ) {
    return false;
  }
  const relative = prefix.startsWith('refs/heads/')
    ? prefix.slice('refs/heads/'.length)
    : prefix;
  const segments = relative.slice(0, -1).split('/');
  return (
    segments.length >= 3
    && segments[0] === 'equivalence-drill'
    && UUID_PATTERN.test(segments[1] ?? '')
    && UUID_PATTERN.test(segments[2] ?? '')
    && segments.slice(3).every((segment) => SAFE_RESOURCE_SEGMENT.test(segment))
  );
}

function validResource(value, prefix) {
  const resourceRef = value?.resource_ref;
  const resourceId = value?.resource_id;
  const suffix = typeof resourceRef === 'string'
    && typeof prefix === 'string'
    && resourceRef.startsWith(prefix)
    ? resourceRef.slice(prefix.length)
    : '';
  return (
    value.environment === 'isolated'
    && SAFE_RESOURCE_ID.test(resourceId ?? '')
    && validRuntimePrefix(prefix)
    && nonEmpty(resourceRef)
    && resourceRef.length <= 1_024
    && !/[^\x20-\x7e]/.test(resourceRef)
    && suffix.length > 0
    && suffix.split('/').every((segment) => SAFE_RESOURCE_SEGMENT.test(segment))
    && !FORBIDDEN_RESOURCE.test(resourceId)
    && !FORBIDDEN_RESOURCE.test(prefix)
    && !FORBIDDEN_RESOURCE.test(resourceRef)
  );
}

function matchesAxes(value, expected) {
  const cell = expected?.cell;
  return (
    value.cell_id === cell?.cell_id
    && value.behavior_id === cell?.behavior_id
    && value.provider === cell?.provider
    && value.scenario === cell?.scenario
    && value.seam_id === cell?.seam_id
    && value.adapter_id === cell?.adapter_id
    && value.run_id === expected?.run_id
    && value.attempt_id === expected?.attempt_id
    && value.artifact_sha === expected?.artifact_sha
    && value.brain_version === expected?.brain_version
    && value.engine_version === expected?.engine_version
  );
}

function validateIdentity(value, prefix) {
  if (
    !UUID_PATTERN.test(value.run_id ?? '')
    || !UUID_PATTERN.test(value.attempt_id ?? '')
    || !SHA_PATTERN.test(value.artifact_sha ?? '')
    || !VERSION_PATTERN.test(value.brain_version ?? '')
    || !VERSION_PATTERN.test(value.engine_version ?? '')
  ) {
    fail(`${prefix}_identity_invalid`);
  }
}

export function verifyExecutionGrant(grant, registry, expected, { now = Date.now() } = {}) {
  verifyNow(now);
  exactFields(grant, GRANT_FIELDS, 'grant_fields_invalid');
  if (
    grant.schema_version !== 'kernel-equivalence-execution-grant/v1'
    || !UUID_PATTERN.test(grant.grant_id ?? '')
    || !UUID_PATTERN.test(grant.nonce ?? '')
    || !matchesAxes(grant, expected)
  ) {
    fail('grant_axis_mismatch');
  }
  validateIdentity(grant, 'grant');
  const prefix = expectedPrefix(expected.cell, grant.run_id, grant.attempt_id);
  if (
    grant.resource_prefix !== prefix
    || !validResource(grant, prefix)
    || !Array.isArray(grant.scopes)
    || grant.scopes.length !== 1
    || grant.scopes[0] !== 'isolated_effect'
  ) {
    fail('grant_environment_unsafe');
  }
  verifyWindow(grant, now, registry?.grant_max_age_seconds, 'grant');
  const key = findKey(registry, {
    keyId: grant.key_id,
    purpose: 'execution_grant',
    serviceId: 'brain.authority',
    now,
    code: 'grant_key_invalid',
  });
  verifySignature(grant, key, 'grant_signature_invalid');
  return Object.freeze(structuredClone(grant));
}

function expectedViolationCell(recoveryCell) {
  return {
    ...recoveryCell,
    cell_id: recoveryCell.cell_id.replace(/::recovery$/, '::violation'),
    scenario: 'violation',
  };
}

function verifyRecoveryLineage(receipt, expected) {
  const predecessor = expected?.predecessor;
  const violationCell = expectedViolationCell(expected.cell);
  if (
    !predecessor
    || receipt.predecessor_cell_id !== violationCell.cell_id
    || receipt.predecessor_receipt_id !== predecessor.receipt_id
    || receipt.predecessor_receipt_hash !== sha256Canonical(predecessor)
    || predecessor.cell_id !== violationCell.cell_id
    || predecessor.behavior_id !== receipt.behavior_id
    || predecessor.provider !== receipt.provider
    || predecessor.scenario !== 'violation'
    || predecessor.run_id !== receipt.run_id
    || predecessor.resource_id !== receipt.resource_id
    || predecessor.resource_ref !== receipt.resource_ref
    || predecessor.artifact_sha !== receipt.artifact_sha
    || predecessor.seam_id !== receipt.seam_id
    || !DENIAL_OUTCOMES.has(predecessor.observed_outcome)
  ) {
    fail('recovery_lineage_invalid');
  }
}

export function verifyEffectReceipt(receipt, registry, expected, { now = Date.now() } = {}) {
  verifyNow(now);
  exactFields(receipt, EFFECT_FIELDS, 'effect_fields_invalid');
  if (
    receipt.schema_version !== 'kernel-equivalence-effect-receipt/v1'
    || !UUID_PATTERN.test(receipt.receipt_id ?? '')
    || !matchesAxes(receipt, expected)
  ) {
    fail('effect_axis_mismatch');
  }
  validateIdentity(receipt, 'effect');
  if (
    !UUID_PATTERN.test(expected?.grant_id ?? '')
    || !UUID_PATTERN.test(expected?.nonce ?? '')
    || !nonEmpty(expected?.resource_id)
    || !nonEmpty(expected?.resource_ref)
    || !nonEmpty(expected?.resource_prefix)
    || receipt.grant_id !== expected.grant_id
    || receipt.nonce !== expected.nonce
    || receipt.resource_id !== expected.resource_id
    || receipt.resource_ref !== expected.resource_ref
  ) {
    fail('effect_axis_mismatch');
  }
  verifyWindow(
    receipt,
    now,
    registry?.effect_receipt_max_age_seconds,
    'effect',
  );
  const key = findKey(registry, {
    keyId: receipt.key_id,
    purpose: 'effect_receipt',
    serviceId: receipt.seam_id,
    now,
    code: 'effect_key_invalid',
  });
  if (
    receipt.service_id !== key.service_id
    || !nonEmpty(expected?.cell?.effect_key_id)
    || receipt.key_id !== expected.cell.effect_key_id
  ) {
    fail('effect_key_invalid');
  }
  verifySignature(receipt, key, 'effect_signature_invalid');

  if (
    receipt.execution_mode !== 'live_effect'
    || !HASH_PATTERN.test(receipt.before_hash ?? '')
    || !HASH_PATTERN.test(receipt.after_hash ?? '')
    || !nonEmpty(receipt.effect_code)
    || !validResource(receipt, expected.resource_prefix)
  ) {
    fail('effect_outcome_invalid');
  }
  if (receipt.scenario === 'normal') {
    if (
      receipt.observed_outcome !== 'confirmed'
      || receipt.predecessor_cell_id != null
      || receipt.predecessor_receipt_id != null
      || receipt.predecessor_receipt_hash != null
    ) {
      fail('effect_outcome_invalid');
    }
  } else if (receipt.scenario === 'violation') {
    if (
      !DENIAL_OUTCOMES.has(receipt.observed_outcome)
      || receipt.predecessor_cell_id != null
      || receipt.predecessor_receipt_id != null
      || receipt.predecessor_receipt_hash != null
    ) {
      fail('effect_outcome_invalid');
    }
  } else if (receipt.scenario === 'recovery') {
    if (receipt.observed_outcome !== 'recovered') fail('effect_outcome_invalid');
    verifyRecoveryLineage(receipt, expected);
  } else {
    fail('effect_outcome_invalid');
  }
  return Object.freeze(structuredClone(receipt));
}

function bundlePayload(
  previousBundleHash,
  grantHashes,
  receiptHashes,
  cleanupEvidenceHash,
) {
  return {
    previous_bundle_hash: previousBundleHash,
    grant_hashes: grantHashes,
    receipt_hashes: receiptHashes,
    cleanup_evidence_hash: cleanupEvidenceHash,
  };
}

export function assembleUnsignedBundle({
  keyId,
  collectorServiceId,
  issuedAt,
  expiresAt,
  expected,
  executionGrants,
  receipts,
  cleanupEvidence,
  previousBundleHash = null,
}) {
  const grantHashes = executionGrants.map(sha256Canonical);
  const receiptHashes = receipts.map(sha256Canonical);
  const cleanupEvidenceHash = sha256Canonical(cleanupEvidence);
  const payloadHash = sha256Canonical(
    bundlePayload(
      previousBundleHash,
      grantHashes,
      receiptHashes,
      cleanupEvidenceHash,
    ),
  );
  return {
    schema_version: 'kernel-equivalence-receipt-bundle/v1',
    bundle_id: `bundle:${payloadHash}`,
    key_id: keyId,
    collector_service_id: collectorServiceId,
    issued_at: issuedAt,
    expires_at: expiresAt,
    cell_id: expected.cell.cell_id,
    behavior_id: expected.cell.behavior_id,
    provider: expected.cell.provider,
    scenario: expected.cell.scenario,
    run_id: expected.run_id,
    attempt_id: expected.attempt_id,
    grant_id: expected.grant_id,
    nonce: expected.nonce,
    artifact_sha: expected.artifact_sha,
    brain_version: expected.brain_version,
    engine_version: expected.engine_version,
    environment: expected.cell.isolation.environment,
    resource_id: expected.resource_id,
    resource_ref: expected.resource_ref,
    seam_id: expected.cell.seam_id,
    adapter_id: expected.cell.adapter_id,
    previous_bundle_hash: previousBundleHash,
    execution_grants: structuredClone(executionGrants),
    grant_hashes: grantHashes,
    effect_receipts: structuredClone(receipts),
    receipt_hashes: receiptHashes,
    cleanup_evidence: structuredClone(cleanupEvidence),
    bundle_payload_hash: payloadHash,
  };
}

function expectedForGrant(bundle, grant, cell) {
  return {
    cell,
    run_id: bundle.run_id,
    attempt_id: bundle.attempt_id,
    artifact_sha: bundle.artifact_sha,
    brain_version: bundle.brain_version,
    engine_version: bundle.engine_version,
    grant_id: grant.grant_id,
    nonce: grant.nonce,
    resource_id: grant.resource_id,
    resource_ref: grant.resource_ref,
    resource_prefix: grant.resource_prefix,
  };
}

export function expectedFromReceiptBundle(bundle) {
  const grants = Array.isArray(bundle?.execution_grants)
    ? bundle.execution_grants
    : [];
  const currentGrant = grants.at(-1);
  return {
    cell: {
      cell_id: bundle?.cell_id,
      behavior_id: bundle?.behavior_id,
      provider: bundle?.provider,
      scenario: bundle?.scenario,
      seam_id: bundle?.seam_id,
      adapter_id: bundle?.adapter_id,
      effect_key_id: bundle?.effect_receipts?.at(-1)?.key_id,
      isolation: {
        environment: currentGrant?.environment,
        resource_type: 'verified_previous_bundle',
        resource_prefix: currentGrant?.resource_prefix,
      },
    },
    run_id: bundle?.run_id,
    attempt_id: bundle?.attempt_id,
    artifact_sha: bundle?.artifact_sha,
    brain_version: bundle?.brain_version,
    engine_version: bundle?.engine_version,
    grant_id: bundle?.grant_id,
    nonce: bundle?.nonce,
    resource_id: bundle?.resource_id,
    resource_ref: bundle?.resource_ref,
    resource_prefix: currentGrant?.resource_prefix,
  };
}

export function verifyReceiptBundle(
  bundle,
  registry,
  expected,
  options = {},
) {
  const {
    now = Date.now(),
    resolvePreviousBundle = null,
    _seenBundleHashes = new Set(),
  } = options;
  verifyNow(now);
  exactFields(bundle, BUNDLE_FIELDS, 'bundle_fields_invalid');
  if (
    bundle.schema_version !== 'kernel-equivalence-receipt-bundle/v1'
    || !matchesAxes(bundle, expected)
    || bundle.grant_id !== expected.grant_id
    || bundle.nonce !== expected.nonce
    || bundle.resource_id !== expected.resource_id
    || bundle.resource_ref !== expected.resource_ref
    || !Array.isArray(bundle.execution_grants)
    || !Array.isArray(bundle.grant_hashes)
    || !Array.isArray(bundle.effect_receipts)
    || !Array.isArray(bundle.receipt_hashes)
  ) {
    fail('bundle_axis_mismatch');
  }
  validateIdentity(bundle, 'bundle');
  const verificationNow = options[HISTORICAL_BUNDLE_VERIFICATION] === true
    ? parseTime(bundle.issued_at, 'bundle_time_invalid')
    : now;
  verifyWindow(
    bundle,
    verificationNow,
    registry?.collector_bundle_max_age_seconds,
    'bundle',
  );
  const key = findKey(registry, {
    keyId: bundle.key_id,
    purpose: 'collector_bundle',
    serviceId: 'kernel.equivalence.collector',
    now: verificationNow,
    code: 'bundle_key_invalid',
  });
  if (bundle.collector_service_id !== key.service_id) fail('bundle_key_invalid');
  verifySignature(bundle, key, 'bundle_signature_invalid');

  const expectedGrantCount = expected.cell.scenario === 'recovery' ? 2 : 1;
  if (bundle.execution_grants.length !== expectedGrantCount) {
    fail('bundle_grant_count_invalid');
  }
  let verifiedGrants;
  if (expected.cell.scenario === 'recovery') {
    const violationCell = expectedViolationCell(expected.cell);
    const violationGrant = verifyExecutionGrant(
      bundle.execution_grants[0],
      registry,
      { ...expected, cell: violationCell },
      { now: verificationNow },
    );
    const recoveryGrant = verifyExecutionGrant(
      bundle.execution_grants[1],
      registry,
      expected,
      { now: verificationNow },
    );
    if (
      violationGrant.run_id !== recoveryGrant.run_id
      || violationGrant.attempt_id !== recoveryGrant.attempt_id
      || violationGrant.artifact_sha !== recoveryGrant.artifact_sha
      || violationGrant.brain_version !== recoveryGrant.brain_version
      || violationGrant.engine_version !== recoveryGrant.engine_version
      || violationGrant.resource_id !== recoveryGrant.resource_id
      || violationGrant.resource_ref !== recoveryGrant.resource_ref
      || violationGrant.resource_prefix !== recoveryGrant.resource_prefix
      || violationGrant.seam_id !== recoveryGrant.seam_id
      || violationGrant.adapter_id !== recoveryGrant.adapter_id
    ) {
      fail('bundle_recovery_grants_invalid');
    }
    verifiedGrants = [violationGrant, recoveryGrant];
  } else {
    verifiedGrants = [
      verifyExecutionGrant(
        bundle.execution_grants[0],
        registry,
        expected,
        { now: verificationNow },
      ),
    ];
  }
  const currentGrant = verifiedGrants.at(-1);
  if (
    bundle.grant_id !== currentGrant.grant_id
    || bundle.nonce !== currentGrant.nonce
    || bundle.resource_id !== currentGrant.resource_id
    || bundle.resource_ref !== currentGrant.resource_ref
  ) {
    fail('bundle_axis_mismatch');
  }

  let verifiedReceipts;
  if (expected.cell.scenario === 'recovery') {
    if (bundle.effect_receipts.length !== 2) fail('bundle_recovery_receipts_invalid');
    const violation = verifyEffectReceipt(
      bundle.effect_receipts[0],
      registry,
      {
        ...expectedForGrant(
          bundle,
          verifiedGrants[0],
          expectedViolationCell(expected.cell),
        ),
        predecessor: null,
      },
      { now: verificationNow },
    );
    const recovery = verifyEffectReceipt(
      bundle.effect_receipts[1],
      registry,
      {
        ...expectedForGrant(bundle, verifiedGrants[1], expected.cell),
        predecessor: violation,
      },
      { now: verificationNow },
    );
    verifiedReceipts = [violation, recovery];
  } else {
    if (bundle.effect_receipts.length !== 1) fail('bundle_receipt_count_invalid');
    verifiedReceipts = [
      verifyEffectReceipt(
        bundle.effect_receipts[0],
        registry,
        expectedForGrant(bundle, verifiedGrants[0], expected.cell),
        { now: verificationNow },
      ),
    ];
  }

  const grantHashes = verifiedGrants.map(sha256Canonical);
  const hashes = verifiedReceipts.map(sha256Canonical);
  const payloadHash = sha256Canonical(
    bundlePayload(
      bundle.previous_bundle_hash,
      grantHashes,
      hashes,
      sha256Canonical(bundle.cleanup_evidence),
    ),
  );
  if (
    grantHashes.length !== bundle.grant_hashes.length
    || grantHashes.some((hash, index) => hash !== bundle.grant_hashes[index])
    ||
    hashes.length !== bundle.receipt_hashes.length
    || hashes.some((hash, index) => hash !== bundle.receipt_hashes[index])
    || bundle.bundle_payload_hash !== payloadHash
    || bundle.bundle_id !== `bundle:${payloadHash}`
    || (
      bundle.previous_bundle_hash != null
      && !HASH_PATTERN.test(bundle.previous_bundle_hash)
    )
  ) {
    fail('bundle_hash_chain_invalid');
  }
  verifyCleanupEvidence(bundle.cleanup_evidence, {
    cell_id: bundle.cell_id,
    grant_id: bundle.grant_id,
    resource_id: bundle.resource_id,
    resource_ref: bundle.resource_ref,
    adapter_id: bundle.adapter_id,
  });

  if (bundle.previous_bundle_hash != null) {
    if (typeof resolvePreviousBundle !== 'function') {
      fail('bundle_previous_unresolved');
    }
    if (
      _seenBundleHashes.size >= 100
      || _seenBundleHashes.has(bundle.previous_bundle_hash)
    ) {
      fail('bundle_hash_chain_invalid');
    }
    let previous;
    try {
      previous = resolvePreviousBundle(bundle.previous_bundle_hash);
    } catch {
      fail('bundle_previous_unresolved');
    }
    if (
      !asObject(previous)
      || sha256Canonical(previous) !== bundle.previous_bundle_hash
    ) {
      fail('bundle_previous_unresolved');
    }
    const seen = new Set(_seenBundleHashes);
    seen.add(bundle.previous_bundle_hash);
    verifyReceiptBundle(
      previous,
      registry,
      expectedFromReceiptBundle(previous),
      {
        now,
        resolvePreviousBundle,
        _seenBundleHashes: seen,
        [HISTORICAL_BUNDLE_VERIFICATION]: true,
      },
    );
  }

  return Object.freeze({
    bundle_id: bundle.bundle_id,
    bundle_hash: sha256Canonical(bundle),
    grant_ids: verifiedGrants.map((grant) => grant.grant_id),
    receipt_ids: verifiedReceipts.map((receipt) => receipt.receipt_id),
    effect_receipts: verifiedReceipts,
  });
}

export async function preloadReceiptBundleAncestry({
  headHash,
  genesisHash = null,
  readBundle,
  trustRegistry,
  now = Date.now(),
} = {}) {
  verifyNow(now);
  if (
    !HASH_PATTERN.test(headHash ?? '')
    || (
      genesisHash !== null
      && !HASH_PATTERN.test(genesisHash ?? '')
    )
    || typeof readBundle !== 'function'
  ) {
    fail('bundle_hash_chain_invalid');
  }
  const bundles = new Map();
  let currentHash = headHash;
  let discoveredGenesis = null;
  for (let depth = 0; depth < 100; depth += 1) {
    if (bundles.has(currentHash)) fail('bundle_hash_chain_invalid');
    let raw;
    try {
      raw = await readBundle(currentHash);
    } catch {
      fail('bundle_previous_unresolved');
    }
    if (
      !asObject(raw)
      || sha256Canonical(raw) !== currentHash
    ) {
      fail('bundle_previous_unresolved');
    }
    const stored = Object.freeze(structuredClone(raw));
    bundles.set(currentHash, stored);
    if (stored.previous_bundle_hash == null) {
      discoveredGenesis = currentHash;
      break;
    }
    if (!HASH_PATTERN.test(stored.previous_bundle_hash)) {
      fail('bundle_hash_chain_invalid');
    }
    currentHash = stored.previous_bundle_hash;
  }
  if (
    discoveredGenesis == null
    || (
      genesisHash !== null
      && discoveredGenesis !== genesisHash
    )
  ) {
    fail('bundle_hash_chain_invalid');
  }
  const resolvePreviousBundle = Object.freeze((hash) => {
    const bundle = bundles.get(hash);
    if (bundle == null) fail('bundle_previous_unresolved');
    return structuredClone(bundle);
  });
  const head = bundles.get(headHash);
  verifyReceiptBundle(
    head,
    trustRegistry,
    expectedFromReceiptBundle(head),
    {
      now,
      resolvePreviousBundle,
      [HISTORICAL_BUNDLE_VERIFICATION]: true,
    },
  );
  return Object.freeze({
    schema_version: 'kernel-equivalence-bundle-snapshot/v1',
    genesis_hash: discoveredGenesis,
    head_hash: headHash,
    bundle_hashes: Object.freeze([...bundles.keys()]),
    readBundle: resolvePreviousBundle,
  });
}
