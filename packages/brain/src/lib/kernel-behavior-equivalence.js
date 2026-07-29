import {
  BEHAVIOR_DIMENSIONS,
  GOLDEN_PATH_STEPS,
  PROOF_PROVIDERS,
  PROOF_SCENARIOS,
} from './kernel-equivalence-axes.js';
import {
  compileAtomicRequirementSummary,
  compileDrillPlan,
} from './kernel-equivalence-drills.js';
import {
  createTrustedReceiptResolver,
} from './kernel-equivalence-receipt-resolver.js';
import { validateAtomicContract } from './kernel-equivalence-atomic-contract.js';

/**
 * Pure validator/projector for the Kernel P0/P1 equivalence section embedded in
 * the root regression-contract.yaml.
 *
 * This module never queries or writes PostgreSQL. Its journey output is only a
 * proposed projection into the existing journey_step_links cell vocabulary.
 */

export {
  BEHAVIOR_DIMENSIONS,
  GOLDEN_PATH_STEPS,
  PROOF_PROVIDERS,
  PROOF_SCENARIOS,
};

const CLAIMED_STATUSES = new Set(['proven', 'gap', 'intentional_replacement']);
const DENIAL_RESULTS = new Set(['blocked', 'denied', 'failed', 'rejected']);
const SHA_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const PSEUDO_PROOF = [
  /(?:^|[;&|]\s*)(?:grep|rg)\b/i,
  /(?:^|[;&|]\s*)test\s+-[ef]\b/i,
  /(?:^|\s)(?:README(?:\.md)?|docs\/)/i,
  /(?:^|[/_-])smoke(?:[/_.-]|$)/i,
];
const LIVE_PROOF_CELL = /^[A-Z0-9-]+::(?:claude|codex|grok)::(?:normal|violation|recovery)$/;
const LIVE_GRANT_REF =
  /^kernel-equivalence-grant:[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validDate(value) {
  if (!nonEmpty(value)) return null;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) ? epoch : null;
}

function addFinding(findings, behaviorId, code, path, message) {
  findings.push({
    severity: 'error',
    behavior_id: behaviorId ?? null,
    code,
    path,
    message,
  });
}

function classifyProofCommand(command, expectedCellId) {
  if (!nonEmpty(command)) return 'non_live';
  if (PSEUDO_PROOF.some((pattern) => pattern.test(command))) return 'pseudo';
  const tokens = command.trim().split(/\s+/);
  if (
    tokens.length !== 7
    || tokens[0] !== 'node'
    || tokens[1] !== 'scripts/ci/run-kernel-equivalence-drill.mjs'
    || tokens[2] !== '--execute'
    || tokens[3] !== '--cell'
    || !LIVE_PROOF_CELL.test(tokens[4])
    || tokens[4] !== expectedCellId
    || tokens[5] !== '--grant-ref'
    || !LIVE_GRANT_REF.test(tokens[6])
  ) {
    return 'non_live';
  }
  return 'live';
}

function validateCatalog(section, findings) {
  if (!nonEmpty(section?.schema_version)) {
    addFinding(
      findings,
      null,
      'schema_version_missing',
      'behavior_equivalence.schema_version',
      'behavior equivalence schema_version is required',
    );
  }
  if (!nonEmpty(section?.contract_version)) {
    addFinding(
      findings,
      null,
      'equivalence_contract_version_missing',
      'behavior_equivalence.contract_version',
      'behavior equivalence contract_version is required',
    );
  }
  if (!nonEmpty(section?.journey?.key)) {
    addFinding(
      findings,
      null,
      'journey_key_missing',
      'behavior_equivalence.journey.key',
      'journey key is required',
    );
  }
  const requiredBehaviorCount = section?.required_behavior_count;
  const behaviorCount = asArray(section?.behaviors).length;
  if (
    !Number.isInteger(requiredBehaviorCount)
    || requiredBehaviorCount < 1
    || behaviorCount !== requiredBehaviorCount
  ) {
    addFinding(
      findings,
      null,
      'behavior_inventory_count_mismatch',
      'behavior_equivalence.required_behavior_count',
      `expected ${requiredBehaviorCount ?? 'declared count'}, found ${behaviorCount} behaviors`,
    );
  }
  const stepIds = asArray(section?.journey?.steps).map((step) => step?.id);
  for (const step of GOLDEN_PATH_STEPS) {
    if (!stepIds.includes(step)) {
      addFinding(findings, null, 'golden_path_step_missing', `journey.steps.${step}`, `${step} is missing`);
    }
  }
  const dimensions = asArray(section?.dimensions);
  for (const dimension of BEHAVIOR_DIMENSIONS) {
    if (!dimensions.includes(dimension)) {
      addFinding(
        findings,
        null,
        'behavior_dimension_missing',
        `dimensions.${dimension}`,
        `${dimension} is missing`,
      );
    }
  }
}

function validateBehaviorAxes(behavior, behaviorFindings, goldenPathIds) {
  const id = behavior.behavior_id;
  if (!nonEmpty(id)) addFinding(behaviorFindings, id, 'behavior_id_missing', 'behavior_id', 'behavior_id is required');
  if (!['P0', 'P1'].includes(behavior.priority)) {
    addFinding(behaviorFindings, id, 'priority_invalid', 'priority', 'priority must be P0 or P1');
  }
  if (!nonEmpty(behavior.owner)) addFinding(behaviorFindings, id, 'owner_missing', 'owner', 'owner is required');
  if (!nonEmpty(behavior.contract_version)) {
    addFinding(behaviorFindings, id, 'contract_version_missing', 'contract_version', 'contract_version is required');
  }
  if (!CLAIMED_STATUSES.has(behavior.status)) {
    addFinding(behaviorFindings, id, 'status_invalid', 'status', 'status is not supported');
  }
  if (!nonEmpty(behavior.legacy_behavior) || asArray(behavior.legacy_evidence).length === 0) {
    addFinding(
      behaviorFindings,
      id,
      'legacy_evidence_missing',
      'legacy_evidence',
      'legacy behavior and evidence are required',
    );
  }
  if (asArray(behavior.unified_constructs).length === 0) {
    addFinding(
      behaviorFindings,
      id,
      'unified_construct_missing',
      'unified_constructs',
      'at least one unified construct is required',
    );
  }
  const steps = asArray(behavior.steps);
  if (steps.length === 0 || steps.some((step) => !GOLDEN_PATH_STEPS.includes(step))) {
    addFinding(behaviorFindings, id, 'behavior_step_invalid', 'steps', 'steps must reference S0-S12');
  }
  const dimensions = asArray(behavior.dimensions);
  if (
    dimensions.length === 0
    || dimensions.some((dimension) => !BEHAVIOR_DIMENSIONS.includes(dimension))
  ) {
    addFinding(
      behaviorFindings,
      id,
      'behavior_dimension_invalid',
      'dimensions',
      'dimensions must reference the canonical eleven dimensions',
    );
  }
  if (!nonEmpty(behavior.assertion_id) || !goldenPathIds.has(behavior.assertion_id)) {
    addFinding(
      behaviorFindings,
      id,
      'assertion_reference_invalid',
      'assertion_id',
      'assertion_id must reference root golden_paths',
    );
  }
  if (!nonEmpty(behavior.failure_semantics)) {
    addFinding(
      behaviorFindings,
      id,
      'failure_semantics_missing',
      'failure_semantics',
      'failure semantics are required',
    );
  }
}

function validateProofIdentity(behavior, behaviorFindings, now) {
  const id = behavior.behavior_id;
  const proofIdentity = asObject(behavior.proof_identity);
  if (!SHA_PATTERN.test(proofIdentity.artifact_sha ?? '')) {
    addFinding(
      behaviorFindings,
      id,
      'artifact_sha_invalid',
      'proof_identity.artifact_sha',
      'exact 40/64 lowercase hex artifact SHA is required',
    );
  }
  if (!nonEmpty(proofIdentity.version)) {
    addFinding(
      behaviorFindings,
      id,
      'proof_version_missing',
      'proof_identity.version',
      'proof version is required',
    );
  }
  if (!nonEmpty(proofIdentity.effect_receipt_id)) {
    addFinding(
      behaviorFindings,
      id,
      'effect_receipt_missing',
      'proof_identity.effect_receipt_id',
      'effect receipt identity is required',
    );
  }

  const freshness = asObject(behavior.freshness);
  const verifiedAt = validDate(freshness.verified_at);
  const expiresAt = validDate(freshness.expires_at);
  if (verifiedAt == null) {
    addFinding(
      behaviorFindings,
      id,
      'verified_at_missing',
      'freshness.verified_at',
      'verified_at is required',
    );
  }
  if (expiresAt == null) {
    addFinding(
      behaviorFindings,
      id,
      'expires_at_missing',
      'freshness.expires_at',
      'expires_at is required',
    );
  }
  if (verifiedAt != null && expiresAt != null && expiresAt <= verifiedAt) {
    addFinding(
      behaviorFindings,
      id,
      'freshness_window_invalid',
      'freshness',
      'expires_at must be later than verified_at',
    );
  }
  if (expiresAt != null && expiresAt <= now) {
    addFinding(
      behaviorFindings,
      id,
      'proof_stale',
      'freshness.expires_at',
      'proof is past its freshness deadline',
    );
  }
}

