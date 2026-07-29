import {
  ATOMIC_CONTRACT_COUNTS,
  FAMILY_CANONICAL_AXES,
  PROOF_PROVIDERS,
  PROOF_SCENARIOS,
} from './kernel-equivalence-axes.js';

const SUPPORTED_SCHEMA_VERSIONS = new Set(['1.0.0', '1.1.0']);
const CLASSIFICATIONS = new Set([
  'active_required',
  'drifted_required_gap',
  'intentional_replacement',
  'retired',
]);
const EVIDENCE_KINDS = new Set(['code', 'test', 'contract', 'history']);
const PROOF_REQUIRED_STATUSES = new Set(['gap', 'proven']);
const PROBE_EXPECTED_OUTCOMES = new Set([
  'confirmed',
  'denied',
  'blocked',
  'unknown',
  'recovered',
  'absent',
]);
const PROBE_SCENARIO_OUTCOMES = Object.freeze({
  normal: new Set(['confirmed']),
  violation: new Set(['denied', 'blocked', 'unknown']),
  recovery: new Set(['recovered']),
  absence: new Set(['absent']),
});
const SHA_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const OWNER_SEAM_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const SENSITIVE_EVIDENCE_KEYS = new Set([
  'payload',
  'content',
  'secret',
  'credential',
  'token',
  'private_key',
  'raw_value',
]);
const ACTIVE_FIELDS = [
  'legacy_behavior',
  'legacy_evidence',
  'unified_constructs',
  'gap',
];
const EXCLUSIVE_BLOCKS = ['drift', 'replacement', 'retirement'];
const RECEIPT_MATERIAL_KEY_WHITELIST = new Set([
  'receipt_requirements',
  'exact_receipt_id_required',
  'exact_predecessor_receipt_required',
  'proof_status',
  'absence_proof',
]);
const PREDECESSOR_BINDING_FIELDS = [
  'exact_receipt_id_required',
  'same_provider',
  'same_case',
  'same_artifact_sha',
  'same_resource_generation',
];
const RETIRED_INVARIANT_ID = 'KERNEL-INV-P1-08-01';
const MAX_FAMILIES = ATOMIC_CONTRACT_COUNTS.behavior_count;
const MAX_ATOMS = ATOMIC_CONTRACT_COUNTS.atomic_invariant_count;
const MAX_PROBES = ATOMIC_CONTRACT_COUNTS.probe_definition_count;
const OBJECT_GRAPH_MAX_DEPTH = 64;
const OBJECT_GRAPH_MAX_NODES = 4096;
const OBJECT_GRAPH_MAX_ARRAY_LENGTH = MAX_PROBES;
const MAX_FAMILY_STEPS = 13;
const MAX_FAMILY_DIMENSIONS = 11;
const MAX_FINDINGS = 256;
const FINDING_IDENTITIES = new WeakMap();
const RETIRED_ABSENCE_PROBE_IDS = Object.freeze(
  Array.from(
    { length: 4 },
    (_, index) => `KERNEL-PROBE-P1-08-01-A${String(index + 1).padStart(2, '0')}`,
  ),
);
const COUNT_FIELDS = Object.freeze({
  required_behavior_count: 'behavior_count',
  required_atomic_invariant_count: 'atomic_invariant_count',
  proof_required_atomic_invariant_count: 'proof_required_atomic_invariant_count',
  required_probe_definition_count: 'probe_definition_count',
  proof_required_probe_definition_count: 'proof_required_probe_definition_count',
  required_provider_probe_assertion_count: 'provider_probe_assertion_count',
  required_retired_absence_probe_count: 'retired_absence_probe_count',
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(asObject(value), key);
}

function exactArray(left, right) {
  if (
    !Array.isArray(left)
    || !Array.isArray(right)
    || left.length !== right.length
  ) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (
      !Object.hasOwn(left, index)
      || !Object.hasOwn(right, index)
      || left[index] !== right[index]
    ) {
      return false;
    }
  }
  return true;
}

function exactKeys(value, expected) {
  let keys;
  try {
    keys = Reflect.ownKeys(asObject(value));
  } catch {
    return false;
  }
  if (keys.some((key) => typeof key !== 'string')) return false;
  const actual = keys.sort();
  return exactArray(actual, [...expected].sort());
}

function uniqueArray(value) {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return new Set(value).size === value.length;
}

function sameSet(left, right) {
  return (
    left.size === right.size
    && [...left].every((value) => right.has(value))
  );
}

function addFinding(findings, behaviorId, code, path, message) {
  const identity = behaviorId ?? null;
  let byBehavior = FINDING_IDENTITIES.get(findings);
  if (!byBehavior) {
    byBehavior = new Map();
    FINDING_IDENTITIES.set(findings, byBehavior);
  }
  let byCode = byBehavior.get(identity);
  if (!byCode) {
    byCode = new Map();
    byBehavior.set(identity, byCode);
  }
  let paths = byCode.get(code);
  if (!paths) {
    paths = new Set();
    byCode.set(code, paths);
  }
  if (paths.has(path) || findings.length >= MAX_FINDINGS) return;
  paths.add(path);
  findings.push({
    severity: 'error',
    behavior_id: identity,
    code,
    path,
    message,
  });
}

function cappedAdd(current, increment, maximum) {
  return Math.min(maximum + 1, current + increment);
}

function validExpectationAuthority(authority) {
  if (authority?.kind === 'appendix_explicit') {
    return (
      exactKeys(authority, ['kind', 'normative_ref'])
      && nonEmpty(authority.normative_ref)
    );
  }
  if (authority?.kind === 'design_derived') {
    return (
      exactKeys(authority, ['kind', 'derivation_ref'])
      && nonEmpty(authority.derivation_ref)
    );
  }
  if (authority?.kind === 'coverage_gap') {
    return (
      exactKeys(authority, ['kind', 'owner', 'reason', 'closure_plan'])
      && ['owner', 'reason', 'closure_plan'].every(
        (field) => nonEmpty(authority[field]),
      )
    );
  }
  return false;
}

function validBindingAuthority(authority) {
  return (
    authority?.kind !== 'coverage_gap'
    && validExpectationAuthority(authority)
  );
}

function validProbeOutcomeShape(probe) {
  const allowedForScenario = PROBE_SCENARIO_OUTCOMES[probe?.scenario];
  return (
    exactKeys(probe, [
      'probe_id',
      'scenario',
      'assertion',
      'expected_outcome',
      'expectation_authority',
    ])
    && nonEmpty(probe?.assertion)
    && PROBE_EXPECTED_OUTCOMES.has(probe?.expected_outcome)
    && allowedForScenario?.has(probe.expected_outcome) === true
    && validExpectationAuthority(probe?.expectation_authority)
  );
}

function validRecoveryBindingShape(
  binding,
  violationIds,
  targetIds,
  dedicatedRecoveryIds,
) {
  const predecessorIds = asArray(binding?.predecessor_probe_ids);
  const allowedPredecessors = new Set([
    ...violationIds,
    ...dedicatedRecoveryIds,
  ]);
  const recoveryOrder = new Map(
    [...dedicatedRecoveryIds].map((probeId, index) => [probeId, index]),
  );
  const targetOrder = recoveryOrder.get(binding?.recovery_probe_id);
  return (
    exactKeys(binding, [
      'recovery_probe_id',
      'predecessor_probe_ids',
      'authority',
    ])
    && targetIds.has(binding?.recovery_probe_id)
    && predecessorIds.length > 0
    && uniqueArray(predecessorIds)
    && predecessorIds.every((probeId) => (
      allowedPredecessors.has(probeId)
      && (
        !dedicatedRecoveryIds.has(probeId)
        || recoveryOrder.get(probeId) < targetOrder
      )
    ))
    && validBindingAuthority(binding?.authority)
  );
}

