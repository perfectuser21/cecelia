import {
  PROOF_PROVIDERS,
  PROOF_SCENARIOS,
} from './kernel-equivalence-axes.js';
import {
  QUALITY_EQUIVALENCE_ADAPTER_DESCRIPTORS,
  createQualityCleanupVerifiers,
  createQualityEquivalenceAdapterRegistry,
} from './kernel-equivalence-quality-adapters.js';
import {
  SECURITY_EQUIVALENCE_ADAPTER_DESCRIPTORS,
  createSecurityEquivalenceAdapters,
  createSecurityEquivalenceCleanupVerifiers,
} from './kernel-equivalence-security-adapters.js';
import {
  createServerOwnedRuntimeRegistry,
} from './kernel-equivalence-runtime-registry.js';

const DESCRIPTORS = Object.freeze([
  ...SECURITY_EQUIVALENCE_ADAPTER_DESCRIPTORS,
  ...QUALITY_EQUIVALENCE_ADAPTER_DESCRIPTORS,
]);
const RELEASE_DESCRIPTOR = Object.freeze({
  behavior_id: 'KERNEL-P0-07-RELEASE-PROMOTION',
  seam_id: 'kernel.release.staging_promotion',
  adapter_id: 'kernel.drill.release_promotion.v1',
});
const PLAN_DESCRIPTORS = Object.freeze([
  ...DESCRIPTORS,
  RELEASE_DESCRIPTOR,
]);
const REQUIRED_SEAM_IDS = Object.freeze(
  DESCRIPTORS.map((descriptor) => descriptor.seam_id).sort(),
);
const REQUIRED_ADAPTER_IDS = Object.freeze(
  DESCRIPTORS.map((descriptor) => descriptor.adapter_id).sort(),
);
const EFFECT_SIGNER_FIELDS = Object.freeze([
  'key_id',
  'purpose',
  'service_id',
  'signEffectResult',
]);
const AUTHORITY_BINDING_SEAMS = new Set([
  'kernel.credential.attempt_lease',
  'kernel.evaluation.independent_judge',
  'kernel.liveness.orphan_recovery',
  'kernel.quality.devgate',
]);

export class KernelTrustedAssemblyError extends Error {
  constructor(code) {
    super(code);
    this.name = 'KernelTrustedAssemblyError';
    this.code = code;
  }
}

function fail(code) {
  throw new KernelTrustedAssemblyError(code);
}

function nonEmpty(value) {
  return (
    typeof value === 'string'
    && value.length > 0
    && value.length <= 2_048
    && !/[\0\r\n]/.test(value)
  );
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length
    && actual.every((key, index) => key === expected[index])
  );
}

function sameStringSet(actual, expected) {
  return (
    actual.length === expected.length
    && [...actual].sort().every((entry, index) => (
      entry === expected[index]
    ))
  );
}

function validatePlan(plan) {
  if (
    plan?.schema_version !== 'kernel-equivalence-drill-plan/v1'
    || plan?.behavior_count !== PLAN_DESCRIPTORS.length
    || !Array.isArray(plan.cells)
    || plan.cells.length !== PLAN_DESCRIPTORS.length
      * PROOF_PROVIDERS.length
      * PROOF_SCENARIOS.length
    || new Set(plan.cells.map((cell) => cell?.cell_id)).size
      !== plan.cells.length
  ) {
    fail('trusted_assembly_plan_invalid');
  }
  const requiredKeyIds = new Set();
  for (const descriptor of PLAN_DESCRIPTORS) {
    const cells = plan.cells.filter((candidate) => (
      candidate?.behavior_id === descriptor.behavior_id
    ));
    if (
      cells.length !== PROOF_PROVIDERS.length * PROOF_SCENARIOS.length
      || new Set(cells.map((cell) => cell.cell_id)).size !== cells.length
    ) {
      fail('trusted_assembly_plan_invalid');
    }
    const axes = new Set(cells.map((cell) => (
      `${cell.provider}:${cell.scenario}`
    )));
    for (const provider of PROOF_PROVIDERS) {
      for (const scenario of PROOF_SCENARIOS) {
        const expectedCellId = (
          `${descriptor.behavior_id}::${provider}::${scenario}`
        );
        if (
          !axes.has(`${provider}:${scenario}`)
          || !cells.some((cell) => (
            cell.provider === provider
            && cell.scenario === scenario
            && cell.cell_id === expectedCellId
          ))
        ) {
          fail('trusted_assembly_plan_invalid');
        }
      }
    }
    if (
      cells.some((cell) => (
        cell.seam_id !== descriptor.seam_id
        || cell.adapter_id !== descriptor.adapter_id
      ))
    ) {
      fail('trusted_assembly_plan_invalid');
    }
    if (descriptor.behavior_id !== RELEASE_DESCRIPTOR.behavior_id) {
      const keyIds = new Set(cells.map((cell) => cell.effect_key_id));
      if (
        cells.some((cell) => (
          cell.effect_signer_status !== 'available'
          || cell.blocked_by != null
          || !nonEmpty(cell.effect_key_id)
        ))
        || keyIds.size !== 1
      ) {
        fail('trusted_assembly_plan_invalid');
      }
      const [keyId] = keyIds;
      if (requiredKeyIds.has(keyId)) {
        fail('trusted_assembly_plan_invalid');
      }
      requiredKeyIds.add(keyId);
    }
  }
}

