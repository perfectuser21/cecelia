import { createCleanupEvidence } from './kernel-equivalence-runtime-registry.js';

const DESCRIPTORS = [
  {
    behavior_id: 'KERNEL-P0-05-INDEPENDENT-EVALUATOR-JUDGE',
    seam_id: 'kernel.evaluation.independent_judge',
    adapter_id: 'kernel.drill.independent_evaluator_judge.v1',
  },
  {
    behavior_id: 'KERNEL-P1-08-STOP-ORPHAN-LIVENESS',
    seam_id: 'kernel.liveness.orphan_recovery',
    adapter_id: 'kernel.drill.stop_orphan_liveness.v1',
  },
  {
    behavior_id: 'KERNEL-P1-09-DEVGATE-TDD-DOD',
    seam_id: 'kernel.quality.devgate',
    adapter_id: 'kernel.drill.devgate_tdd_dod.v1',
  },
  {
    behavior_id: 'KERNEL-P1-10-CONTROLLER-SESSION-ISOLATION',
    seam_id: 'kernel.controller.attempt_ownership',
    adapter_id: 'kernel.drill.controller_session_isolation.v1',
  },
  {
    behavior_id: 'KERNEL-P1-11-REPORT-LEARNING-CLOSURE',
    seam_id: 'kernel.closure.report_learning',
    adapter_id: 'kernel.drill.report_learning_closure.v1',
  },
];

export const QUALITY_EQUIVALENCE_ADAPTER_DESCRIPTORS = Object.freeze(
  DESCRIPTORS.map((descriptor) => Object.freeze({ ...descriptor })),
);

class QualityAdapterError extends Error {
  constructor(code) {
    super(code);
    this.name = 'QualityAdapterError';
    this.code = code;
  }
}

function fail(code) {
  throw new QualityAdapterError(code);
}

function requireFunction(value, code) {
  if (typeof value !== 'function') fail(code);
}

function assertSignal(signal) {
  if (!signal || typeof signal.throwIfAborted !== 'function') {
    fail('adapter_abort_signal_required');
  }
  signal.throwIfAborted();
}

function renderPrefix(cell, grant) {
  const template = cell?.isolation?.resource_prefix;
  if (typeof template !== 'string') fail('adapter_resource_boundary_invalid');
  return template
    .replaceAll('{run_id}', grant?.run_id ?? '')
    .replaceAll('{attempt_id}', grant?.attempt_id ?? '');
}

function assertResourceBoundary(descriptor, cell, grant) {
  const prefix = renderPrefix(cell, grant);
  if (
    cell?.behavior_id !== descriptor.behavior_id
    || cell?.seam_id !== descriptor.seam_id
    || cell?.adapter_id !== descriptor.adapter_id
    || grant?.seam_id !== descriptor.seam_id
    || grant?.adapter_id !== descriptor.adapter_id
    || typeof grant?.resource_id !== 'string'
    || grant.resource_id.length === 0
    || grant?.resource_prefix !== prefix
    || typeof grant?.resource_ref !== 'string'
    || grant.resource_ref === prefix
    || !grant.resource_ref.startsWith(prefix)
  ) {
    fail('adapter_resource_boundary_invalid');
  }
}

function plainSerializable(value) {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(plainSerializable);
  if (
    !value
    || typeof value !== 'object'
    || Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false;
  }
  return Object.entries(value).every(([key, entry]) => (
    typeof key === 'string'
    && entry !== undefined
    && plainSerializable(entry)
  ));
}