function validRecoveryGapShape(gap, violationIds, targetIds) {
  const violationProbeIds = asArray(gap?.affected_violation_probe_ids);
  const recoveryProbeIds = asArray(gap?.affected_recovery_probe_ids);
  const localProbeId = [...violationIds, ...targetIds].find(
    (probeId) => typeof probeId === 'string',
  );
  const atomIdentity = localProbeId?.match(
    /^KERNEL-PROBE-(P[01]-\d{2}-\d{2})(?:-|$)/,
  )?.[1];
  const gapPrefix = atomIdentity
    ? `KERNEL-RECOVERY-GAP-${atomIdentity}-`
    : null;
  return (
    exactKeys(gap, [
      'gap_id',
      'affected_violation_probe_ids',
      'affected_recovery_probe_ids',
      'appendix_predecessor_text',
      'reason',
      'owner',
      'closure_plan',
    ])
    && [
      'gap_id',
      'appendix_predecessor_text',
      'reason',
      'owner',
      'closure_plan',
    ].every((field) => nonEmpty(gap?.[field]))
    && gapPrefix !== null
    && gap.gap_id.startsWith(gapPrefix)
    && gap.gap_id.length > gapPrefix.length
    && violationProbeIds.length > 0
    && recoveryProbeIds.length > 0
    && uniqueArray(violationProbeIds)
    && uniqueArray(recoveryProbeIds)
    && violationProbeIds.every((probeId) => violationIds.has(probeId))
    && recoveryProbeIds.every((probeId) => targetIds.has(probeId))
  );
}

function deriveMetrics(behaviors) {
  const metrics = {
    behavior_count: behaviors.length,
    atomic_invariant_count: 0,
    proof_required_atomic_invariant_count: 0,
    probe_definition_count: 0,
    proof_required_probe_definition_count: 0,
    provider_probe_assertion_count: 0,
    retired_absence_probe_count: 0,
    probe_outcome_authority: {
      appendix_explicit: 0,
      design_derived: 0,
      coverage_gap: 0,
    },
    recovery_mapping: {
      exact_binding_count: 0,
      derived_binding_count: 0,
      coverage_gap_count: 0,
    },
  };
  let scannedAtoms = 0;
  let scannedProbes = 0;
  const familyLimit = Math.min(behaviors.length, MAX_FAMILIES + 1);

  for (let familyIndex = 0; familyIndex < familyLimit; familyIndex += 1) {
    const atoms = asArray(behaviors[familyIndex]?.atomic_invariants);
    metrics.atomic_invariant_count = cappedAdd(
      metrics.atomic_invariant_count,
      atoms.length,
      MAX_ATOMS,
    );
    const atomLimit = Math.min(atoms.length, MAX_ATOMS + 1 - scannedAtoms);
    for (let atomIndex = 0; atomIndex < atomLimit; atomIndex += 1) {
      const atom = atoms[atomIndex];
      const proofRequired = atom?.classification !== 'retired';
      scannedAtoms += 1;
      if (proofRequired) {
        metrics.proof_required_atomic_invariant_count = cappedAdd(
          metrics.proof_required_atomic_invariant_count,
          1,
          ATOMIC_CONTRACT_COUNTS.proof_required_atomic_invariant_count,
        );
      }
      const probes = asArray(atom?.probe_definitions);
      const boundedProbes = probes.slice(0, MAX_PROBES + 1);
      const normalIds = new Set(
        boundedProbes
          .filter((probe) => probe?.scenario === 'normal')
          .map((probe) => probe?.probe_id),
      );
      const violationIds = new Set(
        boundedProbes
          .filter((probe) => probe?.scenario === 'violation')
          .map((probe) => probe?.probe_id),
      );
      const recoveryIds = new Set(
        boundedProbes
          .filter((probe) => probe?.scenario === 'recovery')
          .map((probe) => probe?.probe_id),
      );
      const recovery = asObject(atom?.scenario_plan?.recovery);
      const targetIds = recoveryIds.size > 0
        ? recoveryIds
        : new Set(
          asArray(recovery.required_probe_ids)
            .filter((probeId) => normalIds.has(probeId)),
        );
      metrics.probe_definition_count = cappedAdd(
        metrics.probe_definition_count,
        probes.length,
        MAX_PROBES,
      );
      if (proofRequired) {
        metrics.proof_required_probe_definition_count = cappedAdd(
          metrics.proof_required_probe_definition_count,
          probes.length,
          ATOMIC_CONTRACT_COUNTS.proof_required_probe_definition_count,
        );
      }
      const probeLimit = Math.min(
        probes.length,
        MAX_PROBES + 1 - scannedProbes,
      );
      for (let probeIndex = 0; probeIndex < probeLimit; probeIndex += 1) {
        if (validProbeOutcomeShape(probes[probeIndex])) {
          const authorityKind = probes[probeIndex].expectation_authority.kind;
          metrics.probe_outcome_authority[authorityKind] += 1;
        }
        if (probes[probeIndex]?.scenario === 'absence') {
          metrics.retired_absence_probe_count = cappedAdd(
            metrics.retired_absence_probe_count,
            1,
            ATOMIC_CONTRACT_COUNTS.retired_absence_probe_count,
          );
        }
        scannedProbes += 1;
      }
      const boundedBindings = asArray(recovery.bindings)
        .slice(0, MAX_PROBES + 1);
      const boundedGaps = asArray(recovery.coverage_gaps)
        .slice(0, MAX_PROBES + 1);
      const structurallyValidBindings = boundedBindings.filter(
        (binding) => validRecoveryBindingShape(
          binding,
          violationIds,
          targetIds,
          recoveryIds,
        ),
      );
      const bindingTargets = structurallyValidBindings.map(
        (binding) => binding.recovery_probe_id,
      );
      const legalBindings = (
        structurallyValidBindings.length === boundedBindings.length
        && new Set(bindingTargets).size === bindingTargets.length
        && !recoveryGraphHasCycle(structurallyValidBindings, recoveryIds)
      ) ? structurallyValidBindings : [];
      for (const binding of legalBindings) {
        if (binding.authority.kind === 'appendix_explicit') {
          metrics.recovery_mapping.exact_binding_count += 1;
        } else {
          metrics.recovery_mapping.derived_binding_count += 1;
        }
      }
      const structurallyValidGaps = boundedGaps.filter(
        (gap) => validRecoveryGapShape(gap, violationIds, targetIds),
      );
      const gapIds = structurallyValidGaps.map((gap) => gap.gap_id);
      const exactRelations = new Set();
      for (const binding of legalBindings) {
        for (const predecessorId of binding.predecessor_probe_ids) {
          if (violationIds.has(predecessorId)) {
            exactRelations.add(
              `${predecessorId}\0${binding.recovery_probe_id}`,
            );
          }
        }
      }
      const gapOverlapsExactRelation = structurallyValidGaps.some((gap) => (
        gap.affected_violation_probe_ids.some((violationId) => (
          gap.affected_recovery_probe_ids.some((recoveryId) => (
            exactRelations.has(`${violationId}\0${recoveryId}`)
          ))
        ))
      ));
      if (
        new Set(gapIds).size === gapIds.length
        && !gapOverlapsExactRelation
      ) {
        metrics.recovery_mapping.coverage_gap_count += structurallyValidGaps.length;
      }
    }
  }
  metrics.provider_probe_assertion_count = Math.min(
    ATOMIC_CONTRACT_COUNTS.provider_probe_assertion_count
      + PROOF_PROVIDERS.length,
    metrics.proof_required_probe_definition_count * PROOF_PROVIDERS.length,
  );
  return metrics;
}

function deriveMetricsSafely(behaviors) {
  try {
    return { metrics: deriveMetrics(behaviors), failure: null };
  } catch {
    return { metrics: deriveMetrics([]), failure: 'invalid' };
  }
}

