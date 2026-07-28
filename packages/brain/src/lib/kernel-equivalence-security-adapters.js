import { sha256Canonical } from './kernel-equivalence-receipts.js';

const ISOLATION_OWNER = 'kernel.equivalence.isolation';
const CLEANUP_OWNER = 'kernel.equivalence.cleanup';

const DESCRIPTORS = [
  {
    behavior_id: 'KERNEL-P0-01-BRANCH-PROTECTION',
    seam_id: 'kernel.workspace.protected_ref_guard',
    adapter_id: 'kernel.drill.branch_protection.v1',
    verifier_id: 'kernel.cleanup.branch_protection.v1',
  },
  {
    behavior_id: 'KERNEL-P0-02-CREDENTIAL-GUARD',
    seam_id: 'kernel.credential.attempt_lease',
    adapter_id: 'kernel.drill.credential_guard.v1',
    verifier_id: 'kernel.cleanup.credential_guard.v1',
  },
  {
    behavior_id: 'KERNEL-P0-03-BRANCH-PUSH-GUARD',
    seam_id: 'kernel.github.mutation_broker',
    adapter_id: 'kernel.drill.branch_push_guard.v1',
    verifier_id: 'kernel.cleanup.branch_push_guard.v1',
  },
  {
    behavior_id: 'KERNEL-P0-04-CI-MERGE-AUTHORITY',
    seam_id: 'kernel.merge.effect_executor',
    adapter_id: 'kernel.drill.ci_merge_authority.v1',
    verifier_id: 'kernel.cleanup.ci_merge_authority.v1',
  },
  {
    behavior_id: 'KERNEL-P0-06-HUMAN-REVIEW-AUTHORITY',
    seam_id: 'kernel.merge.human_review_authority',
    adapter_id: 'kernel.drill.human_review_authority.v1',
    verifier_id: 'kernel.cleanup.human_review_authority.v1',
  },
];

export const SECURITY_EQUIVALENCE_ADAPTER_DESCRIPTORS = Object.freeze(
  DESCRIPTORS.map((descriptor) => Object.freeze({ ...descriptor })),
);

export class SecurityEquivalenceAdapterError extends Error {
  constructor(code) {
    super(code);
    this.name = 'SecurityEquivalenceAdapterError';
    this.code = code;
  }
}

function fail(code) {
  throw new SecurityEquivalenceAdapterError(code);
}

function signalReady(signal) {
  if (!signal || typeof signal.throwIfAborted !== 'function') {
    fail('security_adapter_abort_signal_required');
  }
  signal.throwIfAborted();
}

function resourcePrefix(cell, grant) {
  const template = cell?.isolation?.resource_prefix;
  if (typeof template !== 'string') {
    fail('security_adapter_resource_boundary_invalid');
  }
  return template
    .replaceAll('{run_id}', grant?.run_id ?? '')
    .replaceAll('{attempt_id}', grant?.attempt_id ?? '');
}

function assertBoundary(descriptor, cell, grant) {
  const prefix = resourcePrefix(cell, grant);
  if (
    cell?.behavior_id !== descriptor.behavior_id
    || cell?.seam_id !== descriptor.seam_id
    || cell?.adapter_id !== descriptor.adapter_id
    || grant?.seam_id !== descriptor.seam_id
    || grant?.adapter_id !== descriptor.adapter_id
    || !prefix.endsWith('/')
    || grant?.resource_prefix !== prefix
    || typeof grant?.resource_id !== 'string'
    || grant.resource_id.length === 0
    || typeof grant?.resource_ref !== 'string'
    || grant.resource_ref === prefix
    || !grant.resource_ref.startsWith(prefix)
  ) {
    fail('security_adapter_resource_boundary_invalid');
  }
}