function validateAssemblyPorts({
  securityIsolation,
  qualityIsolation,
  cleanupInspector,
}) {
  const validIsolation = (value) => (
    nonEmpty(value?.owner_service)
    && nonEmpty(value?.capability_id)
    && typeof value?.prepare === 'function'
    && typeof value?.cancel === 'function'
    && typeof value?.cleanup === 'function'
  );
  if (
    !validIsolation(securityIsolation)
    || securityIsolation.owner_service !== 'kernel.equivalence.isolation'
    || !validIsolation(qualityIsolation)
    || !qualityIsolation.owner_service.startsWith('kernel.')
    || securityIsolation.capability_id === qualityIsolation.capability_id
  ) {
    fail('trusted_assembly_isolation_port_invalid');
  }
  if (
    !nonEmpty(cleanupInspector?.owner_service)
    || !cleanupInspector.owner_service.startsWith('kernel.')
    || REQUIRED_SEAM_IDS.includes(cleanupInspector.owner_service)
    || !nonEmpty(cleanupInspector?.capability_id)
    || cleanupInspector.capability_id === securityIsolation.capability_id
    || cleanupInspector.capability_id === qualityIsolation.capability_id
    || typeof cleanupInspector?.inspect !== 'function'
  ) {
    fail('trusted_assembly_cleanup_inspector_invalid');
  }
}

function effectKeyForDescriptor(plan, descriptor) {
  return plan.cells.find((cell) => (
    cell.behavior_id === descriptor.behavior_id
  )).effect_key_id;
}

function buildSeams({
  plan,
  seamBuilders,
  effectSignersBySeam,
}) {
  if (
    !exactKeys(seamBuilders, REQUIRED_SEAM_IDS)
    || !REQUIRED_SEAM_IDS.every(
      (seamId) => typeof seamBuilders[seamId] === 'function',
    )
  ) {
    fail('trusted_assembly_seam_builder_set_invalid');
  }
  if (!exactKeys(effectSignersBySeam, REQUIRED_SEAM_IDS)) {
    fail('trusted_assembly_effect_signer_set_invalid');
  }

  const seams = {};
  for (const descriptor of DESCRIPTORS) {
    const signer = effectSignersBySeam[descriptor.seam_id];
    if (
      !exactKeys(signer, [...EFFECT_SIGNER_FIELDS].sort())
      || signer.key_id !== effectKeyForDescriptor(plan, descriptor)
      || signer.purpose !== 'effect_receipt'
      || signer.service_id !== descriptor.seam_id
      || typeof signer.signEffectResult !== 'function'
    ) {
      fail('trusted_assembly_effect_signer_boundary_invalid');
    }
    let seam;
    try {
      seam = seamBuilders[descriptor.seam_id]({
        effectSigner: signer,
        createAuthorityBinding: ({ grant, resource } = {}) => (
          createGrantAuthorityBinding({
            seamId: descriptor.seam_id,
            grant,
            resource,
          })
        ),
      });
    } catch (error) {
      if (error instanceof KernelTrustedAssemblyError) throw error;
      fail('trusted_assembly_seam_build_failed');
    }
    if (
      seam?.owner_service !== descriptor.seam_id
      || typeof seam?.invoke !== 'function'
      || typeof seam?.cancel !== 'function'
      || typeof seam?.cleanup !== 'function'
    ) {
      fail('trusted_assembly_seam_invalid');
    }
    seams[descriptor.seam_id] = seam;
  }
  return Object.freeze(seams);
}

