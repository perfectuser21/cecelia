import {
  createPrivateKey,
  createPublicKey,
  randomUUID as nodeRandomUUID,
  sign as signBytes,
} from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from 'node:fs';
import {
  isAbsolute,
  parse,
  resolve,
} from 'node:path';
import {
  EquivalenceReceiptError,
  assembleUnsignedBundle,
  canonicalJson,
  validateTrustRegistry,
  verifyExecutionGrant,
} from './kernel-equivalence-receipts.js';

const DEFAULT_MAXIMUM_KEY_BYTES = 8_192;
const GRANT_AUTHORITY_SERVICE = 'brain.authority';
const COLLECTOR_SERVICE = 'kernel.equivalence.collector';
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

function fail(code) {
  throw new EquivalenceReceiptError(code);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.length > 0;
}

function finiteNow(now) {
  if (typeof now !== 'function') fail('signer_clock_invalid');
  const value = now();
  if (!Number.isFinite(value)) fail('signer_clock_invalid');
  return value;
}

function activeRegistryKey(
  trustRegistry,
  {
    keyId,
    purpose,
    serviceId,
    now,
  },
) {
  validateTrustRegistry(trustRegistry);
  const record = trustRegistry.keys.find((key) => key?.key_id === keyId);
  if (
    !record
    || record.purpose !== purpose
    || record.service_id !== serviceId
  ) {
    fail('signer_registry_key_invalid');
  }
  const notBefore = Date.parse(record.not_before);
  const notAfter = Date.parse(record.not_after);
  const revokedAt = record.revoked_at == null
    ? null
    : Date.parse(record.revoked_at);
  if (
    !Number.isFinite(notBefore)
    || !Number.isFinite(notAfter)
    || now < notBefore
    || now >= notAfter
    || (revokedAt != null && now >= revokedAt)
  ) {
    fail('signer_registry_key_inactive');
  }
  return record;
}

function readProtectedPrivateKey(
  secretFile,
  { maximumBytes = DEFAULT_MAXIMUM_KEY_BYTES } = {},
) {
  if (
    !nonEmpty(secretFile)
    || !isAbsolute(secretFile)
    || resolve(secretFile) !== secretFile
    || secretFile === parse(secretFile).root
  ) {
    fail('signer_secret_path_invalid');
  }
  if (!Number.isInteger(maximumBytes) || maximumBytes < 1) {
    fail('signer_secret_size_invalid');
  }

  let descriptor;
  try {
    descriptor = openSync(
      secretFile,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const stat = fstatSync(descriptor);
    const permissions = stat.mode & 0o777;
    if (!stat.isFile() || stat.nlink !== 1) {
      fail('signer_secret_file_unsafe');
    }
    if (
      ![0o400, 0o600].includes(permissions)
      || (
        typeof process.getuid === 'function'
        && Number.isInteger(stat.uid)
        && stat.uid !== process.getuid()
      )
    ) {
      fail('signer_secret_permissions_invalid');
    }
    if (
      !Number.isInteger(stat.size)
      || stat.size < 1
      || stat.size > maximumBytes
    ) {
      fail('signer_secret_size_invalid');
    }
    return readFileSync(descriptor);
  } catch (error) {
    if (error instanceof EquivalenceReceiptError) throw error;
    if (error?.code === 'ELOOP') fail('signer_secret_file_unsafe');
    if (error?.code === 'EACCES') fail('signer_secret_permissions_invalid');
    fail('signer_secret_unavailable');
  } finally {
    if (descriptor != null) {
      try {
        closeSync(descriptor);
      } catch {
        // Never expose descriptor or filesystem details after a completed read.
      }
    }
  }
}

function samePublicKey(privateKey, publicKeyPem) {
  try {
    const derived = createPublicKey(privateKey).export({
      type: 'spki',
      format: 'der',
    });
    const registered = createPublicKey(publicKeyPem).export({
      type: 'spki',
      format: 'der',
    });
    return Buffer.isBuffer(derived)
      && Buffer.isBuffer(registered)
      && derived.equals(registered);
  } catch {
    return false;
  }
}

function loadSigner({
  secretFile,
  keyId,
  purpose,
  serviceId,
  trustRegistry,
  now,
  maximumBytes,
}) {
  const loadedAt = finiteNow(now);
  const record = activeRegistryKey(trustRegistry, {
    keyId,
    purpose,
    serviceId,
    now: loadedAt,
  });
  const secret = readProtectedPrivateKey(secretFile, { maximumBytes });
  let privateKey;
  try {
    privateKey = createPrivateKey(secret);
  } catch {
    fail('signer_private_key_invalid');
  } finally {
    secret.fill(0);
  }
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    fail('signer_private_key_invalid');
  }
  if (!samePublicKey(privateKey, record.public_key_pem)) {
    fail('signer_public_key_mismatch');
  }

  const signCanonical = (value) => signBytes(
    null,
    Buffer.from(canonicalJson(value), 'utf8'),
    privateKey,
  ).toString('base64');

  return {
    record: Object.freeze(structuredClone(record)),
    signCanonical,
  };
}

function resourcePrefix(cell, runId, attemptId) {
  return cell?.isolation?.resource_prefix
    ?.replaceAll('{run_id}', runId)
    .replaceAll('{attempt_id}', attemptId);
}

function signRecord(unsigned, signer) {
  return Object.freeze({
    ...unsigned,
    signature: signer.signCanonical(unsigned),
  });
}