function cloneResource(value) {
  if (!plainSerializable(value)) fail('adapter_prepared_resource_invalid');
  try {
    return structuredClone(value);
  } catch {
    fail('adapter_prepared_resource_invalid');
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

function assertPredecessor(cell, predecessor) {
  if (cell?.scenario !== 'recovery') {
    if (predecessor !== null) fail('adapter_recovery_predecessor_invalid');
    return;
  }
  if (
    !predecessor
    || typeof predecessor !== 'object'
    || Array.isArray(predecessor)
    || Object.keys(predecessor).sort().join(',') !== 'grant,receipt'
    || predecessor.grant?.schema_version
      !== 'kernel-equivalence-execution-grant/v1'
    || predecessor.receipt?.schema_version
      !== 'kernel-equivalence-effect-receipt/v1'
  ) {
    fail('adapter_recovery_predecessor_unavailable');
  }
}

function cleanupResources(context) {
  const candidates = [
    context?.prepared?.resource,
    ...(Array.isArray(context?.compensations) ? context.compensations : []),
  ].filter((resource) => (
    resource
    && typeof resource === 'object'
    && typeof resource.resource_ref === 'string'
  ));
  return [...new Map(
    candidates.map((resource) => [resource.resource_ref, resource]),
  ).values()];
}

function assertReceipt(receipt, descriptor, grant) {
  if (
    !receipt
    || receipt.schema_version !== 'kernel-equivalence-effect-receipt/v1'
    || receipt.seam_id !== descriptor.seam_id
    || receipt.adapter_id !== descriptor.adapter_id
    || receipt.grant_id !== grant?.grant_id
    || receipt.nonce !== grant?.nonce
    || receipt.resource_id !== grant?.resource_id
    || receipt.resource_ref !== grant?.resource_ref
    || typeof receipt.signature !== 'string'
    || receipt.signature.length === 0
  ) {
    fail('adapter_seam_receipt_invalid');
  }
}

function createAdapter({
  descriptor,
  seam,
  isolation,
}) {
  return Object.freeze({
    adapter_id: descriptor.adapter_id,
    owner_service: descriptor.seam_id,

    async prepare({
      cell,
      grant,
      predecessor = null,
      signal,
      registerCompensation,
    }) {
      assertSignal(signal);
      assertResourceBoundary(descriptor, cell, grant);
      requireFunction(registerCompensation, 'adapter_compensation_registrar_required');
      assertPredecessor(cell, predecessor);

      const resource = await isolation.prepare({
        descriptor,
        cell,
        authorization: grant,
        signal,
        registerCompensation: (compensation) => {
          registerCompensation(deepFreeze(cloneResource(compensation)));
        },
      });
      signal.throwIfAborted();
      if (
        !resource
        || resource.resource_id !== grant.resource_id
        || resource.resource_ref !== grant.resource_ref
      ) {
        fail('adapter_prepared_resource_invalid');
      }
      const preparedResource = deepFreeze(cloneResource(resource));
      return Object.freeze({
        resource: preparedResource,
      });
    },

    async invokeActualSeam({
      cell,
      grant,
      prepared,
      predecessor = null,
      signal,
    }) {
      assertSignal(signal);
      assertResourceBoundary(descriptor, cell, grant);
      assertPredecessor(cell, predecessor);
      return seam.invoke({
        cell,
        grant,
        resource: prepared?.resource,
        predecessor,
        signal,
      });
    },

    async observe(seamOutput, {
      cell,
      grant,
      signal,
    }) {
      assertSignal(signal);
      assertResourceBoundary(descriptor, cell, grant);
      assertReceipt(seamOutput, descriptor, grant);
      return structuredClone(seamOutput);
    },

    async cancel(context) {
      const [seamCancellation, isolationCancellation] = await Promise.allSettled([
        Promise.resolve().then(() => seam.cancel({
          ...context,
          resource: context?.prepared?.resource ?? null,
        })),
        Promise.resolve().then(() => isolation.cancel({
          ...context,
          descriptor,
          resources: cleanupResources(context),
        })),
      ]);
      return Object.freeze({
        confirmed:
          seamCancellation.status === 'fulfilled'
          && seamCancellation.value?.confirmed === true
          && isolationCancellation.status === 'fulfilled'
          && isolationCancellation.value?.confirmed === true,
      });
    },

    async cleanup(context) {
      const resources = cleanupResources(context);
      const [seamResult, isolationResult] = await Promise.allSettled([
        Promise.resolve().then(() => seam.cleanup({
          ...context,
          resource: context?.prepared?.resource ?? null,
        })),
        Promise.resolve().then(() => isolation.cleanup({
          ...context,
          descriptor,
          resources,
        })),
      ]);
      if (
        seamResult.status === 'rejected'
        || isolationResult.status === 'rejected'
      ) {
        fail('adapter_cleanup_failed');
      }
      return Object.freeze({
        resources: resources.map((resource) => structuredClone(resource)),
        isolation_cleanup: structuredClone(isolationResult.value),
      });
    },
  });
}

export function createQualityEquivalenceAdapterRegistry({
  seams,
  isolation,
} = {}) {
  if (
    typeof isolation?.owner_service !== 'string'
    || !isolation.owner_service.startsWith('kernel.')
    || typeof isolation?.capability_id !== 'string'
    || isolation.capability_id.length === 0
  ) {
    fail('adapter_isolation_port_unavailable');
  }
  requireFunction(isolation?.prepare, 'adapter_isolation_port_unavailable');
  requireFunction(isolation?.cancel, 'adapter_isolation_port_unavailable');
  requireFunction(isolation?.cleanup, 'adapter_isolation_port_unavailable');

  const entries = QUALITY_EQUIVALENCE_ADAPTER_DESCRIPTORS.map((descriptor) => {
    const seam = seams?.[descriptor.seam_id];
    if (seam?.owner_service !== descriptor.seam_id) {
      fail('adapter_actual_seam_owner_mismatch');
    }
    requireFunction(seam?.invoke, 'adapter_actual_seam_unavailable');
    requireFunction(seam?.cancel, 'adapter_actual_seam_unavailable');
    requireFunction(seam?.cleanup, 'adapter_actual_seam_unavailable');
    return [
      descriptor.adapter_id,
      createAdapter({
        descriptor,
        seam,
        isolation,
      }),
    ];
  });
  return new Map(entries);
}

export function createQualityCleanupVerifier({
  descriptor,
  inspector,
  isolationCapabilityId,
} = {}) {
  const knownDescriptor = DESCRIPTORS.find((candidate) => (
    candidate.behavior_id === descriptor?.behavior_id
    && candidate.seam_id === descriptor?.seam_id
    && candidate.adapter_id === descriptor?.adapter_id
  ));
  if (!knownDescriptor) {
    fail('cleanup_descriptor_invalid');
  }
  if (
    typeof inspector?.owner_service !== 'string'
    || !inspector.owner_service.startsWith('kernel.')
    || typeof inspector?.capability_id !== 'string'
    || inspector.capability_id.length === 0
    || typeof isolationCapabilityId !== 'string'
    || isolationCapabilityId.length === 0
    || inspector.capability_id === isolationCapabilityId
  ) {
    fail('cleanup_inspection_port_unavailable');
  }
  if (inspector.owner_service === knownDescriptor.seam_id) {
    fail('cleanup_inspector_not_independent');
  }
  requireFunction(inspector?.inspect, 'cleanup_inspection_port_unavailable');
  const verifierId = knownDescriptor.adapter_id.replace(
    /^kernel\.drill\./,
    'kernel.cleanup.',
  );
  return Object.freeze({
    verifier_id: verifierId,
    adapter_id: knownDescriptor.adapter_id,
    owner_service: inspector.owner_service,
    async verifyCleanup(context) {
      const resources = cleanupResources(context);
      const inspections = await Promise.all(resources.map(async (resource) => ({
        resource_ref: resource.resource_ref,
        result: await inspector.inspect({
          ...context,
          descriptor: knownDescriptor,
          resource,
        }),
      })));
      const valid = (
        resources.length > 0
        && inspections.every(({ result }) => (
          typeof result?.exists === 'boolean'
          && /^cleanup-evidence:[a-f0-9]{64}$/.test(
            result.evidence_ref ?? '',
          )
        ))
      );
      const confirmed = (
        valid
        && inspections.every(({ result }) => result.exists === false)
      );
      return Object.freeze({
        confirmed,
        evidence: confirmed ? createCleanupEvidence(context) : null,
      });
    },
  });
}

export function createQualityCleanupVerifiers({
  inspector,
  isolationCapabilityId,
} = {}) {
  return Object.freeze(
    QUALITY_EQUIVALENCE_ADAPTER_DESCRIPTORS.map((descriptor) => (
      createQualityCleanupVerifier({
        descriptor,
        inspector,
        isolationCapabilityId,
      })
    )),
  );
}