function inspectObjectGraph(root, keyMatches) {
  if (!root || typeof root !== 'object') {
    return { matched: false, failure: null };
  }
  const visited = new WeakSet();
  const active = new WeakSet();
  const stack = [{ value: root, depth: 0, exiting: false }];
  let matched = false;
  let nodes = 0;

  while (stack.length > 0) {
    const entry = stack.pop();
    const { value, depth, exiting } = entry;
    if (exiting) {
      active.delete(value);
      visited.add(value);
      continue;
    }
    if (visited.has(value)) continue;
    if (active.has(value)) return { matched, failure: 'invalid' };
    if (depth > OBJECT_GRAPH_MAX_DEPTH) {
      return { matched, failure: 'budget_exceeded' };
    }
    nodes += 1;
    if (
      nodes > OBJECT_GRAPH_MAX_NODES
      || (
        Array.isArray(value)
        && value.length > OBJECT_GRAPH_MAX_ARRAY_LENGTH
      )
    ) {
      return { matched, failure: 'budget_exceeded' };
    }

    let keys;
    try {
      keys = Reflect.ownKeys(value);
    } catch {
      return { matched, failure: 'invalid' };
    }
    if (keys.length > OBJECT_GRAPH_MAX_NODES) {
      return { matched, failure: 'budget_exceeded' };
    }

    active.add(value);
    stack.push({ value, depth, exiting: true });
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index];
      if (keyMatches(key)) matched = true;
      let descriptor;
      try {
        descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      } catch {
        return { matched, failure: 'invalid' };
      }
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
        return { matched, failure: 'invalid' };
      }
      const child = descriptor.value;
      if (child && typeof child === 'object') {
        stack.push({ value: child, depth: depth + 1, exiting: false });
      }
    }
  }
  return { matched, failure: null };
}

function inspectSensitiveEvidence(value) {
  return inspectObjectGraph(value, (key) => {
    if (typeof key !== 'string') return true;
    const normalized = key
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_');
    const parts = normalized.split('_').filter(Boolean);
    return (
      SENSITIVE_EVIDENCE_KEYS.has(normalized)
      || parts.some((part) => SENSITIVE_EVIDENCE_KEYS.has(part))
    );
  });
}

function addGraphFailure(findings, behaviorId, path, failure) {
  if (failure == null) return;
  const budgetExceeded = failure === 'budget_exceeded';
  addFinding(
    findings,
    behaviorId,
    budgetExceeded
      ? 'atomic_contract_input_budget_exceeded'
      : 'atomic_contract_input_invalid',
    path,
    budgetExceeded
      ? 'atomic contract object graph exceeds its validation budget'
      : 'atomic contract object graph is cyclic or cannot be inspected safely',
  );
}

function ownDataProperty(value, key) {
  if (!value || typeof value !== 'object') {
    return { value: undefined, failure: null };
  }
  try {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (!descriptor) return { value: undefined, failure: null };
    if (!Object.hasOwn(descriptor, 'value')) {
      return { value: undefined, failure: 'invalid' };
    }
    return { value: descriptor.value, failure: null };
  } catch {
    return { value: undefined, failure: 'invalid' };
  }
}

function inspectOwnDataProperties(value) {
  if (!value || typeof value !== 'object') return { failure: null };
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    return { failure: 'invalid' };
  }
  if (keys.length > OBJECT_GRAPH_MAX_NODES) {
    return { failure: 'budget_exceeded' };
  }
  for (const key of keys) {
    const property = ownDataProperty(value, key);
    if (property.failure) return { failure: property.failure };
  }
  return { failure: null };
}

function safeArrayLength(value) {
  if (!Array.isArray(value)) return { length: 0, failure: null };
  const lengthProperty = ownDataProperty(value, 'length');
  if (
    lengthProperty.failure
    || !Number.isSafeInteger(lengthProperty.value)
    || lengthProperty.value < 0
  ) {
    return { length: 0, failure: 'invalid' };
  }
  return { length: lengthProperty.value, failure: null };
}

function preflightAtomicContract(section) {
  const metrics = deriveMetrics([]);
  const rootInspection = inspectOwnDataProperties(section);
  const schemaProperty = ownDataProperty(section, 'schema_version');
  const behaviorsProperty = ownDataProperty(section, 'behaviors');
  const behaviorsLength = safeArrayLength(behaviorsProperty.value);
  metrics.behavior_count = behaviorsLength.length;
  let failure = (
    rootInspection.failure
    || schemaProperty.failure
    || behaviorsProperty.failure
    || behaviorsLength.failure
  );
  let failurePath = 'behavior_equivalence';
  const behaviors = Array.isArray(behaviorsProperty.value)
    ? behaviorsProperty.value
    : [];

  if (!failure && schemaProperty.value === '1.1.0') {
    let scannedAtoms = 0;
    let scannedProbes = 0;
    const familyLimit = Math.min(behaviorsLength.length, MAX_FAMILIES + 1);
    for (let familyIndex = 0; familyIndex < familyLimit; familyIndex += 1) {
      const familyProperty = ownDataProperty(behaviors, String(familyIndex));
      if (familyProperty.failure) {
        failure = familyProperty.failure;
        failurePath = `behavior_equivalence.behaviors[${familyIndex}]`;
        break;
      }
      const family = familyProperty.value;
      const familyInspection = inspectOwnDataProperties(family);
      if (familyInspection.failure) {
        failure = familyInspection.failure;
        failurePath = `behavior_equivalence.behaviors[${familyIndex}]`;
        break;
      }
      for (const axisField of ['steps', 'dimensions']) {
        const axisProperty = ownDataProperty(family, axisField);
        if (axisProperty.failure) {
          failure = axisProperty.failure;
          failurePath =
            `behavior_equivalence.behaviors[${familyIndex}].${axisField}`;
          break;
        }
        const axisInspection = inspectObjectGraph(
          axisProperty.value,
          () => false,
        );
        if (axisInspection.failure) {
          failure = axisInspection.failure;
          failurePath =
            `behavior_equivalence.behaviors[${familyIndex}].${axisField}`;
          break;
        }
      }
      if (failure) break;
      const atomsProperty = ownDataProperty(family, 'atomic_invariants');
      const atomsLength = safeArrayLength(atomsProperty.value);
      if (atomsProperty.failure || atomsLength.failure) {
        failure = atomsProperty.failure || atomsLength.failure;
        failurePath =
          `behavior_equivalence.behaviors[${familyIndex}].atomic_invariants`;
        break;
      }
      const atoms = Array.isArray(atomsProperty.value)
        ? atomsProperty.value
        : [];
      metrics.atomic_invariant_count = cappedAdd(
        metrics.atomic_invariant_count,
        atomsLength.length,
        MAX_ATOMS,
      );
      const atomLimit = Math.min(
        atomsLength.length,
        MAX_ATOMS + 1 - scannedAtoms,
      );
      for (let atomIndex = 0; atomIndex < atomLimit; atomIndex += 1) {
        const atomProperty = ownDataProperty(atoms, String(atomIndex));
        if (atomProperty.failure) {
          failure = atomProperty.failure;
          failurePath =
            `behavior_equivalence.behaviors[${familyIndex}]`
            + `.atomic_invariants[${atomIndex}]`;
          break;
        }
        const atom = atomProperty.value;
        scannedAtoms += 1;
        const atomInspection = inspectOwnDataProperties(atom);
        if (atomInspection.failure) {
          failure = atomInspection.failure;
          failurePath =
            `behavior_equivalence.behaviors[${familyIndex}]`
            + `.atomic_invariants[${atomIndex}]`;
          break;
        }
        const classification = ownDataProperty(atom, 'classification');
        const probesProperty = ownDataProperty(atom, 'probe_definitions');
        const probesLength = safeArrayLength(probesProperty.value);
        if (
          classification.failure
          || probesProperty.failure
          || probesLength.failure
        ) {
          failure = (
            classification.failure
            || probesProperty.failure
            || probesLength.failure
          );
          failurePath =
            `behavior_equivalence.behaviors[${familyIndex}]`
            + `.atomic_invariants[${atomIndex}]`;
          break;
        }
        const proofRequired = classification.value !== 'retired';
        if (proofRequired) {
          metrics.proof_required_atomic_invariant_count = cappedAdd(
            metrics.proof_required_atomic_invariant_count,
            1,
            ATOMIC_CONTRACT_COUNTS.proof_required_atomic_invariant_count,
          );
        }
        metrics.probe_definition_count = cappedAdd(
          metrics.probe_definition_count,
          probesLength.length,
          MAX_PROBES,
        );
        if (proofRequired) {
          metrics.proof_required_probe_definition_count = cappedAdd(
            metrics.proof_required_probe_definition_count,
            probesLength.length,
            ATOMIC_CONTRACT_COUNTS.proof_required_probe_definition_count,
          );
        }
        scannedProbes += Math.min(
          probesLength.length,
          MAX_PROBES + 1 - scannedProbes,
        );
        const graphInspection = inspectObjectGraph(atom, () => false);
        if (graphInspection.failure) {
          failure = graphInspection.failure;
          failurePath =
            `behavior_equivalence.behaviors[${familyIndex}]`
            + `.atomic_invariants[${atomIndex}]`;
          break;
        }
      }
      if (failure) break;
    }
  }

  metrics.provider_probe_assertion_count = Math.min(
    ATOMIC_CONTRACT_COUNTS.provider_probe_assertion_count
      + PROOF_PROVIDERS.length,
    metrics.proof_required_probe_definition_count * PROOF_PROVIDERS.length,
  );
  return {
    schemaVersion: schemaProperty.value ?? null,
    behaviors,
    metrics,
    failure,
    failurePath,
  };
}