function validateProofMatrix(
  behavior,
  behaviorFindings,
  receiptResolver,
  verificationMetrics,
) {
  const id = behavior.behavior_id;
  const matrix = asObject(behavior.proof_matrix);
  for (const provider of PROOF_PROVIDERS) {
    const providerProof = asObject(matrix[provider]);
    for (const scenario of PROOF_SCENARIOS) {
      const path = `proof_matrix.${provider}.${scenario}`;
      const proof = asObject(providerProof[scenario]);
      if (Object.keys(proof).length === 0) {
        addFinding(
          behaviorFindings,
          id,
          'provider_scenario_missing',
          path,
          `${provider}/${scenario} proof is required`,
        );
        continue;
      }
      const expectedCellId = `${id}::${provider}::${scenario}`;
      const commandClassification = classifyProofCommand(
        proof.test_command,
        expectedCellId,
      );
      if (commandClassification === 'pseudo') {
        addFinding(
          behaviorFindings,
          id,
          'pseudo_proof_command',
          `${path}.test_command`,
          'proof command must execute a behavioral test, not docs/static grep/smoke-only checks',
        );
      } else if (commandClassification !== 'live') {
        addFinding(
          behaviorFindings,
          id,
          'non_live_proof_command',
          `${path}.test_command`,
          'proof command must be the formal single-cell live-effect drill runner',
        );
      }
      if (!nonEmpty(proof.expected_result) || !nonEmpty(proof.observed_result)) {
        addFinding(
          behaviorFindings,
          id,
          'proof_result_missing',
          path,
          'expected and observed results are required',
        );
      }
      if (asArray(proof.evidence_refs).length === 0) {
        addFinding(
          behaviorFindings,
          id,
          'proof_evidence_ref_missing',
          `${path}.evidence_refs`,
          'at least one evidence ref is required',
        );
      }
      if (!nonEmpty(proof.effect_receipt_id)) {
        addFinding(
          behaviorFindings,
          id,
          'proof_effect_receipt_missing',
          `${path}.effect_receipt_id`,
          'provider/scenario effect receipt identity is required',
        );
      }
      if (scenario === 'violation' && !DENIAL_RESULTS.has(proof.observed_result)) {
        addFinding(
          behaviorFindings,
          id,
          'violation_not_proven_to_fire',
          `${path}.observed_result`,
          'violation proof must observe blocked/denied/failed/rejected',
        );
      }
      const receiptReference = proof.receipt_bundle_ref;
      if (
        !nonEmpty(receiptReference)
        || !asArray(proof.evidence_refs).includes(receiptReference)
        || typeof receiptResolver !== 'function'
      ) {
        addFinding(
          behaviorFindings,
          id,
          typeof receiptResolver === 'function'
            ? 'trusted_receipt_bundle_required'
            : 'trusted_receipt_reader_required',
          `${path}.receipt_bundle_ref`,
          'a content-addressed bundle and trusted resolver are required',
        );
        continue;
      }

      const drill = asObject(behavior.drill);
      const expected = {
        cell: {
          cell_id: expectedCellId,
          behavior_id: id,
          provider,
          scenario,
          seam_id: drill.seam_id,
          adapter_id: drill.adapter_id,
          effect_key_id: drill.effect_key_id,
          isolation: structuredClone(asObject(drill.isolation)),
          expected: {
            expected_outcome:
              drill.scenarios?.[scenario]?.expected_outcome,
            effect_code: drill.scenarios?.[scenario]?.effect_code,
            ...(scenario === 'recovery'
              ? {
                predecessor_expected: {
                  expected_outcome:
                    drill.scenarios?.violation?.expected_outcome,
                  effect_code:
                    drill.scenarios?.violation?.effect_code,
                },
              }
              : {}),
          },
        },
        run_id: proof.run_id,
        attempt_id: proof.attempt_id,
        artifact_sha: behavior.proof_identity?.artifact_sha,
        brain_version: behavior.proof_identity?.version,
        engine_version: proof.engine_version,
        grant_id: proof.grant_id,
        nonce: proof.nonce,
        resource_id: proof.resource_id,
        resource_ref: proof.resource_ref,
        resource_prefix: drill.isolation?.resource_prefix
          ?.replaceAll('{run_id}', proof.run_id)
          .replaceAll('{attempt_id}', proof.attempt_id),
      };
      try {
        const verified = receiptResolver(receiptReference, expected);
        const finalReceipt = asArray(verified?.effect_receipts).at(-1);
        const expectedOutcome = drill.scenarios?.[scenario]?.expected_outcome;
        if (
          !asArray(verified?.receipt_ids).includes(proof.effect_receipt_id)
          || finalReceipt?.receipt_id !== proof.effect_receipt_id
          || finalReceipt?.observed_outcome !== expectedOutcome
          || finalReceipt?.effect_code !== drill.scenarios?.[scenario]?.effect_code
        ) {
          throw new Error('trusted receipt outcome mismatch');
        }
        verificationMetrics.verifiedProofCellCount += 1;
      } catch (error) {
        addFinding(
          behaviorFindings,
          id,
          'trusted_receipt_bundle_invalid',
          `${path}.receipt_bundle_ref`,
          `trusted receipt verification failed: ${error?.code ?? 'invalid_bundle'}`,
        );
      }
    }
  }
}

function validateGap(behavior, behaviorFindings) {
  const gap = asObject(behavior.gap);
  for (const field of ['reason', 'owner', 'closure_plan']) {
    if (!nonEmpty(gap[field])) {
      addFinding(
        behaviorFindings,
        behavior.behavior_id,
        `gap_${field}_missing`,
        `gap.${field}`,
        `gap ${field} is required`,
      );
    }
  }
}

function validateReplacement(behavior, behaviorFindings) {
  const replacement = asObject(behavior.replacement);
  for (const field of ['legacy_construct', 'unified_construct', 'rationale']) {
    if (!nonEmpty(replacement[field])) {
      addFinding(
        behaviorFindings,
        behavior.behavior_id,
        `replacement_${field === 'rationale' ? 'rationale' : field}_missing`,
        `replacement.${field}`,
        `replacement ${field} is required`,
      );
    }
  }
}

function validateSupersession(behaviors, findings) {
  const ids = new Set(behaviors.map((behavior) => behavior.behavior_id).filter(nonEmpty));
  const next = new Map();
  for (const behavior of behaviors) {
    if (!nonEmpty(behavior.superseded_by)) continue;
    if (!ids.has(behavior.superseded_by)) {
      addFinding(
        findings,
        behavior.behavior_id,
        'supersession_target_missing',
        'superseded_by',
        `supersession target ${behavior.superseded_by} does not exist`,
      );
      continue;
    }
    next.set(behavior.behavior_id, behavior.superseded_by);
  }

  const globallyVisited = new Set();
  for (const start of next.keys()) {
    if (globallyVisited.has(start)) continue;
    const localPath = [];
    const localIndex = new Map();
    let current = start;
    while (next.has(current)) {
      if (localIndex.has(current)) {
        const cycle = localPath.slice(localIndex.get(current)).concat(current);
        for (const behaviorId of new Set(cycle.slice(0, -1))) {
          addFinding(
            findings,
            behaviorId,
            'supersession_cycle',
            'superseded_by',
            `supersession cycle: ${cycle.join(' -> ')}`,
          );
        }
        break;
      }
      if (globallyVisited.has(current)) break;
      localIndex.set(current, localPath.length);
      localPath.push(current);
      current = next.get(current);
    }
    for (const id of localPath) globallyVisited.add(id);
  }
}

