import {
  createBrainOwnedProductionSeamBuilders,
} from './kernel-equivalence-production-seam-builders.js';
import {
  loadProductionEffectSignerSet,
} from './kernel-equivalence-production-signers.js';
import {
  loadTrustedEquivalenceRuntime,
} from './kernel-equivalence-runtime-loader.js';
import {
  createBrainOwnedTrustedRuntimeRegistry,
} from './kernel-equivalence-trusted-assembly.js';
import {
  createBrainTrustedExecutionService,
} from './kernel-equivalence-trusted-execution-service.js';

const FACTORY_FIELDS = Object.freeze([
  'cleanupInspector',
  'effectSigningKeys',
  'expectedPlanDigest',
  'grantAuthority',
  'now',
  'plan',
  'pool',
  'qualityIsolation',
  'runtimeEnvironment',
  'seamPorts',
  'securityIsolation',
  'trustRegistry',
]);
const ISOLATION_FIELDS = Object.freeze([
  'cancel',
  'capability_id',
  'cleanup',
  'owner_service',
  'prepare',
]);
const CLEANUP_INSPECTOR_FIELDS = Object.freeze([
  'capability_id',
  'inspect',
  'owner_service',
]);
const GRANT_AUTHORITY_FIELDS = Object.freeze([
  'capability_id',
  'owner_service',
  'resolveProtectedGrant',
]);
const RUNTIME_ENVIRONMENT_FIELDS = Object.freeze([
  'KERNEL_EQ_COLLECTOR_KEY_FILE',
  'KERNEL_EQ_COLLECTOR_KEY_ID',
]);
const DATABASE_PORT_FIELDS = Object.freeze(['connect', 'query']);
const HASH_PATTERN = /^[a-f0-9]{64}$/;

export class KernelProductionTrustedExecutionFactoryError extends Error {
  constructor(code) {
    super(code);
    this.name = 'KernelProductionTrustedExecutionFactoryError';
    this.code = code;
  }
}

function fail(code) {
  throw new KernelProductionTrustedExecutionFactoryError(code);
}

function dataSnapshot(value, expectedFields, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(code);
  }
  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail(code);
  }
  const fields = Reflect.ownKeys(descriptors);
  if (
    fields.some((field) => typeof field !== 'string')
    || fields.length !== expectedFields.length
    || fields.sort().some((field, index) => (
      field !== expectedFields[index]
    ))
  ) {
    fail(code);
  }
  const result = {};
  for (const field of expectedFields) {
    const descriptor = descriptors[field];
    if (
      !descriptor
      || !Object.hasOwn(descriptor, 'value')
      || descriptor.enumerable !== true
    ) {
      fail(code);
    }
    result[field] = descriptor.value;
  }
  return Object.freeze(result);
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function cloneData(value, code) {
  try {
    return deepFreeze(structuredClone(value));
  } catch {
    fail(code);
  }
}

function bounded(value, maximum = 2_048) {
  return (
    typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && !/[\0\r\n]/.test(value)
  );
}

function capabilityPort(value, {
  fields,
  functions,
  owner,
  code,
}) {
  if (!Object.isFrozen(value)) fail(code);
  const snapshot = dataSnapshot(value, fields, code);
  if (
    snapshot.owner_service !== owner
    || !bounded(snapshot.capability_id)
    || functions.some((name) => typeof snapshot[name] !== 'function')
  ) {
    fail(code);
  }
  return Object.freeze({
    ...Object.fromEntries(fields
      .filter((field) => !functions.includes(field))
      .map((field) => [field, snapshot[field]])),
    ...Object.fromEntries(functions.map((name) => {
      const operation = snapshot[name];
      return [name, (...args) => Reflect.apply(
        operation,
        undefined,
        args,
      )];
    })),
  });
}