function inspectFamilyAxesGraph(family) {
  const steps = family?.steps;
  const dimensions = family?.dimensions;
  if (
    (Array.isArray(steps) && steps.length > MAX_FAMILY_STEPS)
    || (
      Array.isArray(dimensions)
      && dimensions.length > MAX_FAMILY_DIMENSIONS
    )
  ) {
    return { matched: false, failure: 'budget_exceeded' };
  }
  const stepsInspection = inspectObjectGraph(steps, () => false);
  if (stepsInspection.failure) return stepsInspection;
  return inspectObjectGraph(dimensions, () => false);
}

function repositoryRelative(reference) {
  if (
    !nonEmpty(reference)
    || reference === '.'
    || reference.includes('\0')
    || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(reference)
  ) {
    return false;
  }
  if (
    reference.startsWith('/')
    || reference.startsWith('\\')
    || reference.startsWith('~')
  ) {
    return false;
  }
  return !reference.split(/[\\/]/).includes('..');
}

function validateEvidenceList(
  evidenceList,
  findings,
  behaviorId,
  path,
  invalidCode = 'atomic_legacy_evidence_invalid',
  runtimeCode = 'runtime_audit_verifier_unavailable',
) {
  if (!Array.isArray(evidenceList) || evidenceList.length === 0) {
    addFinding(
      findings,
      behaviorId,
      invalidCode,
      path,
      'evidence must be a non-empty repository evidence list',
    );
    return;
  }
  for (const evidence of asArray(evidenceList)) {
    const inspection = inspectSensitiveEvidence(evidence);
    addGraphFailure(findings, behaviorId, path, inspection.failure);
    if (evidence?.kind === 'runtime_audit') {
      addFinding(
        findings,
        behaviorId,
        runtimeCode,
        path,
        'runtime audit evidence requires a trust-bound verifier not available in A2-0',
      );
      continue;
    }
    if (
      !EVIDENCE_KINDS.has(evidence?.kind)
      || !exactKeys(evidence, ['kind', 'ref', 'audited_at_sha'])
      || !repositoryRelative(evidence?.ref)
      || typeof evidence?.audited_at_sha !== 'string'
      || !SHA_PATTERN.test(evidence.audited_at_sha)
      || inspection.matched
    ) {
      addFinding(
        findings,
        behaviorId,
        invalidCode,
        path,
        'evidence must be repository-relative, immutable, replayable, and non-sensitive',
      );
    }
  }
}

function hasRequiredActiveFields(atom) {
  const gap = asObject(atom?.gap);
  return (
    nonEmpty(atom?.legacy_behavior)
    && asArray(atom?.legacy_evidence).length > 0
    && asArray(atom?.unified_constructs).length > 0
    && ['owner', 'reason', 'closure_plan'].every((field) => nonEmpty(gap[field]))
  );
}

function hasAnyField(atom, fields) {
  return fields.some((field) => hasOwn(atom, field));
}