/**
 * Aggregate only verifier-produced atom statuses. This function deliberately
 * does not accept a contract and never interprets claimed proof material.
 */
export function deriveFamilyEffectiveStatus(verifiedAtomStatuses) {
  const statuses = asArray(verifiedAtomStatuses);
  if (statuses.length === 0) return 'gap';

  const retired = statuses.filter(
    (status) => status?.classification === 'retired',
  );
  if (retired.some((status) => (
    status?.effective_status !== 'retired'
    || status?.retired_absence_current !== true
  ))) {
    return 'gap';
  }

  const proofRequired = statuses.filter(
    (status) => status?.classification !== 'retired',
  );
  if (
    proofRequired.length === 0
    || proofRequired.some((status) => status?.effective_status !== 'proven')
  ) {
    return proofRequired.length === 0 && retired.length > 0
      ? 'proven'
      : 'gap';
  }
  if (proofRequired.every(
    (status) => status.classification === 'intentional_replacement',
  )) {
    return 'intentional_replacement';
  }
  return 'proven';
}

function validateBehaviorEquivalenceImpl(
  contract,
  {
    now = Date.now(),
    readBundle = null,
  } = {},
) {
  const findings = [];
  const verificationMetrics = {
    verifiedProofCellCount: 0,
  };
  const section = contract?.behavior_equivalence;
  const atomic = validateAtomicContract(section);
  if (!section || typeof section !== 'object') {
    addFinding(
      findings,
      null,
      'behavior_equivalence_missing',
      'behavior_equivalence',
      'root regression contract must define behavior_equivalence',
    );
    return {
      valid: false,
      schema_valid: false,
      proof_complete: false,
      atomic_cutover_ready: false,
      atomic_metrics: atomic.metrics,
      legacy_verified_family_receipt_count: 0,
      atomic_proven_family_cell_count: 0,
      verified_proof_cell_count: 0,
      contract_version: null,
      findings,
      behaviors: [],
    };
  }
  const unsafeAtomicInput = (
    section.schema_version === '1.1.0'
    && asArray(atomic.findings).some((finding) => [
      'atomic_contract_input_budget_exceeded',
      'atomic_contract_input_invalid',
    ].includes(finding.code))
  );
  if (unsafeAtomicInput) {
    return {
      valid: false,
      schema_valid: false,
      proof_complete: false,
      atomic_cutover_ready: false,
      atomic_metrics: atomic.metrics,
      legacy_verified_family_receipt_count: 0,
      atomic_proven_family_cell_count: 0,
      verified_proof_cell_count: 0,
      schema_version: atomic.schema_version ?? null,
      contract_version: null,
      journey: null,
      dimensions: [],
      findings: asArray(atomic.findings),
      behaviors: [],
    };
  }

  validateCatalog(section, findings);
  let manifestValid = true;
  try {
    compileDrillPlan(contract, { now });
  } catch (error) {
    manifestValid = false;
    addFinding(
      findings,
      null,
      error?.code ?? 'drill_manifest_invalid',
      'behavior_equivalence.behaviors',
      `canonical drill manifest invalid: ${error?.code ?? 'unknown'}`,
    );
  }
  let receiptResolver = null;
  const hasBundleReferences = asArray(section.behaviors).some((behavior) => (
    PROOF_PROVIDERS.some((provider) => (
      PROOF_SCENARIOS.some((scenario) => (
        nonEmpty(behavior?.proof_matrix?.[provider]?.[scenario]?.receipt_bundle_ref)
      ))
    ))
  ));
  if (typeof readBundle === 'function' && hasBundleReferences) {
    try {
      receiptResolver = createTrustedReceiptResolver({
        readBundle,
        trustRegistry: section.drill_trust_registry,
        bundleChain: section.drill_bundle_chain,
        now,
      });
    } catch (error) {
      addFinding(
        findings,
        null,
        error?.code ?? 'trusted_receipt_reader_invalid',
        'behavior_equivalence.drill_trust_registry',
        'trusted receipt reader could not be initialized',
      );
    }
  }
  const goldenPathIds = new Set(asArray(contract.golden_paths).map((item) => item?.id));
  const sourceBehaviors = asArray(section.behaviors);
  const normalizedBehaviors = sourceBehaviors.map((source) => {
    const behavior = structuredClone(source);
    const behaviorFindings = [];
    validateBehaviorAxes(behavior, behaviorFindings, goldenPathIds);

    if (behavior.status === 'gap') {
      validateGap(behavior, behaviorFindings);
    } else {
      validateProofIdentity(behavior, behaviorFindings, now);
      validateProofMatrix(
        behavior,
        behaviorFindings,
        receiptResolver,
        verificationMetrics,
      );
      if (behavior.status === 'intentional_replacement') {
        validateReplacement(behavior, behaviorFindings);
      }
    }

    findings.push(...behaviorFindings);
    return {
      ...behavior,
      claimed_status: behavior.status ?? null,
      effective_status:
        behavior.status === 'gap'
        || behaviorFindings.length > 0
        || !manifestValid
        ? 'gap'
        : behavior.status,
      findings: behaviorFindings,
    };
  });
  const supersessionFindingStart = findings.length;
  validateSupersession(normalizedBehaviors, findings);
  const supersessionFindings = findings.slice(supersessionFindingStart);
  for (const behavior of normalizedBehaviors) {
    const behaviorSupersessionFindings = supersessionFindings.filter(
      (finding) => finding.behavior_id === behavior.behavior_id,
    );
    if (behaviorSupersessionFindings.length > 0) {
      behavior.findings.push(...behaviorSupersessionFindings);
      behavior.effective_status = 'gap';
    }
  }

  const legacyFindings = [...findings];
  const atomicFamilyById = new Map(
    asArray(atomic.families).map((family) => [family.behavior_id, family]),
  );
  const aggregatedBehaviors = normalizedBehaviors.map((behavior) => {
    if (section.schema_version !== '1.1.0') return behavior;
    const atomicFamily = atomicFamilyById.get(behavior.behavior_id);
    const atoms = asArray(atomicFamily?.atoms).map((atom) => ({
      ...atom,
      retired_absence_current: false,
    }));
    return {
      ...behavior,
      atoms,
      retired_absence_complete: false,
      effective_status: deriveFamilyEffectiveStatus(atoms),
    };
  });
  const combinedFindings = [...legacyFindings, ...asArray(atomic.findings)];
  const schemaValid = legacyFindings.length === 0 && atomic.schema_valid === true;
  const proofComplete = (
    section.schema_version === '1.1.0'
    && schemaValid
    && atomic.atomic_cutover_ready === true
    && aggregatedBehaviors.every(
      (behavior) => behavior.effective_status !== 'gap',
    )
  );

  return {
    valid: schemaValid,
    schema_version: section.schema_version ?? null,
    contract_version: section.contract_version ?? null,
    journey: section.journey ?? null,
    dimensions: asArray(section.dimensions),
    verified_proof_cell_count: verificationMetrics.verifiedProofCellCount,
    findings: combinedFindings,
    behaviors: aggregatedBehaviors,
    schema_valid: schemaValid,
    proof_complete: proofComplete,
    atomic_cutover_ready: atomic.atomic_cutover_ready === true,
    atomic_metrics: atomic.metrics,
    legacy_verified_family_receipt_count:
      verificationMetrics.verifiedProofCellCount,
    atomic_proven_family_cell_count: 0,
  };
}

export function validateBehaviorEquivalence(contract, options = {}) {
  try {
    return validateBehaviorEquivalenceImpl(contract, options);
  } catch {
    const findings = [];
    addFinding(
      findings,
      null,
      'behavior_equivalence_input_invalid',
      'behavior_equivalence',
      'behavior equivalence input could not be safely inspected',
    );
    return {
      valid: false,
      schema_valid: false,
      proof_complete: false,
      atomic_cutover_ready: false,
      atomic_metrics: validateAtomicContract(null).metrics,
      legacy_verified_family_receipt_count: 0,
      atomic_proven_family_cell_count: 0,
      verified_proof_cell_count: 0,
      schema_version: null,
      contract_version: null,
      journey: null,
      dimensions: [],
      findings,
      behaviors: [],
    };
  }
}

