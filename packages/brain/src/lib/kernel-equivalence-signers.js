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
  preloadReceiptBundleAncestry,
  receiptBundleContainsViolationMaterial,
  sha256Canonical,
  validateTrustRegistry,
  verifyEffectReceipt,
  verifyExecutionGrant,
  verifyReceiptBundle,
} from './kernel-equivalence-receipts.js';
import {
  assertPathAclFree,
} from './kernel-equivalence-protected-filesystem.js';

const MAXIMUM_KEY_BYTES = 8_192;
const DEFAULT_MAXIMUM_KEY_BYTES = MAXIMUM_KEY_BYTES;
const GRANT_AUTHORITY_SERVICE = 'brain.authority';
const COLLECTOR_SERVICE = 'kernel.equivalence.collector';
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const OBSERVATION_FIELDS = Object.freeze([
  'after_hash',
  'before_hash',
  'effect_code',
  'observed_outcome',
]);
const PREDECESSOR_EXPECTED_FIELDS = Object.freeze([
  'effect_code',
  'expected_outcome',
]);

function fail(code) {
  throw new EquivalenceReceiptError(code);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.length > 0;
}

function exactFields(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  return actual.length === expected.length
    && actual.every((field, index) => field === expected[index]);
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
  if (
    !Number.isInteger(maximumBytes)
    || maximumBytes < 1
    || maximumBytes > MAXIMUM_KEY_BYTES
  ) {
    fail('signer_secret_size_invalid');
  }

  let descriptor;
  try {
    assertPathAclFree(
      secretFile,
      () => fail('signer_secret_permissions_invalid'),
    );
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
    const secret = readFileSync(descriptor);
    assertPathAclFree(
      secretFile,
      () => fail('signer_secret_permissions_invalid'),
    );
    return secret;
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

  const assertActive = (operationNow) => {
    const current = activeRegistryKey(trustRegistry, {
      keyId,
      purpose,
      serviceId,
      now: operationNow,
    });
    if (!samePublicKey(privateKey, current.public_key_pem)) {
      fail('signer_public_key_mismatch');
    }
    return current;
  };
  const signCanonical = (value, operationNow) => {
    assertActive(operationNow);
    return signBytes(
      null,
      Buffer.from(canonicalJson(value), 'utf8'),
      privateKey,
    ).toString('base64');
  };

  return {
    record: Object.freeze(structuredClone(record)),
    assertActive,
    signCanonical,
  };
}

function resourcePrefix(cell, runId, attemptId) {
  return cell?.isolation?.resource_prefix
    ?.replaceAll('{run_id}', runId)
    .replaceAll('{attempt_id}', attemptId);
}

function signRecord(unsigned, signer, now) {
  return Object.freeze({
    ...unsigned,
    signature: signer.signCanonical(unsigned, now),
  });
}

function expectedFromGrant(cell, grant) {
  return {
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
  };
}

function violationCellFor(recoveryCell) {
  return {
    ...recoveryCell,
    cell_id: recoveryCell?.cell_id?.replace(/::recovery$/, '::violation'),
    scenario: 'violation',
  };
}

function sameRecoveryBoundary(violationGrant, recoveryGrant) {
  return (
    violationGrant.run_id === recoveryGrant.run_id
    && violationGrant.attempt_id === recoveryGrant.attempt_id
    && violationGrant.artifact_sha === recoveryGrant.artifact_sha
    && violationGrant.brain_version === recoveryGrant.brain_version
    && violationGrant.engine_version === recoveryGrant.engine_version
    && violationGrant.resource_id === recoveryGrant.resource_id
    && violationGrant.resource_ref === recoveryGrant.resource_ref
    && violationGrant.resource_prefix === recoveryGrant.resource_prefix
    && violationGrant.seam_id === recoveryGrant.seam_id
    && violationGrant.adapter_id === recoveryGrant.adapter_id
  );
}

function verifyMaterial({
  cell,
  grant,
  executionGrants,
  receipts,
  trustRegistry,
  now,
}) {
  if (!Array.isArray(executionGrants) || !Array.isArray(receipts)) {
    fail('collector_material_invalid');
  }
  const verifiedCurrentGrant = verifyExecutionGrant(
    grant,
    trustRegistry,
    expectedFromGrant(cell, grant),
    { now },
  );
  if (cell?.scenario === 'recovery') {
    if (executionGrants.length !== 2 || receipts.length !== 2) {
      fail('collector_material_invalid');
    }
    const violationCell = violationCellFor(cell);
    const violationGrant = verifyExecutionGrant(
      executionGrants[0],
      trustRegistry,
      expectedFromGrant(violationCell, executionGrants[0]),
      { now },
    );
    const recoveryGrant = verifyExecutionGrant(
      executionGrants[1],
      trustRegistry,
      expectedFromGrant(cell, executionGrants[1]),
      { now },
    );
    if (
      recoveryGrant.grant_id !== verifiedCurrentGrant.grant_id
      || !sameRecoveryBoundary(violationGrant, recoveryGrant)
    ) {
      fail('collector_material_invalid');
    }
    const violationReceipt = verifyEffectReceipt(
      receipts[0],
      trustRegistry,
      expectedFromGrant(violationCell, violationGrant),
      { now },
    );
    const predecessorExpected = cell?.expected?.predecessor_expected;
    if (
      !exactFields(predecessorExpected, PREDECESSOR_EXPECTED_FIELDS)
      || violationReceipt.observed_outcome
        !== predecessorExpected.expected_outcome
      || violationReceipt.effect_code !== predecessorExpected.effect_code
    ) {
      fail('collector_recovery_predecessor_contract_mismatch');
    }
    const recoveryReceipt = verifyEffectReceipt(
      receipts[1],
      trustRegistry,
      {
        ...expectedFromGrant(cell, recoveryGrant),
        predecessor: violationReceipt,
      },
      { now },
    );
    return {
      executionGrants: [violationGrant, recoveryGrant],
      receipts: [violationReceipt, recoveryReceipt],
    };
  }
  if (
    executionGrants.length !== 1
    || receipts.length !== 1
    || executionGrants[0]?.grant_id !== verifiedCurrentGrant.grant_id
  ) {
    fail('collector_material_invalid');
  }
  const receipt = verifyEffectReceipt(
    receipts[0],
    trustRegistry,
    expectedFromGrant(cell, verifiedCurrentGrant),
    { now },
  );
  return {
    executionGrants: [verifiedCurrentGrant],
    receipts: [receipt],
  };
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
      const activeRecord = signer.assertActive(issuedAt);
      if (
        !Number.isInteger(ttlSeconds)
        || ttlSeconds < 1
        || ttlSeconds > trustRegistry.grant_max_age_seconds
        || issuedAt + ttlSeconds * 1000 > Date.parse(activeRecord.not_after)
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
      const grant = signRecord(unsigned, signer, issuedAt);
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

export function loadEffectReceiptSigner({
  secretFile,
  keyId,
  serviceId,
  trustRegistry,
  now = Date.now,
  randomUUID = nodeRandomUUID,
  maximumBytes = DEFAULT_MAXIMUM_KEY_BYTES,
} = {}) {
  if (
    !nonEmpty(serviceId)
    || typeof randomUUID !== 'function'
  ) {
    fail('effect_signer_metadata_invalid');
  }
  const signer = loadSigner({
    secretFile,
    keyId,
    purpose: 'effect_receipt',
    serviceId,
    trustRegistry,
    now,
    maximumBytes,
  });

  const signEffectResult = ({
    cell,
    grant,
    observation,
    predecessor = null,
  } = {}) => {
    const issuedAt = finiteNow(now);
    const activeRecord = signer.assertActive(issuedAt);
    if (
      cell?.seam_id !== serviceId
      || cell?.effect_key_id !== signer.record.key_id
      || grant?.seam_id !== serviceId
      || grant?.adapter_id !== cell?.adapter_id
    ) {
      fail('effect_signer_boundary_invalid');
    }
    if (
      !exactFields(observation, OBSERVATION_FIELDS)
      || observation.observed_outcome !== cell?.expected?.expected_outcome
      || observation.effect_code !== cell?.expected?.effect_code
    ) {
      fail('effect_observation_invalid');
    }
    const verifiedGrant = verifyExecutionGrant(
      grant,
      trustRegistry,
      expectedFromGrant(cell, grant),
      { now: issuedAt },
    );
    let predecessorReceipt = null;
    if (cell?.scenario === 'recovery') {
      if (
        !predecessor
        || typeof predecessor !== 'object'
        || Array.isArray(predecessor)
        || Object.keys(predecessor).sort().join(',') !== 'grant,receipt'
      ) {
        fail('effect_predecessor_invalid');
      }
      const violationCell = violationCellFor(cell);
      const predecessorGrant = verifyExecutionGrant(
        predecessor.grant,
        trustRegistry,
        expectedFromGrant(violationCell, predecessor.grant),
        { now: issuedAt },
      );
      if (!sameRecoveryBoundary(predecessorGrant, verifiedGrant)) {
        fail('effect_predecessor_invalid');
      }
      predecessorReceipt = verifyEffectReceipt(
        predecessor.receipt,
        trustRegistry,
        expectedFromGrant(violationCell, predecessorGrant),
        { now: issuedAt },
      );
    } else if (predecessor !== null) {
      fail('effect_predecessor_invalid');
    }

    const receiptId = randomUUID();
    if (!UUID_PATTERN.test(receiptId ?? '')) {
      fail('signer_uuid_source_invalid');
    }
    const lifetimeSeconds = Math.min(
      trustRegistry.effect_receipt_max_age_seconds,
      Math.floor((Date.parse(activeRecord.not_after) - issuedAt) / 1000),
    );
    if (lifetimeSeconds < 1) fail('signer_registry_key_inactive');
    const unsigned = {
      schema_version: 'kernel-equivalence-effect-receipt/v1',
      receipt_id: receiptId,
      key_id: signer.record.key_id,
      service_id: serviceId,
      issued_at: new Date(issuedAt).toISOString(),
      expires_at: new Date(issuedAt + lifetimeSeconds * 1000).toISOString(),
      cell_id: cell.cell_id,
      behavior_id: cell.behavior_id,
      provider: cell.provider,
      scenario: cell.scenario,
      run_id: verifiedGrant.run_id,
      attempt_id: verifiedGrant.attempt_id,
      grant_id: verifiedGrant.grant_id,
      nonce: verifiedGrant.nonce,
      artifact_sha: verifiedGrant.artifact_sha,
      brain_version: verifiedGrant.brain_version,
      engine_version: verifiedGrant.engine_version,
      environment: verifiedGrant.environment,
      resource_id: verifiedGrant.resource_id,
      resource_ref: verifiedGrant.resource_ref,
      seam_id: serviceId,
      adapter_id: verifiedGrant.adapter_id,
      execution_mode: 'live_effect',
      observed_outcome: observation.observed_outcome,
      effect_code: observation.effect_code,
      before_hash: observation.before_hash,
      after_hash: observation.after_hash,
      predecessor_cell_id: predecessorReceipt?.cell_id ?? null,
      predecessor_receipt_id: predecessorReceipt?.receipt_id ?? null,
      predecessor_receipt_hash: predecessorReceipt == null
        ? null
        : sha256Canonical(predecessorReceipt),
    };
    const receipt = signRecord(unsigned, signer, issuedAt);
    verifyEffectReceipt(
      receipt,
      trustRegistry,
      {
        ...expectedFromGrant(cell, verifiedGrant),
        predecessor: predecessorReceipt,
      },
      { now: issuedAt },
    );
    return receipt;
  };
  return Object.freeze({
    key_id: signer.record.key_id,
    purpose: signer.record.purpose,
    service_id: signer.record.service_id,
    signEffectResult,
  });
}

export function loadCollectorSigner({
  secretFile,
  keyId,
  trustRegistry,
  now = Date.now,
  maximumBytes = DEFAULT_MAXIMUM_KEY_BYTES,
  resolvePreviousBundle = null,
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
    cleanupEvidence,
    previousBundleHash,
  } = {}) => {
    const issuedAt = finiteNow(now);
    const activeRecord = signer.assertActive(issuedAt);
    const verifiedMaterial = verifyMaterial({
      cell,
      grant,
      executionGrants,
      receipts,
      trustRegistry,
      now: issuedAt,
    });
    const currentReceipt = verifiedMaterial.receipts.at(-1);
    if (
      currentReceipt?.observed_outcome !== cell?.expected?.expected_outcome
      || currentReceipt?.effect_code !== cell?.expected?.effect_code
    ) {
      fail('collector_effect_contract_mismatch');
    }
    if (
      cell?.scenario === 'recovery'
      && previousBundleHash == null
    ) {
      fail('collector_recovery_predecessor_uncommitted');
    }
    if (
      previousBundleHash != null
      && typeof resolvePreviousBundle !== 'function'
    ) {
      fail('collector_previous_bundle_unavailable');
    }
    const previousSnapshot = previousBundleHash == null
      ? null
      : await preloadReceiptBundleAncestry({
        headHash: previousBundleHash,
        readBundle: resolvePreviousBundle,
        trustRegistry,
        now: issuedAt,
      });
    if (
      cell?.scenario === 'recovery'
      && !previousSnapshot.bundle_hashes.some((hash) => (
        receiptBundleContainsViolationMaterial(
          previousSnapshot.readBundle(hash),
          verifiedMaterial.executionGrants[0],
          verifiedMaterial.receipts[0],
        )
      ))
    ) {
      fail('collector_recovery_predecessor_uncommitted');
    }
    const lifetimeSeconds = Math.min(
      trustRegistry.collector_bundle_max_age_seconds,
      Math.floor((Date.parse(activeRecord.not_after) - issuedAt) / 1000),
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
      executionGrants: verifiedMaterial.executionGrants,
      receipts: verifiedMaterial.receipts,
      cleanupEvidence,
      previousBundleHash,
    });
    const bundle = signRecord(unsigned, signer, issuedAt);
    verifyReceiptBundle(
      bundle,
      trustRegistry,
      expectedFromGrant(cell, grant),
      {
        now: issuedAt,
        resolvePreviousBundle: previousSnapshot?.readBundle ?? null,
      },
    );
    return bundle;
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