function resourcesFrom(context) {
  const values = [
    context?.prepared?.resource,
    ...(Array.isArray(context?.compensations) ? context.compensations : []),
  ].filter((resource) => (
    resource
    && typeof resource === 'object'
    && typeof resource.resource_id === 'string'
    && typeof resource.resource_ref === 'string'
  ));
  return [...new Map(
    values.map((resource) => [resource.resource_ref, resource]),
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
    fail('security_adapter_seam_receipt_invalid');
  }
}

function createAdapter({ descriptor, seam, isolation }) {
  return Object.freeze({
    adapter_id: descriptor.adapter_id,
    owner_service: descriptor.seam_id,

    async prepare({
      cell,
      grant,
      predecessor = null,
      signal,
      registerCompensation,
    } = {}) {
      signalReady(signal);
      assertBoundary(descriptor, cell, grant);
      if (typeof registerCompensation !== 'function') {
        fail('security_adapter_compensation_registrar_required');
      }
      const resource = await isolation.prepare({
        descriptor,
        cell,
        authorization: grant,
        predecessor,
        signal,
      });
      signal.throwIfAborted();
      if (
        resource?.resource_id !== grant.resource_id
        || resource?.resource_ref !== grant.resource_ref
      ) {
        fail('security_adapter_prepared_resource_invalid');
      }
      const trustedResource = Object.freeze(structuredClone(resource));
      registerCompensation(trustedResource);
      return Object.freeze({ resource: trustedResource });
    },

    async invokeActualSeam({
      cell,
      grant,
      predecessor = null,
      prepared,
      signal,
    } = {}) {
      signalReady(signal);
      assertBoundary(descriptor, cell, grant);
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
    } = {}) {
      signalReady(signal);
      assertBoundary(descriptor, cell, grant);
      assertReceipt(seamOutput, descriptor, grant);
      return structuredClone(seamOutput);
    },

    async cancel(context = {}) {
      const resources = resourcesFrom(context);
      const [seamResult, isolationResult] = await Promise.all([
        seam.cancel({
          ...context,
          resource: context?.prepared?.resource ?? null,
        }),
        isolation.cancel({
          ...context,
          descriptor,
          resources,
        }),
      ]);
      return Object.freeze({
        confirmed:
          seamResult?.confirmed === true
          && isolationResult?.confirmed === true,
      });
    },

    async cleanup(context = {}) {
      const resources = resourcesFrom(context);
      const [seamCleanup, isolationCleanup] = await Promise.allSettled([
        seam.cleanup({
          ...context,
          resource: context?.prepared?.resource ?? null,
        }),
        isolation.cleanup({
          ...context,
          descriptor,
          resources,
        }),
      ]);
      if (
        seamCleanup.status !== 'fulfilled'
        || isolationCleanup.status !== 'fulfilled'
      ) {
        fail('security_adapter_cleanup_failed');
      }
      return Object.freeze({
        resources: resources.map((resource) => structuredClone(resource)),
        isolation_cleanup: structuredClone(isolationCleanup.value),
      });
    },
  });
}

function validateAssembly({ seams, isolation }) {
  if (
    isolation?.owner_service !== ISOLATION_OWNER
    || typeof isolation?.prepare !== 'function'
    || typeof isolation?.cancel !== 'function'
    || typeof isolation?.cleanup !== 'function'
  ) {
    fail('security_adapter_isolation_unavailable');
  }
  for (const descriptor of SECURITY_EQUIVALENCE_ADAPTER_DESCRIPTORS) {
    const seam = seams?.[descriptor.seam_id];
    if (
      seam?.owner_service !== descriptor.seam_id
      || typeof seam?.invoke !== 'function'
      || typeof seam?.cancel !== 'function'
      || typeof seam?.cleanup !== 'function'
    ) {
      fail('security_adapter_actual_seam_unavailable');
    }
  }
}

export function createSecurityEquivalenceAdapters({
  seams,
  isolation,
} = {}) {
  validateAssembly({ seams, isolation });
  return Object.freeze(
    SECURITY_EQUIVALENCE_ADAPTER_DESCRIPTORS.map((descriptor) => (
      createAdapter({
        descriptor,
        seam: seams[descriptor.seam_id],
        isolation,
      })
    )),
  );
}

export function createSecurityEquivalenceCleanupVerifiers({
  isolation,
} = {}) {
  if (
    isolation?.owner_service !== ISOLATION_OWNER
    || typeof isolation?.inspect !== 'function'
  ) {
    fail('security_cleanup_inspection_unavailable');
  }
  return Object.freeze(
    SECURITY_EQUIVALENCE_ADAPTER_DESCRIPTORS.map((descriptor) => (
      Object.freeze({
        verifier_id: descriptor.verifier_id,
        adapter_id: descriptor.adapter_id,
        owner_service: CLEANUP_OWNER,
        async verifyCleanup(context = {}) {
          const resources = resourcesFrom(context);
          const inspections = await Promise.all(resources.map((resource) => (
            isolation.inspect({
              ...context,
              descriptor,
              resource,
            })
          )));
          const confirmed = (
            resources.length > 0
            && inspections.every((inspection) => (
              inspection?.exists === false
              && Array.isArray(inspection?.residue)
              && inspection.residue.length === 0
            ))
          );
          return Object.freeze({
            confirmed,
            evidence_ref: confirmed
              ? `cleanup-evidence:${sha256Canonical({
                adapter_id: descriptor.adapter_id,
                resources: resources.map((resource) => ({
                  resource_id: resource.resource_id,
                  resource_ref: resource.resource_ref,
                })),
                inspections,
              })}`
              : null,
          });
        },
      })
    )),
  );
}
