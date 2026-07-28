import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from 'node:fs';
import { isAbsolute, parse, resolve } from 'node:path';
import {
  executeDrillCell,
} from './kernel-equivalence-drills.js';
import {
  createPostgresAuditSink,
  createPostgresBundleChainStore,
  createPostgresNonceConsumer,
  createPostgresPredecessorResolver,
} from './kernel-equivalence-postgres-runtime.js';
import {
  createServerOwnedRuntimeRegistry,
} from './kernel-equivalence-runtime-registry.js';
import {
  loadCollectorSigner,
} from './kernel-equivalence-signers.js';

const GRANT_MAXIMUM_BYTES = 65_536;
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

function readProtectedFile(path, maximumBytes, errorCode) {
  if (!secureAbsolutePath(path)) fail(errorCode);
  let descriptor;
  let bytes;
  try {
    descriptor = openSync(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const status = fstatSync(descriptor);
    const permittedOwner = typeof process.geteuid !== 'function'
      || status.uid === process.geteuid();
    if (
      !status.isFile()
      || status.nlink !== 1
      || !permittedOwner
      || ![0o400, 0o600].includes(status.mode & 0o777)
      || status.size < 1
      || status.size > maximumBytes
    ) {
      fail(errorCode);
    }
    bytes = readFileSync(descriptor);
    if (bytes.length < 1 || bytes.length > maximumBytes) fail(errorCode);
    return bytes;
  } catch (error) {
    if (error instanceof EquivalenceTrustedRuntimeError) throw error;
    fail(errorCode);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function loadProtectedExecutionGrant({ grantPath } = {}) {
  const bytes = readProtectedFile(
    grantPath,
    GRANT_MAXIMUM_BYTES,
    'trusted_runtime_grant_file_invalid',
  );
  try {
    const grant = JSON.parse(bytes.toString('utf8'));
    if (!grant || typeof grant !== 'object' || Array.isArray(grant)) {
      fail('trusted_runtime_grant_file_invalid');
    }
    return Object.freeze(structuredClone(grant));
  } catch (error) {
    if (error instanceof EquivalenceTrustedRuntimeError) throw error;
    fail('trusted_runtime_grant_file_invalid');
  } finally {
    bytes.fill(0);
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
  runtimeRegistry = createServerOwnedRuntimeRegistry(),
  now = Date.now,
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
  const nonceConsumer = createPostgresNonceConsumer({ pool });
  const auditSink = createPostgresAuditSink({ pool });
  const predecessorResolver = createPostgresPredecessorResolver({ pool });
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
    grantPath,
    timeoutMs = 30_000,
  } = {}) => {
    const grant = loadProtectedExecutionGrant({ grantPath });
    const executionNow = typeof now === 'function' ? now() : now;
    return executeDrillCell({
      cell,
      grant,
      trustRegistry,
      nonceConsumer,
      adapters: runtimeRegistry,
      collector,
      bundleChainStore,
      predecessorResolver,
      auditSink,
      now: executionNow,
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