export function createGrantAuthorityBinding({
  seamId,
  grant,
  resource,
} = {}) {
  if (
    !AUTHORITY_BINDING_SEAMS.has(seamId)
    || !nonEmpty(grant?.run_id)
    || !nonEmpty(grant?.attempt_id)
    || !nonEmpty(grant?.resource_id)
    || !nonEmpty(grant?.resource_ref)
    || resource?.resource_id !== grant.resource_id
    || resource?.resource_ref !== grant.resource_ref
  ) {
    fail('trusted_assembly_authority_binding_invalid');
  }
  const trustedResource = Object.freeze({
    resource_id: grant.resource_id,
    resource_ref: grant.resource_ref,
  });
  if (seamId === 'kernel.quality.devgate') {
    return Object.freeze({
      run_id: grant.run_id,
      attempt_id: grant.attempt_id,
      resource_id: grant.resource_id,
      resource_ref: grant.resource_ref,
    });
  }
  if (seamId === 'kernel.credential.attempt_lease') {
    return Object.freeze({
      runId: grant.run_id,
      attemptId: grant.attempt_id,
      resourceId: grant.resource_id,
      resourceRef: grant.resource_ref,
    });
  }
  if (seamId === 'kernel.evaluation.independent_judge') {
    if (!nonEmpty(grant.artifact_sha)) {
      fail('trusted_assembly_authority_binding_invalid');
    }
    return Object.freeze({
      runId: grant.run_id,
      attempt: Object.freeze({
        id: grant.attempt_id,
        run_id: grant.run_id,
      }),
      observed: Object.freeze({
        run: Object.freeze({ id: grant.run_id }),
        pr: Object.freeze({ head_sha: grant.artifact_sha }),
      }),
      resource: trustedResource,
    });
  }
  return Object.freeze({
    attempt: Object.freeze({
      id: grant.attempt_id,
      run_id: grant.run_id,
    }),
    resource: trustedResource,
  });
}

export function createBrainOwnedTrustedRuntimeRegistry({
  plan,
  seamBuilders,
  effectSignersBySeam,
  securityIsolation,
  qualityIsolation,
  cleanupInspector,
} = {}) {
  validatePlan(plan);
  validateAssemblyPorts({
    securityIsolation,
    qualityIsolation,
    cleanupInspector,
  });
  const seams = buildSeams({
    plan,
    seamBuilders,
    effectSignersBySeam,
  });
  const securityAdapters = createSecurityEquivalenceAdapters({
    seams,
    isolation: securityIsolation,
  });
  const qualityAdapters = [
    ...createQualityEquivalenceAdapterRegistry({
      seams,
      isolation: qualityIsolation,
    }).values(),
  ];
  const cleanupVerifiers = [
    ...createSecurityEquivalenceCleanupVerifiers({
      inspector: cleanupInspector,
      isolationCapabilityId: securityIsolation.capability_id,
    }),
    ...createQualityCleanupVerifiers({
      inspector: cleanupInspector,
      isolationCapabilityId: qualityIsolation.capability_id,
    }),
  ];
  const adapters = [...securityAdapters, ...qualityAdapters];
  if (
    !sameStringSet(
      adapters.map((adapter) => adapter.adapter_id),
      REQUIRED_ADAPTER_IDS,
    )
    || !sameStringSet(
      cleanupVerifiers.map((verifier) => verifier.adapter_id),
      REQUIRED_ADAPTER_IDS,
    )
  ) {
    fail('trusted_assembly_registry_set_invalid');
  }
  return createServerOwnedRuntimeRegistry({
    adapters,
    cleanupVerifiers,
  });
}

export const TRUSTED_NON_RELEASE_EQUIVALENCE_DESCRIPTORS = DESCRIPTORS;
