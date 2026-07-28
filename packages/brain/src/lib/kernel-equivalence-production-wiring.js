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
import { load as loadYaml } from 'js-yaml';

import {
  compileDrillPlan,
} from './kernel-equivalence-drills.js';
import {
  createProtectedGrantFileAuthority,
  createProtectedGrantFileIssuer,
} from './kernel-equivalence-protected-grant-authority.js';
import {
  createProductionTrustedExecutionServiceFactory,
} from './kernel-equivalence-production-service-factory.js';
import {
  validateTrustRegistry,
} from './kernel-equivalence-receipts.js';
import {
  loadExecutionGrantAuthority,
  loadTrustedExecutionReadinessSigner,
} from './kernel-equivalence-signers.js';
import {
  TRUSTED_NON_RELEASE_EQUIVALENCE_DESCRIPTORS,
} from './kernel-equivalence-trusted-assembly.js';
import {
  isCanonicalTrustedExecutionPlan,
} from './kernel-equivalence-canonical-plan.js';
import {
  digestTrustedExecutionPlan,
} from './kernel-equivalence-trusted-execution-service.js';
import {
  assertPathAclFree,
} from './kernel-equivalence-protected-filesystem.js';

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
const RESOURCE_PORT_FIELDS = Object.freeze([
  'profile_id',
  'schema_version',
]);
const ASSEMBLY_PORT_FIELDS = Object.freeze([
  'cleanupInspector',
  'profile_id',
  'qualityIsolation',
  'seamPorts',
  'securityIsolation',
]);
const REQUIRED_SEAMS = Object.freeze(
  TRUSTED_NON_RELEASE_EQUIVALENCE_DESCRIPTORS
    .map((descriptor) => descriptor.seam_id)
    .sort(),
);
const contractPath = new URL(
  '../../../../regression-contract.yaml',
  import.meta.url,
);

export class KernelProductionWiringError extends Error {
  constructor(code) {
    super(code);
    this.name = 'KernelProductionWiringError';
    this.code = code;
  }
}

function fail(code) {
  throw new KernelProductionWiringError(code);
}

function exactObject(value, fields, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(code);
  }
  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail(code);
  }
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.some((field) => typeof field !== 'string')) {
    fail(code);
  }
  const actual = ownKeys.sort();
  if (
    actual.length !== fields.length
    || actual.some((field, index) => field !== fields[index])
    || fields.some((field) => (
      !Object.hasOwn(descriptors[field] ?? {}, 'value')
      || descriptors[field].enumerable !== true
    ))
  ) {
    fail(code);
  }
  return Object.freeze(Object.fromEntries(fields.map((field) => [
    field,
    descriptors[field].value,
  ])));
}

function bounded(value, maximum = 2_048) {
  return (
    typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && !/[\0\r\n]/.test(value)
  );
}

