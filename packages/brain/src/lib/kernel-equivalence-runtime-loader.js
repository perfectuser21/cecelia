import {
  randomUUID as nodeRandomUUID,
} from 'node:crypto';
import { isAbsolute, parse, resolve } from 'node:path';
import {
  executeDrillCell,
} from './kernel-equivalence-drills.js';
import {
  createPostgresGrantExecutionAuthority,
} from './kernel-equivalence-grant-execution-authority.js';
import {
  createPostgresAuditSink,
  createPostgresBundleChainStore,
  createPostgresPredecessorResolver,
} from './kernel-equivalence-postgres-runtime.js';
import {
  sha256Canonical,
} from './kernel-equivalence-receipts.js';
import {
  loadCollectorSigner,
} from './kernel-equivalence-signers.js';

const FORBIDDEN_RAW_SECRET = /^KERNEL_EQ_.*(?:PRIVATE_KEY|SECRET|KEY_PEM|KEY_VALUE)$/;
const SAFE_KEY_ID = /^[a-z0-9][a-z0-9_.:-]{0,127}$/;

export class EquivalenceTrustedRuntimeError extends Error {
  constructor(code) {
    super(code);
    this.name = 'EquivalenceTrustedRuntimeError';
    this.code = code;
  }
}

function fail(code) {
  throw new EquivalenceTrustedRuntimeError(code);
}

function bounded(value, maximum = 2_048) {
  return (
    typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && !/[\0\r\n]/.test(value)
  );
}

function secureAbsolutePath(value) {
  if (!bounded(value) || !isAbsolute(value) || value === parse(value).root) {
    return false;
  }
  return resolve(value) === value;
}

export function validateTrustedRuntimeEnvironment(env = {}) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    fail('trusted_runtime_environment_invalid');
  }
  if (
    Object.entries(env).some(([name, value]) => (
      FORBIDDEN_RAW_SECRET.test(name)
      && typeof value === 'string'
      && value.length > 0
    ))
  ) {
    fail('trusted_runtime_raw_secret_forbidden');
  }
  const secretFile = env.KERNEL_EQ_COLLECTOR_KEY_FILE;
  const keyId = env.KERNEL_EQ_COLLECTOR_KEY_ID;
  if (secretFile == null || secretFile === '') {
    fail('trusted_runtime_collector_key_file_missing');
  }
  if (!secureAbsolutePath(secretFile)) {
    fail('trusted_runtime_collector_key_file_invalid');
  }
  if (keyId == null || keyId === '') {
    fail('trusted_runtime_collector_key_id_missing');
  }
  if (!SAFE_KEY_ID.test(keyId)) {
    fail('trusted_runtime_collector_key_id_invalid');
  }
  return Object.freeze({
    collector_key_file: secretFile,
    collector_key_id: keyId,
  });
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function pinProtectedExecutionGrant(value = {}) {
  try {
    const pinned = structuredClone(value);
    if (
      !pinned
      || typeof pinned !== 'object'
      || Array.isArray(pinned)
      || Object.keys(pinned).sort().join(',') !== 'grant,grant_sha256'
      || !pinned.grant
      || typeof pinned.grant !== 'object'
      || Array.isArray(pinned.grant)
      || !/^[a-f0-9]{64}$/.test(pinned.grant_sha256 ?? '')
      || sha256Canonical(pinned.grant) !== pinned.grant_sha256
    ) {
      fail('trusted_runtime_grant_invalid');
    }
    return deepFreeze(pinned);
  } catch (error) {
    if (error instanceof EquivalenceTrustedRuntimeError) throw error;
    fail('trusted_runtime_grant_invalid');
  }
}

function validRuntimeRegistry(value) {
  return (
    value
    && typeof value === 'object'
    && Array.isArray(value.ids)
    && Number.isInteger(value.size)
    && value.size === value.ids.length
    && typeof value.resolveForCell === 'function'
  );
}

export async function loadTrustedEquivalenceRuntime({
  env = process.env,
  trustRegistry,
  pool,
  runtimeRegistry,
  now = Date.now,
  randomUUID = nodeRandomUUID,
} = {}) {
  const metadata = validateTrustedRuntimeEnvironment(env);
  if (
    !pool
    || typeof pool.query !== 'function'
    || typeof pool.connect !== 'function'
  ) {
    fail('trusted_runtime_database_unavailable');
  }
  if (!validRuntimeRegistry(runtimeRegistry)) {
    fail('trusted_runtime_registry_unavailable');
  }
  const bundleChainStore = createPostgresBundleChainStore({ pool });
  const auditSink = createPostgresAuditSink({ pool });
  const predecessorResolver = createPostgresPredecessorResolver({ pool });
  let grantExecutionAuthority;
  try {
    grantExecutionAuthority = createPostgresGrantExecutionAuthority({
      pool,
      actorInstanceId: randomUUID(),
    });
  } catch {
    fail('trusted_runtime_grant_authority_unavailable');
  }
  let collector;
  try {
    collector = loadCollectorSigner({
      secretFile: metadata.collector_key_file,
      keyId: metadata.collector_key_id,
      trustRegistry,
      now,
      resolvePreviousBundle: bundleChainStore.readBundle,
    });
  } catch {
    fail('trusted_runtime_collector_unavailable');
  }
  try {
    await bundleChainStore.getCheckpoint();
  } catch {
    fail('trusted_runtime_database_unavailable');
  }

  const executeCell = async ({
    cell,
    grant: protectedGrant,
    grant_sha256: protectedGrantSha256,
    signal = null,
    timeoutMs = 30_000,
  } = {}) => {
    const pinnedGrant = pinProtectedExecutionGrant({
      grant: protectedGrant,
      grant_sha256: protectedGrantSha256,
    });
    return executeDrillCell({
      cell,
      grant: pinnedGrant.grant,
      trustRegistry,
      grantExecutionAuthority,
      adapters: runtimeRegistry,
      collector,
      bundleChainStore,
      predecessorResolver,
      auditSink,
      now,
      signal,
      timeoutMs,
    });
  };
  return Object.freeze({
    schema_version: 'kernel-equivalence-trusted-runtime/v1',
    collector_key_id: collector.key_id,
    adapter_count: runtimeRegistry.size,
    executeCell,
  });
}