function normalizedKey(key) {
  if (typeof key !== 'string') return null;
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function inspectReceiptMaterial(value) {
  return inspectObjectGraph(value, (key) => {
    const normalized = normalizedKey(key);
    if (normalized == null) return false;
    const materialKey = (
      normalized.includes('receipt')
      || normalized.includes('grant')
      || normalized.includes('proof')
    );
    if (materialKey && !RECEIPT_MATERIAL_KEY_WHITELIST.has(normalized)) {
      return true;
    }
    return false;
  });
}

function hasReceiptMaterial(value) {
  return inspectReceiptMaterial(value).matched;
}

function validRetirement(atom) {
  const retirement = asObject(atom?.retirement);
  const absenceProof = asObject(retirement.absence_proof);
  const probes = asArray(atom?.probe_definitions);
  return (
    atom?.invariant_id === RETIRED_INVARIANT_ID
    && atom?.priority === 'P1'
    && atom?.proof_status === 'not_applicable'
    && exactKeys(retirement, ['decision_ref', 'rationale', 'absence_proof'])
    && exactKeys(absenceProof, ['required_probe_ids'])
    && nonEmpty(retirement.decision_ref)
    && nonEmpty(retirement.rationale)
    && exactArray(absenceProof.required_probe_ids, RETIRED_ABSENCE_PROBE_IDS)
    && exactKeys(atom?.receipt_requirements, ['policy'])
    && atom?.receipt_requirements?.policy === 'not_required'
    && probes.length === RETIRED_ABSENCE_PROBE_IDS.length
    && probes.every((probe, index) => (
      probe?.probe_id === RETIRED_ABSENCE_PROBE_IDS[index]
      && probe?.scenario === 'absence'
      && validProbeOutcomeShape(probe)
    ))
    && !hasOwn(atom, 'scenario_plan')
    && !hasReceiptMaterial(atom)
  );
}

function validateClassification(atom, findings, behaviorId, path) {
  let valid = CLASSIFICATIONS.has(atom?.classification);
  const hasActiveFields = ACTIVE_FIELDS.every((field) => hasOwn(atom, field));
  const hasDrift = hasOwn(atom, 'drift');
  const hasReplacement = hasOwn(atom, 'replacement');
  const hasRetirement = hasOwn(atom, 'retirement');

  if (atom?.classification === 'active_required') {
    valid = (
      hasActiveFields
      && hasRequiredActiveFields(atom)
      && exactKeys(atom?.gap, ['owner', 'reason', 'closure_plan'])
      && !hasAnyField(atom, EXCLUSIVE_BLOCKS)
      && PROOF_REQUIRED_STATUSES.has(atom?.proof_status)
    );
  } else if (atom?.classification === 'drifted_required_gap') {
    const drift = asObject(atom?.drift);
    valid = (
      hasActiveFields
      && hasRequiredActiveFields(atom)
      && hasDrift
      && ['expected', 'observed', 'owner', 'closure_plan']
        .every((field) => nonEmpty(drift[field]))
      && asArray(drift.evidence).length > 0
      && exactKeys(drift, [
        'expected',
        'observed',
        'evidence',
        'owner',
        'closure_plan',
      ])
      && !hasReplacement
      && !hasRetirement
      && PROOF_REQUIRED_STATUSES.has(atom?.proof_status)
    );
  } else if (atom?.classification === 'intentional_replacement') {
    const replacement = asObject(atom?.replacement);
    const replacementKeys = [
      'forbidden_legacy_authority',
      'replacement_behavior',
      'rationale',
    ];
    valid = (
      hasReplacement
      && replacementKeys
        .every((field) => nonEmpty(replacement[field]))
      && (
        exactKeys(replacement, replacementKeys)
        || exactKeys(replacement, [...replacementKeys, 'legacy_evidence'])
      )
      && !hasAnyField(atom, ACTIVE_FIELDS)
      && !hasDrift
      && !hasRetirement
      && PROOF_REQUIRED_STATUSES.has(atom?.proof_status)
    );
  } else if (atom?.classification === 'retired') {
    valid = (
      hasRetirement
      && validRetirement(atom)
      && !hasAnyField(atom, ACTIVE_FIELDS)
      && !hasDrift
      && !hasReplacement
    );
  }

  if (!valid) {
    addFinding(
      findings,
      behaviorId,
      'atomic_classification_contract_invalid',
      path,
      'atomic classification fields are incomplete, mixed, or incompatible',
    );
  }

  if (hasOwn(atom, 'legacy_evidence')) {
    validateEvidenceList(atom.legacy_evidence, findings, behaviorId, `${path}.legacy_evidence`);
  }
  if (hasOwn(atom, 'drift') && hasOwn(atom.drift, 'evidence')) {
    validateEvidenceList(
      atom.drift.evidence,
      findings,
      behaviorId,
      `${path}.drift.evidence`,
    );
  }
  if (
    atom?.classification === 'intentional_replacement'
    && hasOwn(atom?.replacement, 'legacy_evidence')
  ) {
    validateEvidenceList(
      atom.replacement.legacy_evidence,
      findings,
      behaviorId,
      `${path}.replacement.legacy_evidence`,
      'replacement_legacy_evidence_invalid',
      'replacement_legacy_evidence_invalid',
    );
  }
}

function validateOwner(atom, findings, behaviorId, path) {
  if (
    !nonEmpty(atom?.single_effect_owner_seam)
    || !OWNER_SEAM_PATTERN.test(atom.single_effect_owner_seam)
  ) {
    addFinding(
      findings,
      behaviorId,
      'atomic_single_effect_owner_seam_invalid',
      `${path}.single_effect_owner_seam`,
      'single_effect_owner_seam must be one non-empty scalar',
    );
  }
}

function validateProviderMatrix(atom, findings, behaviorId, path) {
  if (
    !exactKeys(atom?.receipt_requirements, ['policy', 'providers', 'scenarios'])
    ||
    atom?.receipt_requirements?.policy !== 'required_3x3'
    || !exactArray(atom?.receipt_requirements?.providers, PROOF_PROVIDERS)
  ) {
    addFinding(
      findings,
      behaviorId,
      'atomic_provider_matrix_invalid',
      `${path}.receipt_requirements.providers`,
      'proof-required atoms require the exact Claude/Codex/Grok provider matrix',
    );
  }
}

function validateRecoveryBinding(atom, findings, behaviorId, path) {
  const recovery = asObject(atom?.receipt_requirements?.scenarios?.recovery);
  const binding = asObject(recovery.predecessor_binding);
  if (
    !exactKeys(recovery, [
      'expected_outcome',
      'effect_code',
      'predecessor_scenario',
      'predecessor_binding',
    ])
    || recovery.predecessor_scenario !== 'violation'
    || !exactKeys(binding, PREDECESSOR_BINDING_FIELDS)
    || PREDECESSOR_BINDING_FIELDS.some((field) => binding[field] !== true)
  ) {
    addFinding(
      findings,
      behaviorId,
      'atomic_recovery_predecessor_binding_invalid',
      `${path}.receipt_requirements.scenarios.recovery`,
      'recovery must bind the exact same-case violation receipt and resource identity',
    );
  }
}

function validateProbeOutcomeContract(atom, findings, behaviorId, path) {
  const probes = asArray(atom?.probe_definitions);
  for (let probeIndex = 0; probeIndex < probes.length; probeIndex += 1) {
    if (!validProbeOutcomeShape(probes[probeIndex])) {
      addFinding(
        findings,
        behaviorId,
        'probe_outcome_contract_invalid',
        `${path}.probe_definitions[${probeIndex}]`,
        'each probe must preserve its exact assertion, outcome, and expectation authority',
      );
    }
  }
  if (atom?.classification === 'retired') return;

  const requirements = asObject(atom?.receipt_requirements?.scenarios);
  for (const scenario of PROOF_SCENARIOS) {
    const outcomes = new Set(
      probes
        .filter((probe) => probe?.scenario === scenario)
        .map((probe) => probe?.expected_outcome),
    );
    if (outcomes.size === 0) continue;
    const expectedOutcome = outcomes.size === 1 ? [...outcomes][0] : 'per_probe';
    if (requirements?.[scenario]?.expected_outcome !== expectedOutcome) {
      addFinding(
        findings,
        behaviorId,
        'probe_outcome_contract_invalid',
        `${path}.receipt_requirements.scenarios.${scenario}.expected_outcome`,
        'scenario outcome must equal the unique probe outcome or per_probe when heterogeneous',
      );
    }
  }
}

function recoveryGraphHasCycle(bindings, recoveryIds) {
  const outgoing = new Map([...recoveryIds].map((probeId) => [probeId, []]));
  const indegree = new Map([...recoveryIds].map((probeId) => [probeId, 0]));
  for (const binding of bindings) {
    for (const predecessorId of asArray(binding.predecessor_probe_ids)) {
      if (!recoveryIds.has(predecessorId)) continue;
      outgoing.get(predecessorId).push(binding.recovery_probe_id);
      indegree.set(
        binding.recovery_probe_id,
        (indegree.get(binding.recovery_probe_id) ?? 0) + 1,
      );
    }
  }
  const queue = [...indegree]
    .filter(([, count]) => count === 0)
    .map(([probeId]) => probeId);
  let visited = 0;
  for (let index = 0; index < queue.length; index += 1) {
    const probeId = queue[index];
    visited += 1;
    for (const nextId of outgoing.get(probeId) ?? []) {
      const nextCount = indegree.get(nextId) - 1;
      indegree.set(nextId, nextCount);
      if (nextCount === 0) queue.push(nextId);
    }
  }
  return visited !== recoveryIds.size;
}

function validateRecoveryPlan(
  atom,
  findings,
  behaviorId,
  path,
  violationIds,
  targetIds,
  dedicatedRecoveryIds,
) {
  const recovery = asObject(atom?.scenario_plan?.recovery);
  const bindings = asArray(recovery.bindings);
  const gaps = asArray(recovery.coverage_gaps);
  const validBindings = bindings.filter(
    (binding) => validRecoveryBindingShape(
      binding,
      violationIds,
      targetIds,
      dedicatedRecoveryIds,
    ),
  );
  const validGaps = gaps.filter(
    (gap) => validRecoveryGapShape(gap, violationIds, targetIds),
  );
  const bindingTargets = validBindings.map(
    (binding) => binding.recovery_probe_id,
  );
  const bindingInvalid = (
    validBindings.length !== bindings.length
    || new Set(bindingTargets).size !== bindingTargets.length
    || recoveryGraphHasCycle(validBindings, dedicatedRecoveryIds)
  );
  if (bindingInvalid) {
    addFinding(
      findings,
      behaviorId,
      'recovery_binding_authority_invalid',
      `${path}.scenario_plan.recovery.bindings`,
      'recovery bindings require exact atom-local identities, authority, and an acyclic graph',
    );
  }

  const gapIds = validGaps.map((gap) => gap.gap_id);
  const accountedViolations = new Set();
  const accountedRecoveries = new Set(bindingTargets);
  const exactRelations = new Set();
  for (const binding of validBindings) {
    for (const predecessorId of binding.predecessor_probe_ids) {
      if (!violationIds.has(predecessorId)) continue;
      accountedViolations.add(predecessorId);
      exactRelations.add(`${predecessorId}\0${binding.recovery_probe_id}`);
    }
  }
  let duplicateRelation = false;
  for (const gap of validGaps) {
    gap.affected_violation_probe_ids.forEach(
      (probeId) => accountedViolations.add(probeId),
    );
    gap.affected_recovery_probe_ids.forEach(
      (probeId) => accountedRecoveries.add(probeId),
    );
    for (const violationId of gap.affected_violation_probe_ids) {
      for (const recoveryId of gap.affected_recovery_probe_ids) {
        if (exactRelations.has(`${violationId}\0${recoveryId}`)) {
          duplicateRelation = true;
        }
      }
    }
  }
  const gapInvalid = (
    validGaps.length !== gaps.length
    || new Set(gapIds).size !== gapIds.length
    || !sameSet(accountedViolations, violationIds)
    || !sameSet(accountedRecoveries, targetIds)
    || duplicateRelation
  );
  if (gapInvalid) {
    addFinding(
      findings,
      behaviorId,
      'recovery_coverage_gap_invalid',
      `${path}.scenario_plan.recovery.coverage_gaps`,
      'bindings and coverage gaps must account once for every atom-local recovery relation',
    );
  }
}

function validateScenarioRequirements(atom, findings, behaviorId, path) {
  const probes = asArray(atom?.probe_definitions);
  const plan = asObject(atom?.scenario_plan);
  const requirements = asObject(atom?.receipt_requirements?.scenarios);
  let invalid = (
    !exactKeys(plan, PROOF_SCENARIOS)
    || !exactKeys(requirements, PROOF_SCENARIOS)
  );

  for (const scenario of PROOF_SCENARIOS) {
    const requirement = asObject(requirements[scenario]);
    const exactRequirement = scenario === 'recovery'
      ? true
      : exactKeys(requirement, ['expected_outcome', 'effect_code']);
    if (
      !exactRequirement
      || !nonEmpty(requirement.expected_outcome)
      || !nonEmpty(requirement.effect_code)
    ) {
      invalid = true;
    }
  }

  const normalIds = probes
    .filter((probe) => probe?.scenario === 'normal')
    .map((probe) => probe?.probe_id);
  const violationIds = probes
    .filter((probe) => probe?.scenario === 'violation')
    .map((probe) => probe?.probe_id);
  const recoveryIds = probes
    .filter((probe) => probe?.scenario === 'recovery')
    .map((probe) => probe?.probe_id);
  const allProbeScenariosValid = probes.every(
    (probe) => PROOF_SCENARIOS.includes(probe?.scenario),
  );
  const recovery = asObject(plan.recovery);
  const exactRecoveryShape = exactKeys(recovery, [
    'required_probe_ids',
    'bindings',
    'coverage_gaps',
  ]);
  const requiredTargetIds = asArray(recovery.required_probe_ids);
  const usesDedicatedRecovery = recoveryIds.length > 0;
  const targetsValid = usesDedicatedRecovery
    ? exactArray(requiredTargetIds, recoveryIds)
    : (
      requiredTargetIds.length > 0
      && uniqueArray(requiredTargetIds)
      && requiredTargetIds.every((probeId) => normalIds.includes(probeId))
    );

  if (
    normalIds.length === 0
    || violationIds.length === 0
    || !allProbeScenariosValid
    || !exactKeys(plan.normal, ['required_probe_ids'])
    || !exactKeys(plan.violation, ['required_probe_ids'])
    || !exactArray(plan.normal?.required_probe_ids, normalIds)
    || !exactArray(plan.violation?.required_probe_ids, violationIds)
    || !exactRecoveryShape
    || !targetsValid
  ) {
    invalid = true;
  }

  if (invalid) {
    addFinding(
      findings,
      behaviorId,
      'atomic_scenario_requirement_invalid',
      `${path}.scenario_plan`,
      'normal, violation, and recovery probes must use the exact atom-local scenario plan',
    );
  }
  if (
    exactRecoveryShape
    && normalIds.length > 0
    && violationIds.length > 0
    && targetsValid
  ) {
    validateRecoveryPlan(
      atom,
      findings,
      behaviorId,
      path,
      new Set(violationIds),
      new Set(requiredTargetIds),
      new Set(recoveryIds),
    );
  }
}

function validateReceiptMaterial(atom, findings, behaviorId, path) {
  const inspection = inspectReceiptMaterial(atom);
  addGraphFailure(findings, behaviorId, path, inspection.failure);
  if (
    atom?.proof_status === 'proven'
    || inspection.matched
  ) {
    addFinding(
      findings,
      behaviorId,
      'atomic_receipt_v2_verifier_unavailable',
      path,
      'atom-bound receipt material cannot be trusted before the v2 verifier exists',
    );
  }
}

function validateAxes(family, atoms, findings, behaviorId, path) {
  const canonical = FAMILY_CANONICAL_AXES[behaviorId];
  if (!canonical) return;
  let invalid = (
    !exactArray(family?.steps, canonical.steps)
    || !exactArray(family?.dimensions, canonical.dimensions)
  );
  const activeAtoms = atoms.filter((atom) => atom?.classification !== 'retired');
  const stepUnion = new Set();
  const dimensionUnion = new Set();

  for (const atom of activeAtoms) {
    const steps = asArray(atom?.steps);
    const dimensions = asArray(atom?.dimensions);
    if (
      steps.length === 0
      || dimensions.length === 0
      || !uniqueArray(steps)
      || !uniqueArray(dimensions)
      || steps.some((step) => !canonical.steps.includes(step))
      || dimensions.some((dimension) => !canonical.dimensions.includes(dimension))
    ) {
      invalid = true;
    }
    steps.forEach((step) => stepUnion.add(step));
    dimensions.forEach((dimension) => dimensionUnion.add(dimension));
  }
  if (
    activeAtoms.length > 0
    && (
      !sameSet(stepUnion, new Set(canonical.steps))
      || !sameSet(dimensionUnion, new Set(canonical.dimensions))
    )
  ) {
    invalid = true;
  }
  if (invalid) {
    addFinding(
      findings,
      behaviorId,
      'atomic_family_canonical_axes_mismatch',
      path,
      'family axes and non-retired atom coverage must match the canonical family axes',
    );
  }
}

function familyPrefix(behaviorId) {
  if (typeof behaviorId !== 'string') return null;
  return behaviorId.match(/^KERNEL-(P[01]-\d{2})-/)?.[1] ?? null;
}

function parseInvariantIdentity(invariantId) {
  if (typeof invariantId !== 'string') return null;
  const match = invariantId.match(
    /^KERNEL-INV-(P[01]-\d{2})-(\d{2})(?:-[A-Z0-9][A-Z0-9-]*)?$/,
  );
  if (!match) return null;
  return {
    family_prefix: match[1],
    atom_sequence: Number(match[2]),
    probe_prefix: `KERNEL-PROBE-${match[1]}-${match[2]}-`,
  };
}

function parseProbeIdentity(probeId, expectedPrefix) {
  if (
    typeof probeId !== 'string'
    || typeof expectedPrefix !== 'string'
    || !probeId.startsWith(expectedPrefix)
  ) {
    return null;
  }
  const suffix = probeId.slice(expectedPrefix.length);
  const numeric = suffix.match(/^(\d{3})$/);
  if (numeric) {
    return {
      dialect: 'numeric',
      group: null,
      sequence: Number(numeric[1]),
    };
  }
  const coded = suffix.match(/^([NVR])(\d{2})$/);
  if (!coded) return null;
  return {
    dialect: 'coded',
    group: coded[1],
    sequence: Number(coded[2]),
  };
}

function probeSequencesAreValid(parsedProbes) {
  if (parsedProbes.length === 0) return true;
  const dialects = new Set(parsedProbes.map((item) => item.identity.dialect));
  if (dialects.size !== 1) return false;
  if (dialects.has('numeric')) {
    return parsedProbes.every(
      (item, index) => item.identity.sequence === index + 1,
    );
  }
  const expectedScenario = {
    N: 'normal',
    V: 'violation',
    R: 'recovery',
  };
  const nextSequence = { N: 1, V: 1, R: 1 };
  return parsedProbes.every(({ identity, probe }) => {
    const valid = (
      probe?.scenario === expectedScenario[identity.group]
      && identity.sequence === nextSequence[identity.group]
    );
    nextSequence[identity.group] += 1;
    return valid;
  });
}

function validateAtomIdentities(
  family,
  atoms,
  findings,
  duplicateAtomIds,
  duplicateProbeIds,
  path,
) {
  const behaviorId = family?.behavior_id;
  const expectedPrefix = familyPrefix(behaviorId);
  const expectedPriority = expectedPrefix?.split('-')[0] ?? null;
  const parsedSequences = [];
  let atomPrefixesValid = true;

  if (family?.priority !== expectedPriority) {
    addFinding(
      findings,
      behaviorId,
      'atomic_invariant_prefix_invalid',
      `${path}.priority`,
      'family priority must match its canonical behavior identity prefix',
    );
  }

  for (const [atomIndex, atom] of atoms.entries()) {
    const atomPath = `${path}.atomic_invariants[${atomIndex}]`;
    const identity = parseInvariantIdentity(atom?.invariant_id);
    if (
      !identity
      || identity.family_prefix !== expectedPrefix
      || atom?.priority !== expectedPriority
    ) {
      atomPrefixesValid = false;
      addFinding(
        findings,
        behaviorId,
        'atomic_invariant_prefix_invalid',
        `${atomPath}.invariant_id`,
        'invariant identity and priority must match the parent family prefix',
      );
    } else {
      parsedSequences.push(identity.atom_sequence);
    }

    const probes = asArray(atom?.probe_definitions);
    const expectedProbePrefix = identity?.probe_prefix ?? null;
    let probePrefixesValid = expectedProbePrefix != null;
    const parsedProbes = [];
    for (const [probeIndex, probe] of probes.entries()) {
      if (atom?.classification === 'retired') continue;
      const probeIdentity = parseProbeIdentity(probe?.probe_id, expectedProbePrefix);
      if (!probeIdentity) {
        probePrefixesValid = false;
        addFinding(
          findings,
          behaviorId,
          'atomic_probe_prefix_invalid',
          `${atomPath}.probe_definitions[${probeIndex}].probe_id`,
          'probe identity must use its declaring invariant prefix',
        );
      } else {
        parsedProbes.push({ identity: probeIdentity, probe });
      }
    }
    const hasDuplicateProbe = probes.some(
      (probe) => duplicateProbeIds.has(probe?.probe_id),
    );
    if (
      atom?.classification !== 'retired'
      && probePrefixesValid
      && !hasDuplicateProbe
      && !probeSequencesAreValid(parsedProbes)
    ) {
      addFinding(
        findings,
        behaviorId,
        'atomic_probe_count_mismatch',
        `${atomPath}.probe_definitions`,
        'probe identities must use one contiguous numeric or scenario-coded sequence dialect',
      );
    }
  }

  const hasDuplicateAtom = atoms.some(
    (atom) => duplicateAtomIds.has(atom?.invariant_id),
  );
  if (
    atomPrefixesValid
    && !hasDuplicateAtom
    && parsedSequences.some((sequence, index) => sequence !== index + 1)
  ) {
    addFinding(
      findings,
      behaviorId,
      'atomic_family_count_mismatch',
      `${path}.atomic_invariants`,
      'family invariant identities must be contiguous from 01',
    );
  }
}

function projectAtom(atom) {
  const retired = atom?.classification === 'retired';
  return {
    invariant_id: atom?.invariant_id ?? null,
    classification: atom?.classification ?? null,
    proof_status: atom?.proof_status ?? null,
    effective_status: retired ? 'retired' : 'gap',
    projection: retired ? 'na' : 'red',
    retired_absence_probe_statuses: retired
      ? RETIRED_ABSENCE_PROBE_IDS.map((probeId) => ({
        probe_id: probeId,
        status: 'unverified',
      }))
      : [],
  };
}

function projectBoundedFamilies(behaviors) {
  const families = [];
  let remainingAtoms = MAX_ATOMS;
  const familyLimit = Math.min(behaviors.length, MAX_FAMILIES);
  for (let familyIndex = 0; familyIndex < familyLimit; familyIndex += 1) {
    if (!Object.hasOwn(behaviors, familyIndex)) continue;
    const family = behaviors[familyIndex];
    const atoms = asArray(family?.atomic_invariants).slice(0, remainingAtoms);
    remainingAtoms -= atoms.length;
    families.push({
      behavior_id: family?.behavior_id ?? null,
      priority: family?.priority ?? null,
      steps: asArray(family?.steps),
      dimensions: asArray(family?.dimensions),
      atoms: atoms.map(projectAtom),
    });
  }
  return families;
}

function legacyResult(section, findings) {
  return {
    schema_version: section?.schema_version ?? null,
    schema_valid: findings.length === 0,
    atomic_contract_present: false,
    atomic_cutover_ready: false,
    metrics: deriveMetrics([]),
    families: [],
    findings,
  };
}

function addMetricBudgetFindings(metrics, findings) {
  const budgetFailures = [
    [
      metrics.behavior_count > MAX_FAMILIES,
      'behavior_equivalence.behaviors',
      `atomic family count exceeds the maximum of ${MAX_FAMILIES}`,
    ],
    [
      metrics.atomic_invariant_count > MAX_ATOMS,
      'behavior_equivalence.behaviors.atomic_invariants',
      `atomic invariant count exceeds the maximum of ${MAX_ATOMS}`,
    ],
    [
      metrics.probe_definition_count > MAX_PROBES,
      'behavior_equivalence.behaviors.atomic_invariants.probe_definitions',
      `atomic probe count exceeds the maximum of ${MAX_PROBES}`,
    ],
  ];
  for (const [exceeded, path, message] of budgetFailures) {
    if (exceeded) {
      addFinding(
        findings,
        null,
        'atomic_contract_input_budget_exceeded',
        path,
        message,
      );
    }
  }
}

function invalidAtomicResult(schemaVersion, metrics, findings) {
  return {
    schema_version: schemaVersion,
    schema_valid: false,
    atomic_contract_present: schemaVersion === '1.1.0',
    atomic_cutover_ready: false,
    metrics,
    families: [],
    findings,
  };
}

function validateAtomicContractImpl(section) {
  const findings = [];
  const preflight = preflightAtomicContract(section);
  const {
    schemaVersion,
    behaviors,
  } = preflight;
  if (preflight.failure) {
    addGraphFailure(
      findings,
      null,
      preflight.failurePath,
      preflight.failure,
    );
    addMetricBudgetFindings(preflight.metrics, findings);
    return invalidAtomicResult(schemaVersion, preflight.metrics, findings);
  }
  if (!SUPPORTED_SCHEMA_VERSIONS.has(schemaVersion)) {
    addFinding(
      findings,
      null,
      'behavior_equivalence_schema_unsupported',
      'behavior_equivalence.schema_version',
      'behavior equivalence schema_version must be 1.0.0 or 1.1.0',
    );
    return legacyResult(section, findings);
  }

  if (schemaVersion === '1.0.0') {
    const atomicTopLevelFields = Object.keys(COUNT_FIELDS).slice(1);
    const hasAtomicFamilyFields = asArray(section?.behaviors).some((family) => (
      hasOwn(family, 'atomic_invariants')
      || hasOwn(family, 'atomic_invariant_count')
      || hasOwn(family, 'probe_definition_count')
    ));
    if (
      atomicTopLevelFields.some((field) => hasOwn(section, field))
      || hasAtomicFamilyFields
    ) {
      addFinding(
        findings,
        null,
        'atomic_fields_forbidden_in_v1',
        'behavior_equivalence',
        'schema 1.0.0 cannot contain atomic contract fields',
      );
    }
    return legacyResult(section, findings);
  }

  const metricsDerivation = deriveMetricsSafely(behaviors);
  const { metrics } = metricsDerivation;
  if (metricsDerivation.failure) {
    addGraphFailure(
      findings,
      null,
      'behavior_equivalence.behaviors.atomic_invariants',
      metricsDerivation.failure,
    );
    addMetricBudgetFindings(metrics, findings);
    return invalidAtomicResult(schemaVersion, metrics, findings);
  }
  addMetricBudgetFindings(metrics, findings);
  if (findings.length > 0) {
    return {
      schema_version: schemaVersion,
      schema_valid: false,
      atomic_contract_present: true,
      atomic_cutover_ready: false,
      metrics,
      families: projectBoundedFamilies(behaviors),
      findings,
    };
  }

  for (const [declaredField, metricField] of Object.entries(COUNT_FIELDS)) {
    const expected = ATOMIC_CONTRACT_COUNTS[metricField];
    if (
      section?.[declaredField] !== metrics[metricField]
      || metrics[metricField] !== expected
    ) {
      addFinding(
        findings,
        null,
        'atomic_global_count_mismatch',
        `behavior_equivalence.${declaredField}`,
        `${declaredField} must equal the derived and expected inventory count`,
      );
    }
  }

  const behaviorIds = behaviors.map((family) => family?.behavior_id);
  const behaviorIdCounts = new Map();
  for (const behaviorId of behaviorIds) {
    behaviorIdCounts.set(behaviorId, (behaviorIdCounts.get(behaviorId) ?? 0) + 1);
  }
  const canonicalIds = Object.keys(FAMILY_CANONICAL_AXES);
  if (
    behaviorIds.some((id) => !Object.hasOwn(FAMILY_CANONICAL_AXES, id))
    || behaviorIds.some((id) => behaviorIdCounts.get(id) !== 1)
    || !exactArray(behaviorIds, canonicalIds)
  ) {
    addFinding(
      findings,
      null,
      'atomic_global_count_mismatch',
      'behavior_equivalence.behaviors',
      'atomic families must be unique canonical family identities',
    );
  }

  const unsafeFamilyIndexes = new Set();
  const unsafeAtomIndexesByFamily = new Map();
  for (const [familyIndex, family] of behaviors.entries()) {
    const behaviorId = family?.behavior_id ?? null;
    const familyPath = `behavior_equivalence.behaviors[${familyIndex}]`;
    const familyInspection = inspectFamilyAxesGraph(family);
    if (familyInspection.failure) {
      addGraphFailure(
        findings,
        behaviorId,
        `${familyPath}.axes`,
        familyInspection.failure,
      );
      unsafeFamilyIndexes.add(familyIndex);
      continue;
    }
    const unsafeAtomIndexes = new Set();
    for (const [atomIndex, atom] of asArray(family?.atomic_invariants).entries()) {
      const atomInspection = inspectObjectGraph(atom, () => false);
      if (atomInspection.failure) {
        addGraphFailure(
          findings,
          behaviorId,
          `${familyPath}.atomic_invariants[${atomIndex}]`,
          atomInspection.failure,
        );
        unsafeAtomIndexes.add(atomIndex);
      }
    }
    unsafeAtomIndexesByFamily.set(familyIndex, unsafeAtomIndexes);
  }

  const allAtoms = [];
  const allProbeEntries = [];
  for (const [familyIndex, family] of behaviors.entries()) {
    if (unsafeFamilyIndexes.has(familyIndex)) continue;
    const unsafeAtomIndexes = unsafeAtomIndexesByFamily.get(familyIndex)
      ?? new Set();
    for (const [atomIndex, atom] of asArray(family?.atomic_invariants).entries()) {
      if (unsafeAtomIndexes.has(atomIndex)) continue;
      allAtoms.push(atom);
      for (const probe of asArray(atom?.probe_definitions)) {
        allProbeEntries.push({ atom, probe });
      }
    }
  }
  const atomIdCounts = new Map();
  const probeIdCounts = new Map();
  for (const atom of allAtoms) {
    atomIdCounts.set(atom?.invariant_id, (atomIdCounts.get(atom?.invariant_id) ?? 0) + 1);
  }
  for (const { probe } of allProbeEntries) {
    if (typeof probe?.probe_id === 'string') {
      probeIdCounts.set(
        probe?.probe_id,
        (probeIdCounts.get(probe?.probe_id) ?? 0) + 1,
      );
    }
  }
  const duplicateAtomIds = new Set(
    [...atomIdCounts].filter(([, count]) => count > 1).map(([id]) => id),
  );
  const duplicateProbeIds = new Set(
    [...probeIdCounts].filter(([, count]) => count > 1).map(([id]) => id),
  );
  if (duplicateAtomIds.size > 0) {
    addFinding(
      findings,
      null,
      'atomic_invariant_id_duplicate',
      'behavior_equivalence.behaviors.atomic_invariants',
      'atomic invariant identities must be globally unique',
    );
  }
  if (duplicateProbeIds.size > 0) {
    addFinding(
      findings,
      null,
      'atomic_probe_id_duplicate',
      'behavior_equivalence.behaviors.atomic_invariants.probe_definitions',
      'atomic probe identities must be globally unique',
    );
  }

  const families = [];
  const seenBehaviorIds = new Set();
  for (const [familyIndex, family] of behaviors.entries()) {
    const behaviorId = family?.behavior_id ?? null;
    const familyPath = `behavior_equivalence.behaviors[${familyIndex}]`;
    const atoms = asArray(family?.atomic_invariants);
    const probeCount = atoms.reduce(
      (total, atom) => total + asArray(atom?.probe_definitions).length,
      0,
    );
    const unsafeFamily = unsafeFamilyIndexes.has(familyIndex);
    if (!unsafeFamily) {
      if (family?.atomic_invariant_count !== atoms.length) {
        addFinding(
          findings,
          behaviorId,
          'atomic_family_count_mismatch',
          `${familyPath}.atomic_invariant_count`,
          'family atomic_invariant_count must equal its invariant array length',
        );
      }
      if (family?.probe_definition_count !== probeCount) {
        addFinding(
          findings,
          behaviorId,
          'atomic_probe_count_mismatch',
          `${familyPath}.probe_definition_count`,
          'family probe_definition_count must equal its derived probe count',
        );
      }
    }

    const canonicalFamily = Object.hasOwn(FAMILY_CANONICAL_AXES, behaviorId);
    const duplicateFamily = seenBehaviorIds.has(behaviorId);
    seenBehaviorIds.add(behaviorId);
    const unsafeAtomIndexes = unsafeAtomIndexesByFamily.get(familyIndex)
      ?? new Set();
    if (canonicalFamily && !duplicateFamily && !unsafeFamily) {
      if (unsafeAtomIndexes.size === 0) {
        validateAtomIdentities(
          family,
          atoms,
          findings,
          duplicateAtomIds,
          duplicateProbeIds,
          familyPath,
        );
        validateAxes(family, atoms, findings, behaviorId, `${familyPath}.axes`);
      }
      for (const [atomIndex, atom] of atoms.entries()) {
        if (unsafeAtomIndexes.has(atomIndex)) continue;
        const atomPath = `${familyPath}.atomic_invariants[${atomIndex}]`;
        validateClassification(atom, findings, behaviorId, atomPath);
        validateOwner(atom, findings, behaviorId, atomPath);
        validateProbeOutcomeContract(atom, findings, behaviorId, atomPath);
        if (atom?.classification !== 'retired') {
          validateProviderMatrix(atom, findings, behaviorId, atomPath);
          validateScenarioRequirements(atom, findings, behaviorId, atomPath);
          validateRecoveryBinding(atom, findings, behaviorId, atomPath);
        }
        validateReceiptMaterial(atom, findings, behaviorId, atomPath);
      }
    }
    families.push({
      behavior_id: behaviorId,
      priority: family?.priority ?? null,
      steps: asArray(family?.steps),
      dimensions: asArray(family?.dimensions),
      atoms: atoms.map(projectAtom),
    });
  }

  return {
    schema_version: schemaVersion,
    schema_valid: findings.length === 0,
    atomic_contract_present: true,
    atomic_cutover_ready: false,
    metrics,
    families,
    findings,
  };
}

export function validateAtomicContract(section) {
  try {
    return validateAtomicContractImpl(section);
  } catch {
    const findings = [];
    addGraphFailure(
      findings,
      null,
      'behavior_equivalence',
      'invalid',
    );
    return invalidAtomicResult(null, deriveMetrics([]), findings);
  }
}
