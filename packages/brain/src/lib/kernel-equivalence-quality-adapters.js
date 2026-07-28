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

function violationCellId(cellId) {
  return String(cellId ?? '').replace(/::recovery$/, '::violation');
}

function predecessorRequest(cell, grant) {
  return {
    cell_id: violationCellId(cell.cell_id),
    behavior_id: cell.behavior_id,
    provider: cell.provider,
    scenario: 'violation',
    run_id: grant.run_id,
    attempt_id: grant.attempt_id,
    artifact_sha: grant.artifact_sha,
    resource_id: grant.resource_id,
    resource_ref: grant.resource_ref,
    seam_id: cell.seam_id,
    adapter_id: cell.adapter_id,
  };
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
  predecessorLoader,
}) {
  return Object.freeze({
    async prepare({
      cell,
      grant,
      signal,
      registerCompensation,
    }) {
      assertSignal(signal);
      assertResourceBoundary(descriptor, cell, grant);
      requireFunction(registerCompensation, 'adapter_compensation_registrar_required');

      let predecessor = null;
      if (cell.scenario === 'recovery') {
        if (typeof predecessorLoader !== 'function') {
          fail('adapter_recovery_predecessor_unavailable');
        }
        const loaded = await predecessorLoader(predecessorRequest(cell, grant));
        signal.throwIfAborted();
        if (
          !loaded?.receipt
          || loaded.receipt.schema_version
            !== 'kernel-equivalence-effect-receipt/v1'
        ) {
          fail('adapter_recovery_predecessor_unavailable');
        }
        predecessor = structuredClone(loaded.receipt);
      }

      const resource = await isolation.prepare({
        descriptor,
        cell,
        authorization: grant,
        signal,
        registerCompensation,
      });
      signal.throwIfAborted();
      if (
        !resource
        || resource.resource_id !== grant.resource_id
        || resource.resource_ref !== grant.resource_ref
      ) {
        fail('adapter_prepared_resource_invalid');
      }
      return Object.freeze({
        resource: structuredClone(resource),
        predecessor,
      });
    },

    async invokeActualSeam({
      cell,
      grant,
      prepared,
      signal,
    }) {
      assertSignal(signal);
      assertResourceBoundary(descriptor, cell, grant);
      return seam.invoke({
        cell,
        grant,
        resource: prepared?.resource,
        predecessor: prepared?.predecessor ?? null,
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
      const seamCancellation = await seam.cancel({
        ...context,
        resource: context?.prepared?.resource ?? null,
      });
      const isolationCancellation = await isolation.cancel({
        ...context,
        descriptor,
        resources: cleanupResources(context),
      });
      return Object.freeze({
        confirmed:
          seamCancellation?.confirmed === true
          && isolationCancellation?.confirmed === true,
      });
    },

    async cleanup(context) {
      const resources = cleanupResources(context);
      await seam.cleanup({
        ...context,
        resource: context?.prepared?.resource ?? null,
      });
      const cleanup = await isolation.cleanup({
        ...context,
        descriptor,
        resources,
      });
      return Object.freeze({
        resources: resources.map((resource) => structuredClone(resource)),
        isolation_cleanup: structuredClone(cleanup),
      });
    },
  });
}

export function createQualityEquivalenceAdapterRegistry({
  seams,
  isolation,
  predecessorLoader = null,
} = {}) {
  requireFunction(isolation?.prepare, 'adapter_isolation_port_unavailable');
  requireFunction(isolation?.cancel, 'adapter_isolation_port_unavailable');
  requireFunction(isolation?.cleanup, 'adapter_isolation_port_unavailable');

  const entries = QUALITY_EQUIVALENCE_ADAPTER_DESCRIPTORS.map((descriptor) => {
    const seam = seams?.[descriptor.seam_id];
    requireFunction(seam?.invoke, 'adapter_actual_seam_unavailable');
    requireFunction(seam?.cancel, 'adapter_actual_seam_unavailable');
    requireFunction(seam?.cleanup, 'adapter_actual_seam_unavailable');
    return [
      descriptor.adapter_id,
      createAdapter({
        descriptor,
        seam,
        isolation,
        predecessorLoader,
      }),
    ];
  });
  return new Map(entries);
}

export function createQualityCleanupVerifier({ isolation } = {}) {
  requireFunction(isolation?.inspect, 'cleanup_inspection_port_unavailable');
  return async function verifyQualityCleanup(context) {
    const resources = cleanupResources(context);
    const inspections = await Promise.all(resources.map((resource) => (
      isolation.inspect({
        ...context,
        resource,
      })
    )));
    return Object.freeze({
      confirmed:
        resources.length > 0
        && inspections.every((inspection) => inspection?.exists === false),
    });
  };
}