function absolutePath(value, maximum = 4_096) {
  return (
    bounded(value, maximum)
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
    if (error instanceof KernelProductionWiringError) throw error;
    if (error?.code === 'ENOENT') {
      fail('trusted_execution_config_file_unavailable');
    }
    fail('trusted_execution_config_file_unsafe');
  } finally {
    bytes?.fill(0);
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function keyMetadata(value, code) {
  exactObject(value, KEY_METADATA_FIELDS, code);
  if (
    !KEY_ID_PATTERN.test(value.key_id ?? '')
    || !absolutePath(value.secret_file)
  ) {
    fail(code);
  }
  return {
    key_id: value.key_id,
    secret_file: value.secret_file,
  };
}

function assembleCanonicalPlan(effectSigningKeys, now) {
  let contract;
  try {
    contract = loadYaml(readFileSync(contractPath, 'utf8'));
  } catch {
    fail('trusted_execution_canonical_contract_unavailable');
  }
  let plan;
  try {
    plan = structuredClone(compileDrillPlan(contract, { now }));
  } catch {
    fail('trusted_execution_canonical_contract_invalid');
  }
  for (const descriptor of TRUSTED_NON_RELEASE_EQUIVALENCE_DESCRIPTORS) {
    const keyId = effectSigningKeys[descriptor.seam_id].key_id;
    for (const cell of plan.cells) {
      if (cell.behavior_id !== descriptor.behavior_id) continue;
      cell.effect_signer_status = 'available';
      cell.effect_key_id = keyId;
      cell.blocked_by = null;
      cell.assembly_status = 'assembled';
    }
  }
  if (!isCanonicalTrustedExecutionPlan(plan)) {
    fail('trusted_execution_plan_not_canonical');
  }
  return plan;
}

function activeKey(registry, {
  keyId,
  purpose,
  serviceId,
  now,
}) {
  const key = registry.keys.find((candidate) => (
    candidate.key_id === keyId
  ));
  if (
    !key
    || key.purpose !== purpose
    || key.service_id !== serviceId
    || now < Date.parse(key.not_before)
    || now >= Date.parse(key.not_after)
    || (
      key.revoked_at != null
      && now >= Date.parse(key.revoked_at)
    )
  ) {
    fail('trusted_execution_key_registry_mismatch');
  }
}

function pinManifest(value, now) {
  exactObject(value, MANIFEST_FIELDS, 'trusted_execution_config_invalid');
  if (
    value.schema_version
      !== 'kernel-equivalence-production-wiring/v1'
    || !HASH_PATTERN.test(value.expected_plan_digest ?? '')
    || !absolutePath(value.grant_root)
    || !absolutePath(value.socket_path)
    || !Number.isInteger(value.grant_ttl_seconds)
    || value.grant_ttl_seconds < 1
  ) {
    fail('trusted_execution_config_invalid');
  }
  const collectorKey = keyMetadata(
    value.collector_key,
    'trusted_execution_collector_key_invalid',
  );
  const executionGrantKey = keyMetadata(
    value.execution_grant_key,
    'trusted_execution_grant_key_invalid',
  );
  const readinessSigningKey = keyMetadata(
    value.readiness_signing_key,
    'trusted_execution_readiness_key_invalid',
  );
  exactObject(
    value.effect_signing_keys,
    REQUIRED_SEAMS,
    'trusted_execution_effect_key_set_invalid',
  );
  const effectSigningKeys = Object.fromEntries(
    REQUIRED_SEAMS.map((seamId) => [
      seamId,
      keyMetadata(
        value.effect_signing_keys[seamId],
        'trusted_execution_effect_key_invalid',
      ),
    ]),
  );
  exactObject(
    value.resource_ports,
    RESOURCE_PORT_FIELDS,
    'trusted_execution_resource_port_config_invalid',
  );
  if (
    value.resource_ports.schema_version
      !== 'kernel-equivalence-resource-ports/v1'
    || !bounded(value.resource_ports.profile_id, 128)
  ) {
    fail('trusted_execution_resource_port_config_invalid');
  }
  let trustRegistry;
  try {
    trustRegistry = validateTrustRegistry(value.trust_registry);
  } catch {
    fail('trusted_execution_trust_registry_invalid');
  }
  if (value.grant_ttl_seconds > trustRegistry.grant_max_age_seconds) {
    fail('trusted_execution_grant_ttl_invalid');
  }
  activeKey(trustRegistry, {
    keyId: collectorKey.key_id,
    purpose: 'collector_bundle',
    serviceId: 'kernel.equivalence.collector',
    now,
  });
  activeKey(trustRegistry, {
    keyId: readinessSigningKey.key_id,
    purpose: 'trusted_execution_readiness',
    serviceId:
      'brain.kernel_equivalence.trusted_execution',
    now,
  });
  activeKey(trustRegistry, {
    keyId: executionGrantKey.key_id,
    purpose: 'execution_grant',
    serviceId: 'brain.authority',
    now,
  });
  for (const descriptor of TRUSTED_NON_RELEASE_EQUIVALENCE_DESCRIPTORS) {
    activeKey(trustRegistry, {
      keyId: effectSigningKeys[descriptor.seam_id].key_id,
      purpose: 'effect_receipt',
      serviceId: descriptor.seam_id,
      now,
    });
  }
  const plan = assembleCanonicalPlan(effectSigningKeys, now);
  if (
    digestTrustedExecutionPlan(plan)
      !== value.expected_plan_digest
  ) {
    fail('trusted_execution_plan_digest_mismatch');
  }
  return Object.freeze({
    collectorKey: Object.freeze(collectorKey),
    effectSigningKeys: Object.freeze(Object.fromEntries(
      Object.entries(effectSigningKeys)
        .map(([key, metadata]) => [key, Object.freeze(metadata)]),
    )),
    executionGrantKey: Object.freeze(executionGrantKey),
    expectedPlanDigest: value.expected_plan_digest,
    grantRoot: value.grant_root,
    grantTtlSeconds: value.grant_ttl_seconds,
    plan: Object.freeze(plan),
    resourcePorts: Object.freeze({
      profile_id: value.resource_ports.profile_id,
      schema_version: value.resource_ports.schema_version,
    }),
    readinessSigningKey:
      Object.freeze(readinessSigningKey),
    readinessTrustAnchor: Object.freeze(structuredClone(
      trustRegistry.keys.find(
        ({ key_id: keyId }) => (
          keyId === readinessSigningKey.key_id
        ),
      ),
    )),
    socketPath: value.socket_path,
    trustRegistry,
  });
}

function pinAssemblyPorts(value, profileId) {
  if (value == null) fail('trusted_execution_ports_unconfigured');
  const snapshot = exactObject(
    value,
    ASSEMBLY_PORT_FIELDS,
    'trusted_execution_ports_invalid',
  );
  if (snapshot.profile_id !== profileId) {
    fail('trusted_execution_ports_profile_mismatch');
  }
  return snapshot;
}

function findDataMethod(value, name) {
  let cursor = value;
  try {
    while (cursor != null) {
      const descriptor = Object.getOwnPropertyDescriptor(cursor, name);
      if (descriptor) {
        return (
          Object.hasOwn(descriptor, 'value')
          && typeof descriptor.value === 'function'
        )
          ? descriptor.value
          : null;
      }
      cursor = Object.getPrototypeOf(cursor);
    }
  } catch {
    return null;
  }
  return null;
}

export function createBrainOwnedDatabasePort(pool) {
  if (!pool || typeof pool !== 'object' || Array.isArray(pool)) {
    fail('production_trusted_execution_database_port_invalid');
  }
  const connect = findDataMethod(pool, 'connect');
  const query = findDataMethod(pool, 'query');
  if (!connect || !query) {
    fail('production_trusted_execution_database_port_invalid');
  }
  return Object.freeze({
    connect: (...args) => Reflect.apply(connect, pool, args),
    query: (...args) => Reflect.apply(query, pool, args),
  });
}

function loadPinnedProductionManifest({
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
  if (typeof now !== 'function' || !Number.isFinite(now())) {
    fail('trusted_execution_clock_invalid');
  }
  const pinnedNow = now();
  const manifest = pinManifest(
    protectedManifest(configFile),
    pinnedNow,
  );
  return manifest;
}

export function loadProductionTrustedExecutionWiring({
  env = process.env,
  pool,
  assemblyPorts,
  now = Date.now,
} = {}) {
  const manifest = loadPinnedProductionManifest({ env, now });
  const ports = pinAssemblyPorts(
    assemblyPorts,
    manifest.resourcePorts.profile_id,
  );
  const executionGrantAuthority = loadExecutionGrantAuthority({
    secretFile: manifest.executionGrantKey.secret_file,
    keyId: manifest.executionGrantKey.key_id,
    trustRegistry: manifest.trustRegistry,
    now,
  });
  const grantAuthority = createProtectedGrantFileAuthority({
    grantRoot: manifest.grantRoot,
    now,
  });
  const grantIssuer = createProtectedGrantFileIssuer({
    grantRoot: manifest.grantRoot,
    executionGrantAuthority,
    maximumTtlSeconds: manifest.grantTtlSeconds,
    now,
  });
  const readinessSigner = loadTrustedExecutionReadinessSigner({
    secretFile: manifest.readinessSigningKey.secret_file,
    keyId: manifest.readinessSigningKey.key_id,
    trustRegistry: manifest.trustRegistry,
    now,
  });
  const createService = createProductionTrustedExecutionServiceFactory({
    cleanupInspector: ports.cleanupInspector,
    effectSigningKeys: manifest.effectSigningKeys,
    expectedPlanDigest: manifest.expectedPlanDigest,
    grantAuthority,
    now,
    plan: manifest.plan,
    pool: createBrainOwnedDatabasePort(pool),
    qualityIsolation: ports.qualityIsolation,
    runtimeEnvironment: {
      KERNEL_EQ_COLLECTOR_KEY_FILE:
        manifest.collectorKey.secret_file,
      KERNEL_EQ_COLLECTOR_KEY_ID:
        manifest.collectorKey.key_id,
    },
    seamPorts: ports.seamPorts,
    securityIsolation: ports.securityIsolation,
    trustRegistry: manifest.trustRegistry,
  });
  return Object.freeze({
    createService,
    grantIssuer,
    readinessSigner,
    readinessTrustAnchor: manifest.readinessTrustAnchor,
    resource_port_profile_id:
      manifest.resourcePorts.profile_id,
    socket_path: manifest.socketPath,
  });
}