export function projectJourneyCells(validation) {
  const atomicBehaviors = asArray(validation?.behaviors);
  if (validation?.schema_version === '1.1.0') {
    const statusRank = {
      gray: 0,
      green: 1,
      pending: 2,
      red: 3,
    };
    return atomicBehaviors.flatMap((behavior) => {
      const cells = new Map();
      const atoms = asArray(behavior.atoms);
      if (atoms.length === 0) {
        return asArray(behavior.steps).flatMap((step) => (
          asArray(behavior.dimensions).map((dimension) => ({
            journey_key: validation?.journey?.key ?? null,
            behavior_id: behavior.behavior_id ?? null,
            step,
            dimension,
            cell_kind: 'element',
            cell_key: dimension,
            cell_status: 'red',
            assertion_ref: behavior.assertion_id ?? null,
            reason: behavior.gap?.reason
              ?? behavior.findings?.map((finding) => finding.code).join(',')
              ?? 'atomic_status_unavailable',
            atom_ids: [],
            atom_statuses: [],
            atom_projections: [],
            atom_na_reasons: [],
            na_reason: null,
            write_database: false,
          }))
        ));
      }
      for (const atom of atoms) {
        const atomStatus = atom.effective_status ?? 'gap';
        let atomProjection = 'red';
        if (atomStatus === 'retired') {
          atomProjection = 'na';
        } else if (atomStatus === 'proven') {
          atomProjection = ['red', 'pending', 'green'].includes(atom.projection)
            ? atom.projection
            : 'green';
        }
        const projection = atomProjection === 'na'
          ? atom.retired_absence_current === true ? 'gray' : 'red'
          : atomProjection;
        const diagnosticReason = atomProjection === 'na'
          && atom.retired_absence_current !== true
          ? `retired absence proof is not verified: ${
            atom.na_reason ?? 'retired invariant is not applicable'
          }`
          : atom.reason
            ?? behavior.gap?.reason
            ?? behavior.findings?.map((finding) => finding.code).join(',')
            ?? null;
        for (const step of asArray(atom.steps)) {
          for (const dimension of asArray(atom.dimensions)) {
            const key = `${step}\u0000${dimension}`;
            let cell = cells.get(key);
            if (!cell) {
              cell = {
                journey_key: validation?.journey?.key ?? null,
                behavior_id: behavior.behavior_id ?? null,
                step,
                dimension,
                cell_kind: 'element',
                cell_key: dimension,
                cell_status: projection,
                assertion_ref: behavior.assertion_id ?? null,
                atom_tuples: new Map(),
                write_database: false,
              };
              cells.set(key, cell);
            }
            const tuple = {
              invariant_id: atom.invariant_id ?? null,
              status: atomStatus,
              projection: atomProjection,
              cell_status: projection,
              na_reason: atomProjection === 'na' && nonEmpty(atom.na_reason)
                ? atom.na_reason
                : null,
              reason: projection === 'red' && nonEmpty(diagnosticReason)
                ? diagnosticReason
                : null,
            };
            const tupleKey = tuple.invariant_id ?? '';
            const existing = cell.atom_tuples.get(tupleKey);
            const tupleIdentity = JSON.stringify(tuple);
            const existingIdentity = existing == null
              ? null
              : JSON.stringify(existing);
            if (
              existing == null
              || statusRank[tuple.cell_status] > statusRank[existing.cell_status]
              || (
                statusRank[tuple.cell_status] === statusRank[existing.cell_status]
                && tupleIdentity < existingIdentity
              )
            ) {
              cell.atom_tuples.set(tupleKey, tuple);
            }
          }
        }
      }
      return [...cells.values()].map((cell) => {
        const {
          atom_tuples: atomTuples,
          ...projected
        } = cell;
        const tuples = [...atomTuples.values()].sort((left, right) => (
          String(left.invariant_id) < String(right.invariant_id)
            ? -1
            : String(left.invariant_id) > String(right.invariant_id) ? 1 : 0
        ));
        const reasons = [...new Set(
          tuples.map((tuple) => tuple.reason).filter(nonEmpty),
        )].sort();
        const naReasons = [...new Set(
          tuples.map((tuple) => tuple.na_reason).filter(nonEmpty),
        )].sort();
        const cellStatus = tuples.reduce(
          (worst, tuple) => (
            statusRank[tuple.cell_status] > statusRank[worst]
              ? tuple.cell_status
              : worst
          ),
          'gray',
        );
        return {
          ...projected,
          cell_status: cellStatus,
          reason: reasons.join('; ') || null,
          atom_ids: tuples.map((tuple) => tuple.invariant_id),
          atom_statuses: tuples.map((tuple) => tuple.status),
          atom_projections: tuples.map((tuple) => tuple.projection),
          atom_na_reasons: tuples.map((tuple) => tuple.na_reason),
          na_reason: naReasons.join('; ') || null,
        };
      }).sort((left, right) => (
        GOLDEN_PATH_STEPS.indexOf(left.step)
          - GOLDEN_PATH_STEPS.indexOf(right.step)
        || BEHAVIOR_DIMENSIONS.indexOf(left.dimension)
          - BEHAVIOR_DIMENSIONS.indexOf(right.dimension)
      ));
    });
  }

  return asArray(validation?.behaviors).flatMap((behavior) => {
    const onlyStale = behavior.findings?.length > 0
      && behavior.findings.every((finding) => finding.code === 'proof_stale');
    const cellStatus = ['proven', 'intentional_replacement'].includes(behavior.effective_status)
      ? 'green'
      : onlyStale ? 'pending' : 'red';
    return asArray(behavior.steps).flatMap((step) => (
      asArray(behavior.dimensions).map((dimension) => ({
        journey_key: validation?.journey?.key ?? null,
        behavior_id: behavior.behavior_id ?? null,
        step,
        dimension,
        cell_kind: 'element',
        cell_key: dimension,
        cell_status: cellStatus,
        assertion_ref: behavior.assertion_id ?? null,
        reason: behavior.effective_status === 'gap'
          ? behavior.gap?.reason ?? behavior.findings?.map((finding) => finding.code).join(',')
          : null,
        write_database: false,
      }))
    ));
  });
}

export function buildEvidenceEnvelopes(validation) {
  return asArray(validation?.behaviors).flatMap((behavior) => (
    PROOF_PROVIDERS.flatMap((provider) => (
      PROOF_SCENARIOS.map((scenario) => {
        const proof = behavior.proof_matrix?.[provider]?.[scenario] ?? {};
        return {
          behavior_id: behavior.behavior_id ?? null,
          priority: behavior.priority ?? null,
          contract_version: behavior.contract_version ?? null,
          claimed_status: behavior.claimed_status ?? null,
          effective_status: behavior.effective_status ?? null,
          journey_steps: asArray(behavior.steps),
          dimensions: asArray(behavior.dimensions),
          legacy_behavior: behavior.legacy_behavior ?? null,
          legacy_evidence: asArray(behavior.legacy_evidence),
          kernel_enforcers: asArray(behavior.unified_constructs),
          provider,
          scenario,
          test_command: proof.test_command ?? null,
          expected_result: proof.expected_result ?? null,
          observed_result: proof.observed_result ?? null,
          artifact_sha: behavior.proof_identity?.artifact_sha ?? null,
          artifact_version: behavior.proof_identity?.version ?? null,
          verified_at: behavior.freshness?.verified_at ?? null,
          expires_at: behavior.freshness?.expires_at ?? null,
          effect_receipt_id: proof.effect_receipt_id ?? null,
          evidence_refs: asArray(proof.evidence_refs),
          assertion_id: behavior.assertion_id ?? null,
        };
      })
    ))
  ));
}

function countBy(items, key, knownValues) {
  const counts = Object.fromEntries(knownValues.map((value) => [value, 0]));
  for (const item of items) {
    const value = item?.[key];
    if (Object.hasOwn(counts, value)) counts[value] += 1;
  }
  return counts;
}

const MAX_REPORT_FAMILIES = 11;
const MAX_REPORT_ATOMS = 43;
const MAX_REPORT_PROBES = 446;
const MAX_REPORT_STEPS = 13;
const MAX_REPORT_DIMENSIONS = 11;
const MAX_REPORT_METADATA_ITEMS = 64;
const MAX_REPORT_FAMILY_CELLS =
  MAX_REPORT_FAMILIES * PROOF_PROVIDERS.length * PROOF_SCENARIOS.length;
const MAX_REPORT_PROVIDER_CELLS =
  PROOF_PROVIDERS.length * PROOF_SCENARIOS.length;
