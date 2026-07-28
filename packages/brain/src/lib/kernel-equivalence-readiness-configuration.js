import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import {
  isAbsolute,
  parse,
  resolve,
} from 'node:path';

import {
  assertPathAclFree,
} from './kernel-equivalence-protected-filesystem.js';
import {
  validateTrustRegistry,
} from './kernel-equivalence-receipts.js';

const RAW_SECRET_ENVIRONMENT =
  /^KERNEL_EQ_.*(?:PRIVATE_KEY|SECRET|KEY_PEM|KEY_VALUE)$/;
const MAXIMUM_CONFIG_BYTES = 1_048_576;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9_.:-]{0,127}$/;
const MANIFEST_FIELDS = Object.freeze([
  'collector_key',
  'effect_signing_keys',
  'execution_grant_key',
  'expected_plan_digest',
  'grant_root',
  'grant_ttl_seconds',
  'readiness_signing_key',
  'resource_ports',
  'schema_version',
  'socket_path',
  'trust_registry',
]);
const KEY_METADATA_FIELDS = Object.freeze([
  'key_id',
  'secret_file',
]);

export class KernelReadinessConfigurationError extends Error {
  constructor(code) {
    super(code);
    this.name = 'KernelReadinessConfigurationError';
    this.code = code;
  }
}

function fail(code) {
  throw new KernelReadinessConfigurationError(code);
}

function exactObject(value, fields, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(code);
  }
  const actual = Object.keys(value).sort();
  if (
    actual.length !== fields.length
    || actual.some((field, index) => field !== fields[index])
  ) {
    fail(code);
  }
}

function absolutePath(value) {
  return (
    typeof value === 'string'
    && value.length > 0
    && value.length <= 4_096
    && !/[\0\r\n]/.test(value)
    && isAbsolute(value)
    && value !== parse(value).root
    && resolve(value) === value
  );
}

function ownedByService(status) {
  return (
    typeof process.getuid !== 'function'
    || status.uid === process.getuid()
  );
}

function protectedManifest(path) {
  if (!absolutePath(path)) {
    fail('trusted_execution_config_file_invalid');
  }
  let descriptor;
  let bytes;
  try {
    if (realpathSync(path) !== path) {
      fail('trusted_execution_config_file_unsafe');
    }
    assertPathAclFree(
      path,
      () => fail('trusted_execution_config_file_unsafe'),
    );
    const pathStatus = lstatSync(path);
    if (
      !pathStatus.isFile()
      || pathStatus.isSymbolicLink()
      || pathStatus.nlink !== 1
      || !ownedByService(pathStatus)
      || ![0o400, 0o600].includes(pathStatus.mode & 0o777)
      || pathStatus.size < 2
      || pathStatus.size > MAXIMUM_CONFIG_BYTES
    ) {
      fail('trusted_execution_config_file_unsafe');
    }
    descriptor = openSync(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile()
      || opened.nlink !== 1
      || opened.dev !== pathStatus.dev
      || opened.ino !== pathStatus.ino
      || !ownedByService(opened)
      || ![0o400, 0o600].includes(opened.mode & 0o777)
      || opened.size !== pathStatus.size
    ) {
      fail('trusted_execution_config_file_unsafe');
    }
    bytes = readFileSync(descriptor);
    const completed = fstatSync(descriptor);
    const finalPathStatus = lstatSync(path);
    assertPathAclFree(
      path,
      () => fail('trusted_execution_config_file_unsafe'),
    );
    if (
      completed.dev !== opened.dev
      || completed.ino !== opened.ino
      || completed.size !== opened.size
      || completed.ctimeMs !== opened.ctimeMs
      || finalPathStatus.dev !== opened.dev
      || finalPathStatus.ino !== opened.ino
      || bytes.length !== opened.size
    ) {
      fail('trusted_execution_config_file_unsafe');
    }
    try {
      return JSON.parse(bytes.toString('utf8'));
    } catch {
      fail('trusted_execution_config_invalid');
    }
  } catch (error) {
    if (error instanceof KernelReadinessConfigurationError) {
      throw error;
    }
    if (error?.code === 'ENOENT') {
      fail('trusted_execution_config_file_unavailable');
    }
    fail('trusted_execution_config_file_unsafe');
  } finally {
    bytes?.fill(0);
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function loadProductionTrustedExecutionReadinessConfiguration({
  env = process.env,
  now = Date.now,
} = {}) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    fail('trusted_execution_config_file_missing');
  }
  if (Object.entries(env).some(([name, value]) => (
    RAW_SECRET_ENVIRONMENT.test(name)
    && typeof value === 'string'
    && value.length > 0
  ))) {
    fail('trusted_execution_raw_secret_forbidden');
  }
  const configFile = env.KERNEL_EQ_PRODUCTION_CONFIG_FILE;
  if (typeof configFile !== 'string' || configFile.length === 0) {
    fail('trusted_execution_config_file_missing');
  }
  if (typeof now !== 'function') {
    fail('trusted_execution_clock_invalid');
  }
  const pinnedNow = now();
  if (!Number.isFinite(pinnedNow)) {
    fail('trusted_execution_clock_invalid');
  }
  const manifest = protectedManifest(configFile);
  exactObject(
    manifest,
    MANIFEST_FIELDS,
    'trusted_execution_config_invalid',
  );
  exactObject(
    manifest.readiness_signing_key,
    KEY_METADATA_FIELDS,
    'trusted_execution_readiness_key_invalid',
  );
  if (
    manifest.schema_version
      !== 'kernel-equivalence-production-wiring/v1'
    || !HASH_PATTERN.test(manifest.expected_plan_digest ?? '')
    || !absolutePath(manifest.socket_path)
    || !KEY_ID_PATTERN.test(
      manifest.readiness_signing_key.key_id ?? '',
    )
  ) {
    fail('trusted_execution_config_invalid');
  }
  let registry;
  try {
    registry = validateTrustRegistry(manifest.trust_registry);
  } catch {
    fail('trusted_execution_trust_registry_invalid');
  }
  const anchor = registry.keys.find(({ key_id: keyId }) => (
    keyId === manifest.readiness_signing_key.key_id
  ));
  if (
    !anchor
    || anchor.purpose !== 'trusted_execution_readiness'
    || anchor.service_id
      !== 'brain.kernel_equivalence.trusted_execution'
    || pinnedNow < Date.parse(anchor.not_before)
    || pinnedNow >= Date.parse(anchor.not_after)
    || (
      anchor.revoked_at != null
      && pinnedNow >= Date.parse(anchor.revoked_at)
    )
  ) {
    fail('trusted_execution_key_registry_mismatch');
  }
  return Object.freeze({
    expected_plan_digest: manifest.expected_plan_digest,
    readiness_trust_anchor: Object.freeze(
      structuredClone(anchor),
    ),
    socket_path: manifest.socket_path,
  });
}