function runtimeEnvironment(value) {
  const snapshot = dataSnapshot(
    value,
    RUNTIME_ENVIRONMENT_FIELDS,
    'production_trusted_execution_runtime_environment_invalid',
  );
  if (
    !bounded(snapshot.KERNEL_EQ_COLLECTOR_KEY_FILE, 4_096)
    || !bounded(snapshot.KERNEL_EQ_COLLECTOR_KEY_ID)
  ) {
    fail('production_trusted_execution_runtime_environment_invalid');
  }
  return snapshot;
}

function databasePort(value) {
  const code = 'production_trusted_execution_database_port_invalid';
  const snapshot = dataSnapshot(value, DATABASE_PORT_FIELDS, code);
  if (
    typeof snapshot.connect !== 'function'
    || typeof snapshot.query !== 'function'
  ) {
    fail(code);
  }
  const receiver = Object.freeze(Object.assign(Object.create(null), {
    connect: snapshot.connect,
    query: snapshot.query,
  }));
  return Object.freeze({
    connect: (...args) => Reflect.apply(
      snapshot.connect,
      receiver,
      args,
    ),
    query: (...args) => Reflect.apply(
      snapshot.query,
      receiver,
      args,
    ),
  });
}

export function createProductionTrustedExecutionServiceFactory(input = {}) {
  const value = dataSnapshot(
    input,
    FACTORY_FIELDS,
    'production_trusted_execution_factory_input_invalid',
  );
  if (
    !HASH_PATTERN.test(value.expectedPlanDigest ?? '')
    || typeof value.now !== 'function'
  ) {
    fail('production_trusted_execution_factory_input_invalid');
  }
  const plan = cloneData(
    value.plan,
    'production_trusted_execution_plan_invalid',
  );
  const trustRegistry = cloneData(
    value.trustRegistry,
    'production_trusted_execution_trust_registry_invalid',
  );
  const env = runtimeEnvironment(value.runtimeEnvironment);
  const pool = databasePort(value.pool);
  const securityIsolation = capabilityPort(value.securityIsolation, {
    fields: ISOLATION_FIELDS,
    functions: ['prepare', 'cancel', 'cleanup'],
    owner: 'kernel.equivalence.isolation',
    code: 'production_trusted_execution_isolation_port_invalid',
  });
  const qualityIsolation = capabilityPort(value.qualityIsolation, {
    fields: ISOLATION_FIELDS,
    functions: ['prepare', 'cancel', 'cleanup'],
    owner: 'kernel.equivalence.quality_isolation',
    code: 'production_trusted_execution_isolation_port_invalid',
  });
  const cleanupInspector = capabilityPort(value.cleanupInspector, {
    fields: CLEANUP_INSPECTOR_FIELDS,
    functions: ['inspect'],
    owner: 'kernel.equivalence.cleanup_inspector',
    code: 'production_trusted_execution_cleanup_inspector_invalid',
  });
  const grantAuthority = capabilityPort(value.grantAuthority, {
    fields: GRANT_AUTHORITY_FIELDS,
    functions: ['resolveProtectedGrant'],
    owner: 'brain.kernel_equivalence.grants',
    code: 'production_trusted_execution_grant_authority_invalid',
  });

  const seamBuilders = createBrainOwnedProductionSeamBuilders(
    value.seamPorts,
  );
  const effectSignersBySeam = loadProductionEffectSignerSet({
    plan,
    trustRegistry,
    signingKeys: value.effectSigningKeys,
    now: value.now,
  });
  const runtimeRegistry = createBrainOwnedTrustedRuntimeRegistry({
    plan,
    seamBuilders,
    effectSignersBySeam,
    securityIsolation,
    qualityIsolation,
    cleanupInspector,
  });

  let servicePromise;
  const createService = () => {
    servicePromise ??= (async () => {
      const runtime = await loadTrustedEquivalenceRuntime({
        env,
        trustRegistry,
        pool,
        runtimeRegistry,
        now: value.now,
      });
      return createBrainTrustedExecutionService({
        plan,
        expectedPlanDigest: value.expectedPlanDigest,
        runtime,
        grantAuthority,
        now: value.now,
      });
    })();
    return servicePromise;
  };
  return Object.freeze(createService);
}