const ATOMIC_CLASSIFICATIONS = [
  'active_required',
  'drifted_required_gap',
  'intentional_replacement',
  'retired',
];

function canonicalCompare(left, right) {
  const leftValue = String(left ?? '');
  const rightValue = String(right ?? '');
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function canonicalStrings(values, maximum = MAX_REPORT_PROBES) {
  return [...new Set(
    asArray(values)
      .slice(0, maximum)
      .filter(nonEmpty),
  )].sort(canonicalCompare);
}

function reportMetric(value, maximum) {
  return Number.isInteger(value) && value >= 0
    ? Math.min(value, maximum)
    : 0;
}

function boundProofMatrix(matrix) {
  return Object.fromEntries(PROOF_PROVIDERS.map((provider) => [
    provider,
    Object.fromEntries(PROOF_SCENARIOS.map((scenario) => {
      const proof = asObject(matrix?.[provider]?.[scenario]);
      return [scenario, {
        test_command: proof.test_command ?? null,
        expected_result: proof.expected_result ?? null,
        observed_result: proof.observed_result ?? null,
        effect_receipt_id: proof.effect_receipt_id ?? null,
        evidence_refs: asArray(proof.evidence_refs)
          .slice(0, MAX_REPORT_METADATA_ITEMS),
      }];
    })),
  ]));
}

function boundProjectedAtom(atom) {
  return {
    invariant_id: atom?.invariant_id ?? null,
    classification: atom?.classification ?? null,
    proof_status: atom?.proof_status ?? null,
    steps: asArray(atom?.steps).slice(0, MAX_REPORT_STEPS),
    dimensions: asArray(atom?.dimensions).slice(
      0,
      MAX_REPORT_DIMENSIONS,
    ),
    effective_status: atom?.effective_status ?? 'gap',
    projection: atom?.projection ?? 'red',
    na_reason: atom?.na_reason ?? null,
    retired_absence_current: atom?.retired_absence_current === true,
    retired_absence_probe_statuses: asArray(
      atom?.retired_absence_probe_statuses,
    ).slice(0, MAX_REPORT_PROBES),
  };
}

function boundReportBehavior(behavior) {
  return {
    behavior_id: behavior?.behavior_id ?? null,
    priority: behavior?.priority ?? null,
    owner: behavior?.owner ?? null,
    contract_version: behavior?.contract_version ?? null,
    claimed_status: behavior?.claimed_status ?? null,
    effective_status: behavior?.effective_status ?? 'gap',
    steps: asArray(behavior?.steps).slice(0, MAX_REPORT_STEPS),
    dimensions: asArray(behavior?.dimensions).slice(
      0,
      MAX_REPORT_DIMENSIONS,
    ),
    assertion_id: behavior?.assertion_id ?? null,
    legacy_behavior: behavior?.legacy_behavior ?? null,
    legacy_evidence: asArray(behavior?.legacy_evidence)
      .slice(0, MAX_REPORT_METADATA_ITEMS),
    unified_constructs: asArray(behavior?.unified_constructs)
      .slice(0, MAX_REPORT_METADATA_ITEMS),
    failure_semantics: behavior?.failure_semantics ?? null,
    partial_behavioral_evidence: asArray(
      behavior?.partial_behavioral_evidence,
    ).slice(0, MAX_REPORT_METADATA_ITEMS),
    proof_matrix: boundProofMatrix(behavior?.proof_matrix),
    proof_identity: {
      artifact_sha: behavior?.proof_identity?.artifact_sha ?? null,
      version: behavior?.proof_identity?.version ?? null,
    },
    freshness: {
      verified_at: behavior?.freshness?.verified_at ?? null,
      expires_at: behavior?.freshness?.expires_at ?? null,
    },
    gap: {
      reason: behavior?.gap?.reason ?? null,
      owner: behavior?.gap?.owner ?? null,
      closure_plan: behavior?.gap?.closure_plan ?? null,
    },
    findings: asArray(behavior?.findings)
      .slice(0, MAX_REPORT_METADATA_ITEMS)
      .map((finding) => ({
        code: finding?.code ?? null,
        message: finding?.message ?? null,
      })),
    atoms: asArray(behavior?.atoms)
      .slice(0, MAX_REPORT_ATOMS)
      .map(boundProjectedAtom),
    atomic_invariants: asArray(behavior?.atomic_invariants)
      .slice(0, MAX_REPORT_ATOMS),
  };
}

function projectRecoveryGaps(atom) {
  return asArray(atom?.scenario_plan?.recovery?.coverage_gaps)
    .slice(0, MAX_REPORT_PROBES)
    .map((gap) => ({
      gap_id: gap?.gap_id ?? null,
      affected_violation_probe_ids: canonicalStrings(
        gap?.affected_violation_probe_ids,
      ),
      affected_recovery_probe_ids: canonicalStrings(
        gap?.affected_recovery_probe_ids,
      ),
      appendix_predecessor_text: gap?.appendix_predecessor_text ?? null,
      reason: gap?.reason ?? null,
      owner: gap?.owner ?? null,
      closure_plan: gap?.closure_plan ?? null,
    }))
    .sort((left, right) => canonicalCompare(left.gap_id, right.gap_id));
}

function projectAtomicDetails(behaviors, atomicSchemaUsable) {
  if (!atomicSchemaUsable) return [];
  let remainingAtoms = MAX_REPORT_ATOMS;
  const details = [];
  for (const behavior of behaviors) {
    if (remainingAtoms === 0) break;
    const verifiedById = new Map(
      asArray(behavior?.atoms)
        .slice(0, remainingAtoms)
        .map((atom) => [atom?.invariant_id, atom]),
    );
    const sourceAtoms = asArray(behavior?.atomic_invariants)
      .slice(0, remainingAtoms);
    remainingAtoms -= sourceAtoms.length;
    for (const source of sourceAtoms) {
      const verified = verifiedById.get(source?.invariant_id) ?? {};
      const retiredAbsenceProbeStatuses = asArray(
        verified?.retired_absence_probe_statuses,
      )
        .slice(0, MAX_REPORT_PROBES)
        .map((status) => ({
          probe_id: status?.probe_id ?? null,
          status: 'unverified',
        }))
        .sort((left, right) => canonicalCompare(
          left.probe_id,
          right.probe_id,
        ));
      const recoveryMappingGaps = projectRecoveryGaps(source);
      details.push({
        behavior_id: behavior?.behavior_id ?? null,
        invariant_id: source?.invariant_id ?? null,
        classification: source?.classification ?? null,
        proof_status: source?.proof_status ?? null,
        effective_status: (
          source?.classification === 'retired'
          && verified?.effective_status === 'retired'
        ) ? 'retired' : 'gap',
        artifact_sha: null,
        receipt_v2_identity: null,
        verified_at: null,
        expires_at: null,
        replacement_forbidden_authority_status:
          source?.classification === 'intentional_replacement'
            ? 'unverified'
            : null,
        retired_absence_probe_statuses: retiredAbsenceProbeStatuses,
        recovery_mapping_gap_count: recoveryMappingGaps.length,
        recovery_mapping_gaps: recoveryMappingGaps,
      });
    }
  }
  return details.sort((left, right) => (
    canonicalCompare(left.behavior_id, right.behavior_id)
    || canonicalCompare(left.invariant_id, right.invariant_id)
  ));
}

function projectAtomicCellCoverage(behaviors, atomicSchemaUsable) {
  if (!atomicSchemaUsable) return [];
  const familyRequirements = behaviors
    .slice(0, MAX_REPORT_FAMILIES)
    .map((behavior) => {
      const scenarios = Object.fromEntries(PROOF_SCENARIOS.map(
        (scenario) => [scenario, {
          invariantIds: [],
          probeIds: [],
        }],
      ));
      const atoms = asArray(behavior?.atomic_invariants)
        .slice(0, MAX_REPORT_ATOMS);
      for (const atom of atoms) {
        if (
          atom?.classification === 'retired'
          || !nonEmpty(atom?.invariant_id)
        ) {
          continue;
        }
        for (const scenario of PROOF_SCENARIOS) {
          const requiredProbeIds = canonicalStrings(
            atom?.scenario_plan?.[scenario]?.required_probe_ids,
          );
          if (requiredProbeIds.length === 0) continue;
          scenarios[scenario].invariantIds.push(atom.invariant_id);
          scenarios[scenario].probeIds.push(...requiredProbeIds);
        }
      }
      return {
        behaviorId: behavior?.behavior_id ?? null,
        scenarios,
      };
    })
    .filter((family) => nonEmpty(family.behaviorId));

  return familyRequirements.flatMap((family) => (
    PROOF_PROVIDERS.flatMap((provider) => (
      PROOF_SCENARIOS.map((scenario) => {
        const expectedInvariantIds = canonicalStrings(
          family.scenarios[scenario].invariantIds,
          MAX_REPORT_ATOMS,
        );
        const expectedProbeIds = canonicalStrings(
          family.scenarios[scenario].probeIds,
        );
        return {
          cell_id: `${family.behaviorId}::${provider}::${scenario}`,
          expected_invariant_ids: expectedInvariantIds,
          configured_invariant_ids: [],
          live_proven_invariant_ids: [],
          missing_invariant_ids: [...expectedInvariantIds],
          expected_probe_ids: expectedProbeIds,
          configured_probe_ids: [],
          live_proven_probe_ids: [],
          missing_probe_ids: [...expectedProbeIds],
        };
      })
    ))
  )).sort((left, right) => canonicalCompare(left.cell_id, right.cell_id));
}

function buildEquivalenceReportImpl(
  validation,
  { evaluatedAt = null } = {},
) {
  const behaviors = asArray(validation?.behaviors)
    .slice(0, MAX_REPORT_FAMILIES)
    .map(boundReportBehavior);
  const validationFindings = asArray(validation?.findings)
    .slice(0, MAX_REPORT_METADATA_ITEMS);
  const schemaVersion = validation?.schema_version ?? null;
  const atomicReport = schemaVersion === '1.1.0';
  const validationValid = validation?.valid === true;
  const atomicMetrics = asObject(validation?.atomic_metrics);
  const atomicSchemaUsable = (
    schemaVersion === '1.1.0'
    && validationValid
    && validation?.schema_valid === true
    && behaviors.length === MAX_REPORT_FAMILIES
    && atomicMetrics.atomic_invariant_count === MAX_REPORT_ATOMS
    && atomicMetrics.proof_required_atomic_invariant_count === 42
    && atomicMetrics.probe_definition_count === MAX_REPORT_PROBES
    && atomicMetrics.proof_required_probe_definition_count === 442
  );
  const reportAtomicMetrics = atomicSchemaUsable ? atomicMetrics : {};
  const boundedValidation = {
    schema_version: schemaVersion,
    journey: validation?.journey ?? null,
    behaviors,
  };
  const envelopes = buildEvidenceEnvelopes(boundedValidation);
  const projectedCells = projectJourneyCells(boundedValidation);
  const atomicDetails = projectAtomicDetails(behaviors, atomicSchemaUsable);
  const cellAtomicCoverage = projectAtomicCellCoverage(
    behaviors,
    atomicSchemaUsable,
  );
  const atomicRequirements = compileAtomicRequirementSummary(validation);
  const classificationCounts = countBy(
    atomicDetails,
    'classification',
    ATOMIC_CLASSIFICATIONS,
  );
  const provenAtoms = atomicDetails.filter((atom) => (
    atom.classification !== 'retired'
    && atom.effective_status === 'proven'
    && nonEmpty(atom.artifact_sha)
    && atom.receipt_v2_identity != null
    && nonEmpty(atom.verified_at)
    && nonEmpty(atom.expires_at)
  )).length;
  const retiredAbsenceFresh = atomicDetails
    .filter((atom) => atom.classification === 'retired')
    .flatMap((atom) => atom.retired_absence_probe_statuses)
    .filter((status) => status.status === 'verified')
    .length;
  const proofRequiredProbeDefinitions = reportMetric(
    reportAtomicMetrics.proof_required_probe_definition_count,
    MAX_REPORT_PROBES,
  );
  const retiredAbsenceRequired = reportMetric(
    reportAtomicMetrics.retired_absence_probe_count,
    MAX_REPORT_PROBES,
  );
  const cellScenarioProbeObligations = cellAtomicCoverage.reduce(
    (total, cell) => total + cell.expected_probe_ids.length,
    0,
  );
  const requiredCells = behaviors.length * PROOF_PROVIDERS.length * PROOF_SCENARIOS.length;
  const receiptedCells = envelopes.filter((envelope) => nonEmpty(envelope.effect_receipt_id)).length;
  const provenToFireCommands = envelopes
    .filter((envelope) => (
      envelope.effective_status === 'proven'
      && envelope.scenario === 'violation'
      && nonEmpty(envelope.test_command)
      && DENIAL_RESULTS.has(envelope.observed_result)
      && nonEmpty(envelope.effect_receipt_id)
    ))
    .map((envelope) => ({
      behavior_id: envelope.behavior_id,
      provider: envelope.provider,
      scenario: envelope.scenario,
      test_command: envelope.test_command,
      observed_result: envelope.observed_result,
      effect_receipt_id: envelope.effect_receipt_id,
    }))
    .sort((left, right) => (
      `${left.behavior_id}:${left.provider}`.localeCompare(`${right.behavior_id}:${right.provider}`)
    ));

  return {
    report_version: schemaVersion === '1.1.0' ? '1.1.0' : '1.0.0',
    contract_version: validation?.contract_version ?? null,
    evaluated_at: evaluatedAt,
    valid: validationValid,
    ...(atomicReport ? {
      schema_valid: validationValid && validation?.schema_valid === true,
      proof_complete: false,
      atomic_cutover_ready: false,
    } : {}),
    summary: {
      total: behaviors.length,
      by_priority: countBy(behaviors, 'priority', ['P0', 'P1']),
      by_effective_status: countBy(
        behaviors,
        'effective_status',
        ['proven', 'gap', 'intentional_replacement'],
      ),
      findings: validationFindings.length,
    },
    axes: {
      steps: [...GOLDEN_PATH_STEPS],
      dimensions: [...BEHAVIOR_DIMENSIONS],
      providers: [...PROOF_PROVIDERS],
      scenarios: [...PROOF_SCENARIOS],
      possible_cells: GOLDEN_PATH_STEPS.length * BEHAVIOR_DIMENSIONS.length,
      grid: GOLDEN_PATH_STEPS.map((step) => ({
        step,
        cells: Object.fromEntries(BEHAVIOR_DIMENSIONS.map((dimension) => {
          const statuses = projectedCells
            .filter((cell) => cell.step === step && cell.dimension === dimension)
            .map((cell) => cell.cell_status);
          const status = statuses.includes('red')
            ? 'red'
            : statuses.includes('pending')
              ? 'pending'
              : statuses.includes('green')
                ? 'green'
                : 'unaccounted';
          return [dimension, status];
        })),
      })),
    },
    provider_matrix: {
      required_cells: requiredCells,
      receipted_cells: receiptedCells,
      missing_cells: requiredCells - receiptedCells,
      cells: PROOF_PROVIDERS.flatMap((provider) => (
        PROOF_SCENARIOS.map((scenario) => {
          const matching = envelopes.filter((envelope) => (
            envelope.provider === provider && envelope.scenario === scenario
          ));
          const receipted = matching.filter((envelope) => nonEmpty(envelope.effect_receipt_id)).length;
          return {
            provider,
            scenario,
            required: behaviors.length,
            receipted,
            missing: behaviors.length - receipted,
          };
        })
      )),
      ...(atomicReport ? {
        legacy_verified_family_receipts: reportMetric(
          validation?.legacy_verified_family_receipt_count,
          requiredCells,
        ),
        atomic_proven_family_cells: reportMetric(
          0,
          requiredCells,
        ),
      } : {}),
    },
    ...(atomicReport ? {
      atomic_summary: {
        classified: atomicRequirements.atom_count,
        proof_required: atomicRequirements.proof_required_atom_count,
        probe_definitions: atomicRequirements.probe_count,
        proof_required_probe_definitions: proofRequiredProbeDefinitions,
        proven: provenAtoms,
        gap: Math.max(
          0,
          atomicRequirements.proof_required_atom_count - provenAtoms,
        ),
        classification_counts: classificationCounts,
        retired_absence_fresh: retiredAbsenceFresh,
        retired_absence_required: retiredAbsenceRequired,
        atom_scenario_required:
          atomicRequirements.proof_required_atom_count
          * PROOF_PROVIDERS.length
          * PROOF_SCENARIOS.length,
        cell_scenario_probe_obligation_required:
          cellScenarioProbeObligations,
        provider_probe_required:
          atomicRequirements.provider_probe_assertion_count,
        provider_probe_proven: 0,
        probe_outcome_authority: {
          appendix_explicit: reportMetric(
            reportAtomicMetrics.probe_outcome_authority?.appendix_explicit,
            MAX_REPORT_PROBES,
          ),
          design_derived: reportMetric(
            reportAtomicMetrics.probe_outcome_authority?.design_derived,
            MAX_REPORT_PROBES,
          ),
          coverage_gap: reportMetric(
            reportAtomicMetrics.probe_outcome_authority?.coverage_gap,
            MAX_REPORT_PROBES,
          ),
        },
        recovery_mapping: {
          exact_binding_count: reportMetric(
            reportAtomicMetrics.recovery_mapping?.exact_binding_count,
            MAX_REPORT_PROBES,
          ),
          derived_binding_count: reportMetric(
            reportAtomicMetrics.recovery_mapping?.derived_binding_count,
            MAX_REPORT_PROBES,
          ),
          coverage_gap_count: reportMetric(
            reportAtomicMetrics.recovery_mapping?.coverage_gap_count,
            MAX_REPORT_PROBES,
          ),
        },
      },
      atomic_details: atomicDetails,
      cell_atomic_coverage: cellAtomicCoverage,
    } : {}),
    proven_to_fire_commands: provenToFireCommands,
    gaps: behaviors
      .filter((behavior) => behavior.effective_status === 'gap')
      .map((behavior) => ({
        behavior_id: behavior.behavior_id ?? null,
        priority: behavior.priority ?? null,
        claimed_status: behavior.claimed_status ?? null,
        reason: behavior.gap?.reason
          ?? asArray(behavior.findings).map((finding) => finding.message).join('; ')
          ?? null,
        owner: behavior.gap?.owner ?? behavior.owner ?? null,
        closure_plan: behavior.gap?.closure_plan ?? null,
        finding_codes: asArray(behavior.findings).map((finding) => finding.code),
      }))
    .sort((left, right) => canonicalCompare(
      left.behavior_id,
      right.behavior_id,
    )),
    behaviors: behaviors
      .map((behavior) => ({
        behavior_id: behavior.behavior_id ?? null,
        priority: behavior.priority ?? null,
        claimed_status: behavior.claimed_status ?? null,
        effective_status: behavior.effective_status ?? null,
        steps: asArray(behavior.steps),
        dimensions: asArray(behavior.dimensions),
        verified_at: behavior.freshness?.verified_at ?? null,
        expires_at: behavior.freshness?.expires_at ?? null,
        assertion_id: behavior.assertion_id ?? null,
        legacy_behavior: behavior.legacy_behavior ?? null,
        legacy_evidence: asArray(behavior.legacy_evidence),
        unified_constructs: asArray(behavior.unified_constructs),
        failure_semantics: behavior.failure_semantics ?? null,
        partial_behavioral_evidence: asArray(behavior.partial_behavioral_evidence),
      }))
      .sort((left, right) => canonicalCompare(
        left.behavior_id,
        right.behavior_id,
      )),
  };
}

export function buildEquivalenceReport(validation, options = {}) {
  try {
    return buildEquivalenceReportImpl(validation, options);
  } catch {
    return buildEquivalenceReportImpl(null, {
      evaluatedAt: null,
    });
  }
}

function markdownCell(value) {
  if (value == null || value === '') return '—';
  return String(value).replaceAll('|', '\\|').replace(/[\r\n]+/g, ' ');
}

function formatEquivalenceMarkdownImpl(report) {
  const atomicReport = (
    report?.report_version === '1.1.0'
    && Object.hasOwn(asObject(report), 'atomic_summary')
  );
  const summary = asObject(report?.summary);
  const matrix = asObject(report?.provider_matrix);
  const axes = asObject(report?.axes);
  const axisDimensions = asArray(axes.dimensions)
    .slice(0, MAX_REPORT_DIMENSIONS);
  const behaviors = asArray(report?.behaviors)
    .slice(0, MAX_REPORT_FAMILIES)
    .map((behavior) => ({
      behavior_id: behavior?.behavior_id ?? null,
      priority: behavior?.priority ?? null,
      claimed_status: behavior?.claimed_status ?? null,
      effective_status: behavior?.effective_status ?? null,
      steps: asArray(behavior?.steps).slice(0, MAX_REPORT_STEPS),
      dimensions: asArray(behavior?.dimensions).slice(
        0,
        MAX_REPORT_DIMENSIONS,
      ),
      legacy_behavior: behavior?.legacy_behavior ?? null,
      legacy_evidence: asArray(behavior?.legacy_evidence)
        .slice(0, MAX_REPORT_METADATA_ITEMS),
      unified_constructs: asArray(behavior?.unified_constructs)
        .slice(0, MAX_REPORT_METADATA_ITEMS),
      failure_semantics: behavior?.failure_semantics ?? null,
      verified_at: behavior?.verified_at ?? null,
      expires_at: behavior?.expires_at ?? null,
      partial_behavioral_evidence: asArray(
        behavior?.partial_behavioral_evidence,
      ).slice(0, MAX_REPORT_METADATA_ITEMS),
    }));
  const gaps = asArray(report?.gaps).slice(0, MAX_REPORT_FAMILIES);
  const fireCommands = asArray(report?.proven_to_fire_commands)
    .slice(0, MAX_REPORT_FAMILY_CELLS);
  const providerCells = asArray(matrix.cells)
    .slice(0, MAX_REPORT_PROVIDER_CELLS);
  const atomic = atomicReport ? asObject(report?.atomic_summary) : {};
  const classificationCounts = asObject(atomic.classification_counts);
  const atomicDetails = (atomicReport ? asArray(report?.atomic_details) : [])
    .slice(0, MAX_REPORT_ATOMS)
    .map((atom) => ({
      invariant_id: atom?.invariant_id ?? null,
      classification: atom?.classification ?? null,
      proof_status: atom?.proof_status ?? null,
      effective_status: atom?.effective_status ?? null,
      artifact_sha: atom?.artifact_sha ?? null,
      receipt_v2_identity: atom?.receipt_v2_identity ?? null,
      verified_at: atom?.verified_at ?? null,
      expires_at: atom?.expires_at ?? null,
      replacement_forbidden_authority_status:
        atom?.replacement_forbidden_authority_status ?? null,
      retired_absence_probe_statuses: asArray(
        atom?.retired_absence_probe_statuses,
      ).slice(0, MAX_REPORT_PROBES),
      recovery_mapping_gaps: asArray(atom?.recovery_mapping_gaps)
        .slice(0, MAX_REPORT_PROBES),
    }));
  const atomicCells = (atomicReport
    ? asArray(report?.cell_atomic_coverage)
    : [])
    .slice(0, MAX_REPORT_FAMILY_CELLS)
    .map((cell) => ({
      cell_id: cell?.cell_id ?? null,
      expected_invariant_ids: asArray(cell?.expected_invariant_ids)
        .slice(0, MAX_REPORT_ATOMS),
      configured_invariant_ids: asArray(cell?.configured_invariant_ids)
        .slice(0, MAX_REPORT_ATOMS),
      live_proven_invariant_ids: asArray(cell?.live_proven_invariant_ids)
        .slice(0, MAX_REPORT_ATOMS),
      missing_invariant_ids: asArray(cell?.missing_invariant_ids)
        .slice(0, MAX_REPORT_ATOMS),
      expected_probe_ids: asArray(cell?.expected_probe_ids)
        .slice(0, MAX_REPORT_PROBES),
      configured_probe_ids: asArray(cell?.configured_probe_ids)
        .slice(0, MAX_REPORT_PROBES),
      live_proven_probe_ids: asArray(cell?.live_proven_probe_ids)
        .slice(0, MAX_REPORT_PROBES),
      missing_probe_ids: asArray(cell?.missing_probe_ids)
        .slice(0, MAX_REPORT_PROBES),
    }));
  const grid = asArray(axes.grid).slice(0, MAX_REPORT_STEPS);
  const gridSymbol = {
    green: 'G',
    pending: 'P',
    red: 'R',
    unaccounted: '—',
  };
  const lines = [
    '# Kernel P0/P1 行为等价报告',
    '',
    `- 合同版本：\`${markdownCell(report?.contract_version)}\``,
    `- 评估时间：\`${markdownCell(report?.evaluated_at)}\``,
    `- 合同行为数：${summary.total ?? 0}（P0 ${summary.by_priority?.P0 ?? 0} / P1 ${summary.by_priority?.P1 ?? 0}）`,
    `- 有效状态：proven ${summary.by_effective_status?.proven ?? 0} / gap ${summary.by_effective_status?.gap ?? 0} / intentional_replacement ${summary.by_effective_status?.intentional_replacement ?? 0}`,
    `- Provider 场景证据：${matrix.receipted_cells ?? 0}/${matrix.required_cells ?? 0}，缺 ${matrix.missing_cells ?? 0}`,
    `- 轴：${asArray(axes.steps).length} 个步骤（S0–S12）× 11 项行为维度 = ${axes.possible_cells ?? 0} 个可能单元`,
    ...(atomicReport ? [
      `- Atomic inventory：${atomic.classified ?? 0}/${atomic.classified ?? 0} classified；${atomic.proof_required ?? 0} proof-required；classification ${classificationCounts.active_required ?? 0}/${classificationCounts.drifted_required_gap ?? 0}/${classificationCounts.intentional_replacement ?? 0}/${classificationCounts.retired ?? 0}`,
      `- Atomic probes：${atomic.probe_definitions ?? 0}/${atomic.proof_required_probe_definitions ?? 0} total/proof-required；cell-scenario obligations ${atomic.cell_scenario_probe_obligation_required ?? 0}`,
      `- Atomic proof：${atomic.proven ?? 0}/${atomic.atom_scenario_required ?? 0} atom-scenario；${atomic.provider_probe_proven ?? 0}/${atomic.provider_probe_required ?? 0} provider-probe；${atomic.retired_absence_fresh ?? 0}/${atomic.retired_absence_required ?? 0} retired absence；${matrix.atomic_proven_family_cells ?? 0}/${matrix.required_cells ?? 0} family cells`,
      `- Atomic family status：${gaps.length}/${summary.total ?? 0} family gaps`,
    ] : []),
    '',
    '> 缺口不是证明。只有绑定 exact SHA/version、未过期 freshness、effect receipt，且 Claude/Codex/Grok × normal/violation/recovery 全覆盖，才是 proven。',
    ...(atomicReport ? [
      '> v1 family receipt不是atomic proof；configured receipt ID、replacement evidence 与合同自报 proof_status 都不是 live effect proof。',
    ] : []),
    '',
    '## 行为清单',
    '',
    '| Behavior | Priority | Claimed | Effective | Steps | Dimensions |',
    '|---|---:|---|---|---|---|',
    ...behaviors.map((behavior) => (
      `| ${markdownCell(behavior.behavior_id)} | ${markdownCell(behavior.priority)} | ${markdownCell(behavior.claimed_status)} | ${markdownCell(behavior.effective_status)} | ${markdownCell(behavior.steps.join(', '))} | ${markdownCell(behavior.dimensions.join(', '))} |`
    )),
    '',
    '## S0–S12 × 11 要素投影',
    '',
    'R = 有真实缺口；P = 证据过期；G = 完整证明；— = 尚未映射。',
    '',
    `| Step | ${axisDimensions.join(' | ')} |`,
    `|---|${axisDimensions.map(() => '---').join('|')}|`,
    ...grid.map((row) => (
      `| ${markdownCell(row.step)} | ${axisDimensions.map((dimension) => gridSymbol[row.cells?.[dimension]] ?? '—').join(' | ')} |`
    )),
    '',
    '## Provider × 场景证据矩阵',
    '',
    '| Provider | Scenario | Receipted | Required | Missing |',
    '|---|---|---:|---:|---:|',
    ...providerCells.map((cell) => (
      `| ${markdownCell(cell.provider)} | ${markdownCell(cell.scenario)} | ${cell.receipted} | ${cell.required} | ${cell.missing} |`
    )),
    ...(atomicReport ? [
      '',
      '## Atomic family cell coverage',
      '',
      '| Cell | Expected atoms | Configured atoms | Live atoms | Missing atoms | Expected probes | Configured probes | Live probes | Missing probes |',
      '|---|---|---|---|---|---|---|---|---|',
      ...atomicCells.map((cell) => (
        `| ${markdownCell(cell.cell_id)} | ${markdownCell(cell.expected_invariant_ids.join(', '))} | ${markdownCell(cell.configured_invariant_ids.join(', '))} | ${markdownCell(cell.live_proven_invariant_ids.join(', '))} | ${markdownCell(cell.missing_invariant_ids.join(', '))} | ${markdownCell(cell.expected_probe_ids.join(', '))} | ${markdownCell(cell.configured_probe_ids.join(', '))} | ${markdownCell(cell.live_proven_probe_ids.join(', '))} | ${markdownCell(cell.missing_probe_ids.join(', '))} |`
      )),
      '',
      '## Atomic invariant detail',
      '',
      'artifact SHA、receipt v2 identity 与 freshness 只显示 verifier-owned live proof；replacement forbidden authority 和 retired absence 独立显示。',
      '',
      '| Invariant | Classification | Contract proof | Effective | artifact SHA | receipt v2 identity | freshness | replacement forbidden authority | retired absence | Recovery gaps |',
      '|---|---|---|---|---|---|---|---|---|---|',
      ...atomicDetails.map((atom) => (
        `| ${markdownCell(atom.invariant_id)} | ${markdownCell(atom.classification)} | ${markdownCell(atom.proof_status)} | ${markdownCell(atom.effective_status)} | ${markdownCell(atom.artifact_sha)} | ${markdownCell(atom.receipt_v2_identity)} | verified ${markdownCell(atom.verified_at)} / expires ${markdownCell(atom.expires_at)} | ${markdownCell(atom.replacement_forbidden_authority_status)} | ${markdownCell(atom.retired_absence_probe_statuses.map((status) => `${status.probe_id}:${status.status}`).join(', '))} | ${markdownCell(atom.recovery_mapping_gaps.map((gap) => gap.gap_id).join(', '))} |`
      )),
    ] : []),
    '',
    '## Legacy → Kernel unified construct 对照',
    '',
  ];

  for (const behavior of behaviors) {
    lines.push(
      `### ${markdownCell(behavior.behavior_id)}`,
      '',
      `- 旧行为：${markdownCell(behavior.legacy_behavior)}`,
      `- 旧证据：${behavior.legacy_evidence.length > 0 ? behavior.legacy_evidence.map((item) => `\`${markdownCell(item)}\``).join(', ') : '—'}`,
      `- Unified constructs：${behavior.unified_constructs.length > 0 ? behavior.unified_constructs.map(markdownCell).join('; ') : '—'}`,
      `- 失败语义：${markdownCell(behavior.failure_semantics)}`,
      `- Freshness：verified ${markdownCell(behavior.verified_at)} / expires ${markdownCell(behavior.expires_at)}`,
      `- 部分行为证据（不等于 proven）：${behavior.partial_behavioral_evidence.length > 0 ? behavior.partial_behavioral_evidence.map((item) => `\`${markdownCell(item)}\``).join(', ') : '—'}`,
      '',
    );
  }

  lines.push(
    '## Proven-to-fire 命令',
    '',
  );

  if (fireCommands.length === 0) {
    lines.push('没有命令达到完整 proven-to-fire 证据门槛。');
  } else {
    for (const proof of fireCommands) {
      lines.push(
        `- ${markdownCell(proof.behavior_id)} / ${markdownCell(proof.provider)}: \`${markdownCell(proof.test_command)}\` → ${markdownCell(proof.observed_result)}（${markdownCell(proof.effect_receipt_id)}）`,
      );
    }
  }

  lines.push('', '## 真实缺口', '');
  if (gaps.length === 0) {
    lines.push('无。');
  } else {
    for (const gap of gaps) {
      lines.push(
        `### ${markdownCell(gap.behavior_id)}（${markdownCell(gap.priority)}）`,
        '',
        `- 原因：${markdownCell(gap.reason)}`,
        `- Owner：${markdownCell(gap.owner)}`,
        `- 收口计划：${markdownCell(gap.closure_plan)}`,
        '',
      );
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

export function formatEquivalenceMarkdown(report) {
  try {
    return formatEquivalenceMarkdownImpl(report);
  } catch {
    return formatEquivalenceMarkdownImpl(null);
  }
}