export function loadExecutionGrantAuthority({
  secretFile,
  keyId,
  trustRegistry,
  now = Date.now,
  randomUUID = nodeRandomUUID,
  maximumBytes = DEFAULT_MAXIMUM_KEY_BYTES,
} = {}) {
  if (typeof randomUUID !== 'function') fail('signer_uuid_source_invalid');
  const signer = loadSigner({
    secretFile,
    keyId,
    purpose: 'execution_grant',
    serviceId: GRANT_AUTHORITY_SERVICE,
    trustRegistry,
    now,
    maximumBytes,
  });

  return Object.freeze({
    key_id: signer.record.key_id,
    purpose: signer.record.purpose,
    service_id: signer.record.service_id,

    issue({
      cell,
      run_id: runId,
      attempt_id: attemptId,
      artifact_sha: artifactSha,
      brain_version: brainVersion,
      engine_version: engineVersion,
      resource_id: resourceId,
      resource_ref: resourceRef,
      ttl_seconds: ttlSeconds,
    } = {}) {
      const issuedAt = finiteNow(now);
      if (
        !Number.isInteger(ttlSeconds)
        || ttlSeconds < 1
        || ttlSeconds > trustRegistry.grant_max_age_seconds
        || issuedAt + ttlSeconds * 1000 > Date.parse(signer.record.not_after)
      ) {
        fail('grant_ttl_invalid');
      }
      const grantId = randomUUID();
      const nonce = randomUUID();
      if (
        !UUID_PATTERN.test(grantId ?? '')
        || !UUID_PATTERN.test(nonce ?? '')
      ) {
        fail('signer_uuid_source_invalid');
      }
      const prefix = resourcePrefix(cell, runId, attemptId);
      const unsigned = {
        schema_version: 'kernel-equivalence-execution-grant/v1',
        grant_id: grantId,
        key_id: signer.record.key_id,
        issued_at: new Date(issuedAt).toISOString(),
        expires_at: new Date(issuedAt + ttlSeconds * 1000).toISOString(),
        nonce,
        cell_id: cell?.cell_id,
        behavior_id: cell?.behavior_id,
        provider: cell?.provider,
        scenario: cell?.scenario,
        run_id: runId,
        attempt_id: attemptId,
        artifact_sha: artifactSha,
        brain_version: brainVersion,
        engine_version: engineVersion,
        environment: cell?.isolation?.environment,
        resource_id: resourceId,
        resource_ref: resourceRef,
        resource_prefix: prefix,
        seam_id: cell?.seam_id,
        adapter_id: cell?.adapter_id,
        scopes: ['isolated_effect'],
      };
      const grant = signRecord(unsigned, signer);
      verifyExecutionGrant(
        grant,
        trustRegistry,
        {
          cell,
          run_id: runId,
          attempt_id: attemptId,
          artifact_sha: artifactSha,
          brain_version: brainVersion,
          engine_version: engineVersion,
          grant_id: grantId,
          nonce,
          resource_id: resourceId,
          resource_ref: resourceRef,
          resource_prefix: prefix,
        },
        { now: issuedAt },
      );
      return grant;
    },
  });
}

export function loadCollectorSigner({
  secretFile,
  keyId,
  trustRegistry,
  now = Date.now,
  maximumBytes = DEFAULT_MAXIMUM_KEY_BYTES,
} = {}) {
  const signer = loadSigner({
    secretFile,
    keyId,
    purpose: 'collector_bundle',
    serviceId: COLLECTOR_SERVICE,
    trustRegistry,
    now,
    maximumBytes,
  });

  const collector = async ({
    cell,
    grant,
    executionGrants,
    receipts,
    previousBundleHash,
  } = {}) => {
    const issuedAt = finiteNow(now);
    const lifetimeSeconds = Math.min(
      trustRegistry.collector_bundle_max_age_seconds,
      Math.floor((Date.parse(signer.record.not_after) - issuedAt) / 1000),
    );
    if (lifetimeSeconds < 1) fail('signer_registry_key_inactive');
    const unsigned = assembleUnsignedBundle({
      keyId: signer.record.key_id,
      collectorServiceId: signer.record.service_id,
      issuedAt: new Date(issuedAt).toISOString(),
      expiresAt: new Date(issuedAt + lifetimeSeconds * 1000).toISOString(),
      expected: {
        cell,
        run_id: grant?.run_id,
        attempt_id: grant?.attempt_id,
        artifact_sha: grant?.artifact_sha,
        brain_version: grant?.brain_version,
        engine_version: grant?.engine_version,
        grant_id: grant?.grant_id,
        nonce: grant?.nonce,
        resource_id: grant?.resource_id,
        resource_ref: grant?.resource_ref,
        resource_prefix: grant?.resource_prefix,
      },
      executionGrants,
      receipts,
      previousBundleHash,
    });
    return signRecord(unsigned, signer);
  };
  Object.defineProperties(collector, {
    key_id: { value: signer.record.key_id, enumerable: true },
    purpose: { value: signer.record.purpose, enumerable: true },
    service_id: { value: signer.record.service_id, enumerable: true },
    toJSON: {
      value: () => ({
        key_id: signer.record.key_id,
        purpose: signer.record.purpose,
        service_id: signer.record.service_id,
      }),
    },
  });
  return Object.freeze(collector);
}
