import {
  PROOF_PROVIDERS,
  PROOF_SCENARIOS,
} from './kernel-behavior-equivalence.js';

const REQUIRED_BEHAVIOR_COUNT = 11;
const SAFE_ENVIRONMENTS = new Set(['isolated', 'ephemeral']);
const SAFE_RESOURCE_TYPES = new Set([
  'ephemeral_branch',
  'ephemeral_credential_lease',
  'ephemeral_database_record',
  'ephemeral_run',
  'ephemeral_staging',
  'ephemeral_workspace',
]);
const SAFE_PREFIX = /^(?:refs\/heads\/)?equivalence-drill\/[a-z0-9_{}./:-]+$/;
const FORBIDDEN_RESOURCE = /(?:^|[/_.:-])(?:main|master|production|prod|release)(?:$|[/_.:-])/i;

export class EquivalenceDrillError extends Error {
  constructor(code, detail = null) {
    super(code);
    this.name = 'EquivalenceDrillError';
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, detail = null) {
  throw new EquivalenceDrillError(code, detail);
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function activeEffectKey(registry, keyId, seamId) {
  return Array.isArray(registry?.keys)
    && registry.keys.some((key) => (
      key?.key_id === keyId
      && key?.purpose === 'effect_receipt'
      && key?.service_id === seamId
      && key?.revoked_at == null
    ));
}

function validateIsolation(isolation, behaviorId) {
  if (
    !SAFE_ENVIRONMENTS.has(isolation.environment)
    || !SAFE_RESOURCE_TYPES.has(isolation.resource_type)
    || !nonEmpty(isolation.resource_prefix)
    || !SAFE_PREFIX.test(isolation.resource_prefix)
    || FORBIDDEN_RESOURCE.test(isolation.resource_prefix)
  ) {
    fail('drill_isolation_unsafe', behaviorId);
  }
}

function validateScenarios(scenarios, behaviorId) {
  const keys = Object.keys(scenarios).sort();
  const expected = [...PROOF_SCENARIOS].sort();
  if (
    keys.length !== expected.length
    || keys.some((key, index) => key !== expected[index])
  ) {
    fail('drill_scenario_catalog_invalid', behaviorId);
  }
  for (const scenario of PROOF_SCENARIOS) {
    const descriptor = asObject(scenarios[scenario]);
    if (!nonEmpty(descriptor.expected_outcome) || !nonEmpty(descriptor.effect_code)) {
      fail('drill_scenario_contract_invalid', `${behaviorId}:${scenario}`);
    }
    if (
      scenario === 'recovery'
      && descriptor.predecessor_scenario !== 'violation'
    ) {
      fail('drill_recovery_predecessor_invalid', behaviorId);
    }
  }
}

export function compileDrillPlan(contract) {
  const section = asObject(contract?.behavior_equivalence);
  const behaviors = Array.isArray(section.behaviors) ? section.behaviors : [];
  if (
    section.required_behavior_count !== REQUIRED_BEHAVIOR_COUNT
    || behaviors.length !== REQUIRED_BEHAVIOR_COUNT
  ) {
    fail('drill_behavior_count_invalid');
  }

  const ids = new Set();
  const descriptors = behaviors.map((behavior) => {
    const behaviorId = behavior?.behavior_id;
    if (!nonEmpty(behaviorId)) fail('drill_behavior_id_invalid');
    if (ids.has(behaviorId)) fail('drill_behavior_id_duplicate', behaviorId);
    ids.add(behaviorId);

    const drill = asObject(behavior.drill);
    const isolation = asObject(drill.isolation);
    const scenarios = asObject(drill.scenarios);
    if (
      !nonEmpty(drill.seam_id)
      || !nonEmpty(drill.seam_ref)
      || !nonEmpty(drill.adapter_id)
      || drill.effect_key_purpose !== 'effect_receipt'
      || !['available', 'missing'].includes(drill.effect_signer_status)
    ) {
      fail('drill_descriptor_invalid', behaviorId);
    }
    validateIsolation(isolation, behaviorId);
    validateScenarios(scenarios, behaviorId);

    if (drill.effect_signer_status === 'missing') {
      if (drill.blocked_by !== 'seam_receipt_signer_missing') {
        fail('drill_missing_signer_blocker_invalid', behaviorId);
      }
    } else if (
      !nonEmpty(drill.effect_key_id)
      || !activeEffectKey(
        section.drill_trust_registry,
        drill.effect_key_id,
        drill.seam_id,
      )
    ) {
      fail('drill_effect_signer_key_missing', behaviorId);
    }

    return {
      behavior_id: behaviorId,
      priority: behavior.priority,
      owner: behavior.owner,
      seam_id: drill.seam_id,
      seam_ref: drill.seam_ref,
      adapter_id: drill.adapter_id,
      effect_signer_status: drill.effect_signer_status,
      effect_key_id: drill.effect_key_id ?? null,
      blocked_by: drill.blocked_by ?? null,
      isolation,
      scenarios,
    };
  });

  const cells = descriptors.flatMap((descriptor) => (
    PROOF_PROVIDERS.flatMap((provider) => (
      PROOF_SCENARIOS.map((scenario) => ({
        cell_id: `${descriptor.behavior_id}::${provider}::${scenario}`,
        behavior_id: descriptor.behavior_id,
        priority: descriptor.priority,
        owner: descriptor.owner,
        provider,
        scenario,
        seam_id: descriptor.seam_id,
        seam_ref: descriptor.seam_ref,
        adapter_id: descriptor.adapter_id,
        effect_signer_status: descriptor.effect_signer_status,
        effect_key_id: descriptor.effect_key_id,
        blocked_by: descriptor.blocked_by,
        isolation: structuredClone(descriptor.isolation),
        expected: structuredClone(descriptor.scenarios[scenario]),
      }))
    ))
  )).sort((left, right) => left.cell_id.localeCompare(right.cell_id));

  if (
    cells.length !== REQUIRED_BEHAVIOR_COUNT
      * PROOF_PROVIDERS.length
      * PROOF_SCENARIOS.length
    || new Set(cells.map((cell) => cell.cell_id)).size !== cells.length
  ) {
    fail('drill_cell_matrix_invalid');
  }

  return Object.freeze({
    schema_version: 'kernel-equivalence-drill-plan/v1',
    contract_version: section.contract_version ?? null,
    behavior_count: descriptors.length,
    cells,
  });
}
