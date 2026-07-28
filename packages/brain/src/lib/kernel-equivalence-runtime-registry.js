const ADAPTER_ID_PATTERN = /^kernel\.drill\.[a-z0-9_.-]+\.v[1-9][0-9]*$/;
const VERIFIER_ID_PATTERN = /^kernel\.cleanup\.[a-z0-9_.-]+\.v[1-9][0-9]*$/;
const SERVICE_ID_PATTERN = /^kernel\.[a-z0-9_.-]+$/;
const CLEANUP_EVIDENCE_PATTERN = /^cleanup-evidence:[a-f0-9]{64}$/;
const ADAPTER_FIELDS = Object.freeze([
  'adapter_id',
  'cancel',
  'cleanup',
  'invokeActualSeam',
  'observe',
  'owner_service',
  'prepare',
]);
const VERIFIER_FIELDS = Object.freeze([
  'adapter_id',
  'owner_service',
  'verifier_id',
  'verifyCleanup',
]);
const RESULT_FIELDS = Object.freeze([
  'confirmed',
  'evidence_ref',
]);

export class EquivalenceRuntimeRegistryError extends Error {
  constructor(code) {
    super(code);
    this.name = 'EquivalenceRuntimeRegistryError';
    this.code = code;
  }
}

function fail(code) {
  throw new EquivalenceRuntimeRegistryError(code);
}

function exactFields(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  return actual.length === expected.length
    && actual.every((field, index) => field === expected[index]);
}

function completeAdapter(value) {
  return (
    exactFields(value, ADAPTER_FIELDS)
    && ADAPTER_ID_PATTERN.test(value.adapter_id ?? '')
    && SERVICE_ID_PATTERN.test(value.owner_service ?? '')
    && typeof value.prepare === 'function'
    && typeof value.invokeActualSeam === 'function'
    && typeof value.observe === 'function'
    && typeof value.cancel === 'function'
    && typeof value.cleanup === 'function'
  );
}

export function createServerOwnedAdapterRegistry({ adapters = [] } = {}) {
  if (!Array.isArray(adapters)) fail('adapter_registry_invalid');
  const entries = new Map();
  for (const adapter of adapters) {
    if (!completeAdapter(adapter)) fail('adapter_registry_invalid');
    if (entries.has(adapter.adapter_id)) fail('adapter_registry_duplicate');
    entries.set(adapter.adapter_id, Object.freeze({
      adapter_id: adapter.adapter_id,
      owner_service: adapter.owner_service,
      prepare: adapter.prepare,
      invokeActualSeam: adapter.invokeActualSeam,
      observe: adapter.observe,
      cancel: adapter.cancel,
      cleanup: adapter.cleanup,
    }));
  }
  const ids = Object.freeze([...entries.keys()].sort());
  return Object.freeze({
    ids,
    size: ids.length,
    resolve(adapterId) {
      return entries.get(adapterId) ?? null;
    },
  });
}

function completeVerifier(value) {
  return (
    exactFields(value, VERIFIER_FIELDS)
    && VERIFIER_ID_PATTERN.test(value.verifier_id ?? '')
    && ADAPTER_ID_PATTERN.test(value.adapter_id ?? '')
    && SERVICE_ID_PATTERN.test(value.owner_service ?? '')
    && typeof value.verifyCleanup === 'function'
  );
}

function validateResult(result) {
  if (
    !exactFields(result, RESULT_FIELDS)
    || typeof result.confirmed !== 'boolean'
    || (
      result.confirmed
      && !CLEANUP_EVIDENCE_PATTERN.test(result.evidence_ref ?? '')
    )
    || (!result.confirmed && result.evidence_ref !== null)
  ) {
    fail('cleanup_verifier_result_invalid');
  }
  return Object.freeze({
    confirmed: result.confirmed,
    evidence_ref: result.evidence_ref,
  });
}

export function createIndependentCleanupVerifierRegistry({
  adapterRegistry,
  verifiers = [],
} = {}) {
  if (
    !adapterRegistry
    || !Array.isArray(adapterRegistry.ids)
    || typeof adapterRegistry.resolve !== 'function'
    || !Array.isArray(verifiers)
  ) {
    fail('cleanup_verifier_registry_invalid');
  }
  const entries = new Map();
  const verifierIds = new Set();
  for (const verifier of verifiers) {
    if (!completeVerifier(verifier)) fail('cleanup_verifier_registry_invalid');
    if (
      verifierIds.has(verifier.verifier_id)
      || entries.has(verifier.adapter_id)
    ) {
      fail('cleanup_verifier_duplicate');
    }
    const adapter = adapterRegistry.resolve(verifier.adapter_id);
    if (!adapter) fail('cleanup_verifier_adapter_unknown');
    if (adapter.owner_service === verifier.owner_service) {
      fail('cleanup_verifier_not_independent');
    }
    verifierIds.add(verifier.verifier_id);
    entries.set(verifier.adapter_id, Object.freeze({
      verifier_id: verifier.verifier_id,
      adapter_id: verifier.adapter_id,
      owner_service: verifier.owner_service,
      verifyCleanup: verifier.verifyCleanup,
    }));
  }
  if (adapterRegistry.ids.some((adapterId) => !entries.has(adapterId))) {
    fail('cleanup_verifier_missing');
  }
  const ids = Object.freeze([...verifierIds].sort());
  return Object.freeze({
    ids,
    size: ids.length,
    async verify(context) {
      const adapterId = context?.cell?.adapter_id;
      const verifier = entries.get(adapterId);
      if (!verifier) fail('cleanup_verifier_unavailable');
      return validateResult(await verifier.verifyCleanup(context));
    },
  });
}
