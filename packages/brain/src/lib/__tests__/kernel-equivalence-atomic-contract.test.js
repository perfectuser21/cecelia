import { describe, expect, it } from 'vitest';
import { validateAtomicContract } from '../kernel-equivalence-atomic-contract.js';

const SHA40 = 'f16f2a76eef592c0e7b896bb58940f5e6231c306';
const SHA64 = 'a'.repeat(64);
const PROVIDERS = ['claude', 'codex', 'grok'];
const SCENARIOS = ['normal', 'violation', 'recovery'];
const NORMATIVE_REF =
  'docs/superpowers/specs/2026-07-29-kernel-atomic-inventory-p0-premerge.md';
const DERIVATION_REF =
  'docs/superpowers/specs/2026-07-29-kernel-atomic-contract-honesty-addendum-design.md';
const FULL_COUNTS = {
  required_behavior_count: 11,
  required_atomic_invariant_count: 43,
  proof_required_atomic_invariant_count: 42,
  required_probe_definition_count: 446,
  proof_required_probe_definition_count: 442,
  required_provider_probe_assertion_count: 1326,
  required_retired_absence_probe_count: 4,
};

// This is the canonical family catalog, not a test-local approximation of it.
const FAMILY_CATALOG = [
  ['KERNEL-P0-01-BRANCH-PROTECTION', ['S4'], ['nfr', 'invariant', 'checkpoint', 'failure_semantics', 'effect_confirmation', 'adversarial_surface'], 4, 31],
  ['KERNEL-P0-02-CREDENTIAL-GUARD', ['S0', 'S4', 'S12'], ['nfr', 'invariant', 'checkpoint', 'freshness', 'failure_semantics', 'effect_confirmation', 'adversarial_surface', 'ledger_freshness'], 3, 29],
  ['KERNEL-P0-03-BRANCH-PUSH-GUARD', ['S4', 'S5', 'S9'], ['fr', 'nfr', 'invariant', 'checkpoint', 'freshness', 'failure_semantics', 'effect_confirmation', 'adversarial_surface', 'ledger_freshness'], 4, 42],
  ['KERNEL-P0-04-CI-MERGE-AUTHORITY', ['S5', 'S6', 'S7', 'S8', 'S9'], ['fr', 'nfr', 'invariant', 'checkpoint', 'freshness', 'failure_semantics', 'effect_confirmation', 'adversarial_surface', 'ledger_freshness', 'axis_alignment'], 4, 40],
  ['KERNEL-P0-05-INDEPENDENT-EVALUATOR-JUDGE', ['S5', 'S6', 'S7', 'S9'], ['fr', 'nfr', 'invariant', 'checkpoint', 'freshness', 'failure_semantics', 'effect_confirmation', 'adversarial_surface', 'ledger_freshness', 'axis_alignment'], 3, 25],
  ['KERNEL-P0-06-HUMAN-REVIEW-AUTHORITY', ['S8', 'S9'], ['fr', 'nfr', 'invariant', 'checkpoint', 'freshness', 'failure_semantics', 'effect_confirmation', 'adversarial_surface', 'ledger_freshness', 'axis_alignment'], 2, 34],
  ['KERNEL-P0-07-RELEASE-PROMOTION', ['S9', 'S10', 'S11', 'S12'], ['fr', 'nfr', 'invariant', 'checkpoint', 'freshness', 'death_alert', 'failure_semantics', 'effect_confirmation', 'adversarial_surface', 'ledger_freshness', 'axis_alignment'], 5, 57],
  ['KERNEL-P1-08-STOP-ORPHAN-LIVENESS', ['S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11', 'S12'], ['nfr', 'invariant', 'checkpoint', 'freshness', 'death_alert', 'failure_semantics', 'effect_confirmation', 'adversarial_surface', 'ledger_freshness'], 5, 44],
  ['KERNEL-P1-09-DEVGATE-TDD-DOD', ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'], ['fr', 'nfr', 'invariant', 'checkpoint', 'freshness', 'failure_semantics', 'effect_confirmation', 'adversarial_surface', 'axis_alignment'], 5, 71],
  ['KERNEL-P1-10-CONTROLLER-SESSION-ISOLATION', ['S0', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S12'], ['fr', 'nfr', 'invariant', 'checkpoint', 'freshness', 'death_alert', 'failure_semantics', 'effect_confirmation', 'adversarial_surface', 'ledger_freshness', 'axis_alignment'], 4, 40],
  ['KERNEL-P1-11-REPORT-LEARNING-CLOSURE', ['S1', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11', 'S12'], ['fr', 'nfr', 'invariant', 'checkpoint', 'freshness', 'failure_semantics', 'effect_confirmation', 'ledger_freshness', 'axis_alignment'], 4, 33],
].map(([behavior_id, steps, dimensions, atom_count, probe_count]) => ({
  behavior_id,
  prefix: behavior_id.match(/^KERNEL-(P[01]-\d{2})-/)[1],
  priority: behavior_id.match(/^KERNEL-(P[01])-/)[1],
  steps,
  dimensions,
  atom_count,
  probe_count,
}));

const clone = (value) => structuredClone(value);
const appendixAuthority = () => ({
  kind: 'appendix_explicit',
  normative_ref: NORMATIVE_REF,
});
const designAuthority = () => ({
  kind: 'design_derived',
  derivation_ref: DERIVATION_REF,
});
const coverageGapAuthority = () => ({
  kind: 'coverage_gap',
  owner: 'kernel-contract',
  reason: 'the appendix does not define one expected outcome',
  closure_plan: 'approve the expected outcome and add its regression fixture',
});
const probeDefinition = (
  probe_id,
  scenario,
  expected_outcome,
  expectation_authority = appendixAuthority(),
) => ({
  probe_id,
  scenario,
  assertion: `${probe_id} exact normative assertion`,
  expected_outcome,
  expectation_authority,
});
const evidence = (kind = 'code', sha = SHA40) => ({
  kind,
  ref: 'packages/brain/src/lib/kernel-example.js',
  audited_at_sha: sha,
});
const predecessorBinding = () => ({
  exact_receipt_id_required: true,
  same_provider: true,
  same_case: true,
  same_artifact_sha: true,
  same_resource_generation: true,
});
const receiptRequirements = (probeDefinitions = [
  probeDefinition('fixture-N01', 'normal', 'confirmed'),
  probeDefinition('fixture-V01', 'violation', 'denied'),
  probeDefinition('fixture-R01', 'recovery', 'recovered'),
]) => {
  const expectedOutcome = (scenario) => {
    const outcomes = new Set(
      probeDefinitions
        .filter((probe) => probe.scenario === scenario)
        .map((probe) => probe.expected_outcome),
    );
    return outcomes.size === 1 ? [...outcomes][0] : 'per_probe';
  };
  return {
    policy: 'required_3x3',
    providers: [...PROVIDERS],
    scenarios: {
      normal: {
        expected_outcome: expectedOutcome('normal'),
        effect_code: 'kernel_effect_confirmed',
      },
      violation: {
        expected_outcome: expectedOutcome('violation'),
        effect_code: 'kernel_effect_denied',
      },
      recovery: {
        expected_outcome: expectedOutcome('recovery'),
        effect_code: 'kernel_effect_recovered',
        predecessor_scenario: 'violation',
        predecessor_binding: predecessorBinding(),
      },
    },
  };
};

function catalogEntry(prefix = 'P0-01') {
  return FAMILY_CATALOG.find((item) => item.prefix === prefix);
}

function activeProbeDefinitions(atomId, count = 3) {
  const prefix = atomId.replace('KERNEL-INV-', 'KERNEL-PROBE-');
  return Array.from({ length: count }, (_, index) => {
    const scenario = index === 0
      ? 'normal'
      : index === count - 1
        ? 'recovery'
        : 'violation';
    const expectedOutcome = {
      normal: 'confirmed',
      violation: 'denied',
      recovery: 'recovered',
    }[scenario];
    return probeDefinition(
      `${prefix}-${String(index + 1).padStart(3, '0')}`,
      scenario,
      expectedOutcome,
    );
  });
}

function scenarioPlan(probeDefinitions) {
  const ids = (scenario) => probeDefinitions
    .filter((probe) => probe.scenario === scenario)
    .map((probe) => probe.probe_id);
  return {
    normal: { required_probe_ids: ids('normal') },
    violation: { required_probe_ids: ids('violation') },
    recovery: {
      required_probe_ids: ids('recovery'),
      bindings: ids('recovery').map((recovery_probe_id) => ({
        recovery_probe_id,
        predecessor_probe_ids: ids('violation'),
        authority: appendixAuthority(),
      })),
      coverage_gaps: [],
    },
  };
}

function recoveryGap(
  gap_id,
  affected_violation_probe_ids,
  affected_recovery_probe_ids,
) {
  return {
    gap_id,
    affected_violation_probe_ids,
    affected_recovery_probe_ids,
    appendix_predecessor_text: 'the appendix names recovery without exact probe identity',
    reason: 'the appendix does not identify one exact predecessor set',
    owner: 'kernel-contract',
    closure_plan: 'approve the exact mapping and add its regression fixture',
  };
}

function activeAtom(prefix = 'P0-01', sequence = 1, probeCount = 3, overrides = {}) {
  const family = catalogEntry(prefix);
  const invariant_id = `KERNEL-INV-${prefix}-${String(sequence).padStart(2, '0')}`;
  const probe_definitions = activeProbeDefinitions(invariant_id, probeCount);
  return {
    invariant_id,
    priority: family.priority,
    classification: 'active_required',
    proof_status: 'gap',
    legacy_behavior: 'The legacy control remains required until atom-bound proof exists.',
    legacy_evidence: [evidence()],
    unified_constructs: [`kernel.${prefix.toLowerCase()}.atom-${sequence}`],
    gap: { owner: 'kernel', reason: 'atom-bound v2 receipt absent', closure_plan: 'execute the 3x3 probe matrix' },
    steps: [...family.steps],
    dimensions: [...family.dimensions],
    single_effect_owner_seam: `kernel.${prefix.toLowerCase()}.owner`,
    probe_definitions,
    scenario_plan: scenarioPlan(probe_definitions),
    receipt_requirements: receiptRequirements(probe_definitions),
    ...overrides,
  };
}

function driftedAtom(prefix = 'P0-01', sequence = 1, probeCount = 3, overrides = {}) {
  return {
    ...activeAtom(prefix, sequence, probeCount),
    classification: 'drifted_required_gap',
    drift: {
      expected: 'legacy and unified controls agree',
      observed: 'the unified control is weaker',
      evidence: [evidence('test')],
      owner: 'kernel',
      closure_plan: 'restore the required behavior and replay probes',
    },
    ...overrides,
  };
}

function replacementAtom(prefix = 'P0-01', sequence = 1, probeCount = 3, overrides = {}) {
  const base = activeAtom(prefix, sequence, probeCount);
  const {
    legacy_behavior: _legacyBehavior,
    legacy_evidence: _legacyEvidence,
    unified_constructs: _unifiedConstructs,
    gap: _gap,
    ...common
  } = base;
  return {
    ...common,
    classification: 'intentional_replacement',
    replacement: {
      forbidden_legacy_authority: 'legacy direct mutation',
      replacement_behavior: 'grant-bound single-owner mutation',
      rationale: 'the replacement removes ambient authority',
      legacy_evidence: [evidence('history')],
    },
    ...overrides,
  };
}

function retiredAtom(overrides = {}) {
  const family = catalogEntry('P1-08');
  const required_probe_ids = Array.from(
    { length: 4 },
    (_, index) => `KERNEL-PROBE-P1-08-01-A${String(index + 1).padStart(2, '0')}`,
  );
  return {
    invariant_id: 'KERNEL-INV-P1-08-01',
    priority: 'P1',
    classification: 'retired',
    proof_status: 'not_applicable',
    steps: [...family.steps],
    dimensions: [...family.dimensions],
    single_effect_owner_seam: 'kernel.p1-08.retired-owner',
    probe_definitions: required_probe_ids.map((probe_id) => probeDefinition(
      probe_id,
      'absence',
      'absent',
      {
        kind: 'appendix_explicit',
        normative_ref:
          'docs/superpowers/specs/2026-07-29-kernel-atomic-inventory-p1.md',
      },
    )),
    receipt_requirements: { policy: 'not_required' },
    retirement: {
      decision_ref: 'docs/decisions/kernel-p1-08-01-retirement.md',
      rationale: 'the orphaned legacy ownership path no longer exists',
      absence_proof: { required_probe_ids },
    },
    ...overrides,
  };
}

function familyFixture(prefix = 'P0-01', atoms = [activeAtom(prefix)], overrides = {}) {
  const catalog = catalogEntry(prefix);
  return {
    behavior_id: catalog.behavior_id,
    priority: catalog.priority,
    steps: [...catalog.steps],
    dimensions: [...catalog.dimensions],
    atomic_invariant_count: atoms.length,
    probe_definition_count: atoms.flatMap((atom) => atom.probe_definitions).length,
    atomic_invariants: atoms,
    ...overrides,
  };
}

function countsOf(behaviors) {
  const atoms = behaviors.flatMap((family) => family.atomic_invariants);
  const probes = atoms.flatMap((atom) => atom.probe_definitions);
  const proofAtoms = atoms.filter((atom) => atom.classification !== 'retired');
  const proofProbes = proofAtoms.flatMap((atom) => atom.probe_definitions);
  return {
    required_behavior_count: behaviors.length,
    required_atomic_invariant_count: atoms.length,
    proof_required_atomic_invariant_count: proofAtoms.length,
    required_probe_definition_count: probes.length,
    proof_required_probe_definition_count: proofProbes.length,
    required_provider_probe_assertion_count: proofProbes.length * PROVIDERS.length,
    required_retired_absence_probe_count: probes.filter((probe) => probe.scenario === 'absence').length,
  };
}

function rawContract(behaviors, overrides = {}) {
  return { schema_version: '1.1.0', ...countsOf(behaviors), behaviors, ...overrides };
}

function fullFixture() {
  const behaviors = FAMILY_CATALOG.map((catalog) => {
    const retiredProbeCount = catalog.prefix === 'P1-08' ? 4 : 0;
    const activeCount = catalog.atom_count - (retiredProbeCount ? 1 : 0);
    const activeProbeTotal = catalog.probe_count - retiredProbeCount;
    const quotient = Math.floor(activeProbeTotal / activeCount);
    const remainder = activeProbeTotal % activeCount;
    const atoms = Array.from({ length: catalog.atom_count }, (_, index) => {
      if (catalog.prefix === 'P1-08' && index === 0) return retiredAtom();
      const activeIndex = index - (catalog.prefix === 'P1-08' ? 1 : 0);
      const probeCount = quotient + (activeIndex < remainder ? 1 : 0);
      return activeAtom(catalog.prefix, index + 1, probeCount);
    });
    return familyFixture(catalog.prefix, atoms);
  });
  return rawContract(behaviors);
}

function familyPrefixFromFixture(family) {
  const behaviorPrefix = typeof family?.behavior_id === 'string'
    ? family.behavior_id.match(/^KERNEL-(P[01]-\d{2})-/)?.[1]
    : null;
  if (behaviorPrefix) return behaviorPrefix;
  const invariantId = family?.atomic_invariants?.[0]?.invariant_id;
  return typeof invariantId === 'string'
    ? invariantId.match(/^KERNEL-INV-(P[01]-\d{2})-/)?.[1] ?? null
    : null;
}

function resizeNumericProbes(atom, probeCount) {
  const identity = atom?.invariant_id?.match(
    /^KERNEL-INV-(P[01]-\d{2})-(\d{2})/,
  );
  if (!identity || atom.classification === 'retired' || probeCount < 2) return false;
  atom.probe_definitions = activeProbeDefinitions(
    `KERNEL-INV-${identity[1]}-${identity[2]}`,
    probeCount,
  );
  atom.scenario_plan = scenarioPlan(atom.probe_definitions);
  atom.receipt_requirements = receiptRequirements(atom.probe_definitions);
  return true;
}

function embedFamilyFixture(input, localFamily) {
  const prefix = familyPrefixFromFixture(localFamily);
  const catalog = catalogEntry(prefix);
  if (!catalog) return;
  const familyIndex = input.behaviors.findIndex(
    (family) => family.behavior_id === catalog.behavior_id,
  );
  const canonicalFamily = input.behaviors[familyIndex];
  const localAtoms = localFamily.atomic_invariants;
  const localProbeCount = localAtoms.reduce(
    (total, atom) => total + atom.probe_definitions.length,
    0,
  );
  const mergedAtoms = [
    ...localAtoms,
    ...canonicalFamily.atomic_invariants.slice(localAtoms.length),
  ];
  for (const field of ['steps', 'dimensions']) {
    if (
      localAtoms.length > 0
      && localAtoms.every((atom) => (
        JSON.stringify(atom[field]) === JSON.stringify(localAtoms[0][field])
      ))
      && JSON.stringify(localAtoms[0][field])
        !== JSON.stringify(canonicalFamily.atomic_invariants[0][field])
    ) {
      mergedAtoms.slice(localAtoms.length).forEach((atom) => {
        atom[field] = clone(localAtoms[0][field]);
      });
    }
  }
  const mergedProbeCount = mergedAtoms.reduce(
    (total, atom) => total + atom.probe_definitions.length,
    0,
  );
  const probeDelta = catalog.probe_count - mergedProbeCount;
  if (probeDelta !== 0) {
    const firstUntouchedIndex = localAtoms.length < mergedAtoms.length
      ? localAtoms.length
      : 0;
    const candidate = mergedAtoms[firstUntouchedIndex];
    resizeNumericProbes(
      candidate,
      candidate.probe_definitions.length + probeDelta,
    );
  }
  const {
    atomic_invariants: _localAtomicInvariants,
    atomic_invariant_count: localDeclaredAtomCount,
    probe_definition_count: localDeclaredProbeCount,
    ...localFields
  } = localFamily;
  input.behaviors[familyIndex] = {
    ...canonicalFamily,
    ...localFields,
    atomic_invariant_count: (
      catalog.atom_count + localDeclaredAtomCount - localAtoms.length
    ),
    probe_definition_count: (
      catalog.probe_count + localDeclaredProbeCount - localProbeCount
    ),
    atomic_invariants: mergedAtoms,
  };
}

function contract(behaviors = [familyFixture()], overrides = {}) {
  const input = fullFixture();
  behaviors.forEach((family) => embedFamilyFixture(input, family));
  return { ...input, ...overrides };
}

function validate(input) {
  return validateAtomicContract(input);
}
function findingCodes(input) {
  return validate(input).findings.map((finding) => finding.code);
}
function expectCode(input, code) {
  expect(findingCodes(input)).toContain(code);
}
function expectOnlyCode(input, code) {
  expect([...new Set(findingCodes(input))].sort()).toEqual([code]);
}
function renameAtom(atom, sequence) {
  const oldPrefix = atom.invariant_id.replace('KERNEL-INV-', 'KERNEL-PROBE-');
  atom.invariant_id = atom.invariant_id.replace(/-\d{2}$/, `-${String(sequence).padStart(2, '0')}`);
  const newPrefix = atom.invariant_id.replace('KERNEL-INV-', 'KERNEL-PROBE-');
  atom.probe_definitions.forEach((probe) => {
    probe.probe_id = probe.probe_id.replace(oldPrefix, newPrefix);
  });
  atom.scenario_plan = scenarioPlan(atom.probe_definitions);
}
function reparentAtomPrefix(atom, targetPrefix) {
  const oldPrefix = atom.invariant_id.match(/P[01]-\d{2}/)[0];
  atom.invariant_id = atom.invariant_id.replace(oldPrefix, targetPrefix);
  atom.priority = targetPrefix.split('-')[0];
  atom.probe_definitions.forEach((probe) => {
    probe.probe_id = probe.probe_id.replace(oldPrefix, targetPrefix);
  });
  atom.scenario_plan = scenarioPlan(atom.probe_definitions);
}

describe('validateAtomicContract schema and canonical inventory', () => {
  it('rejects an empty v1.1 catalog even when forged expected counts are supplied', () => {
    const emptyCounts = Object.fromEntries(
      Object.keys(FULL_COUNTS).map((field) => [field, 0]),
    );
    const output = validateAtomicContract({
      schema_version: '1.1.0',
      ...emptyCounts,
      behaviors: [],
    }, emptyCounts);

    expect(output.schema_valid).toBe(false);
    expect(output.findings.map((finding) => finding.code)).toContain(
      'atomic_global_count_mismatch',
    );
  });

  it('rejects a length-11 behavior catalog with a sparse slot', () => {
    const input = fullFixture();
    delete input.behaviors[5];

    const output = validate(input);

    expect(output.schema_valid).toBe(false);
    expect(output.findings).toContainEqual(expect.objectContaining({
      code: 'atomic_global_count_mismatch',
      path: 'behavior_equivalence.behaviors',
    }));
  });

  it('accepts the full canonical 11-family fixture and locks all seven totals', () => {
    const input = fullFixture();
    expect(validate(input)).toMatchObject({ schema_valid: true, findings: [] });
    expect(countsOf(input.behaviors)).toEqual(FULL_COUNTS);
    expect(input.behaviors.map((family) => family.behavior_id)).toEqual(
      FAMILY_CATALOG.map((family) => family.behavior_id),
    );
    expect(input.behaviors.map((family) => [
      family.atomic_invariant_count,
      family.probe_definition_count,
    ])).toEqual(FAMILY_CATALOG.map((family) => [family.atom_count, family.probe_count]));
    for (const atom of input.behaviors.flatMap((family) => family.atomic_invariants)) {
      if (atom.classification === 'retired') continue;
      const recoveryProbeIds = atom.probe_definitions
        .filter((probe) => probe.scenario === 'recovery')
        .map((probe) => probe.probe_id);
      expect(recoveryProbeIds).toEqual(
        atom.scenario_plan.recovery.required_probe_ids,
      );
      expect(atom.scenario_plan.recovery.bindings).toEqual(
        recoveryProbeIds.map((recovery_probe_id) => ({
          recovery_probe_id,
          predecessor_probe_ids: atom.probe_definitions
            .filter((probe) => probe.scenario === 'violation')
            .map((probe) => probe.probe_id),
          authority: appendixAuthority(),
        })),
      );
      expect(atom.scenario_plan.recovery.coverage_gaps).toEqual([]);
    }
    expect(input.behaviors[7].atomic_invariants[0].invariant_id).toBe('KERNEL-INV-P1-08-01');
  });

  it.each([
    ['required_behavior_count'],
    ['required_atomic_invariant_count'],
    ['proof_required_atomic_invariant_count'],
    ['required_probe_definition_count'],
    ['proof_required_probe_definition_count'],
    ['required_provider_probe_assertion_count'],
    ['required_retired_absence_probe_count'],
  ])('rejects a one-variable global %s mismatch', (field) => {
    const input = fullFixture();
    input[field] += 1;
    expectCode(input, 'atomic_global_count_mismatch');
  });

  it.each([
    ['family atom count', (input) => { input.behaviors[0].atomic_invariant_count += 1; }, 'atomic_family_count_mismatch'],
    ['family probe count', (input) => { input.behaviors[0].probe_definition_count += 1; }, 'atomic_probe_count_mismatch'],
    ['duplicate family', (input) => { input.behaviors[1].behavior_id = input.behaviors[0].behavior_id; }, 'atomic_global_count_mismatch'],
    ['duplicate atom', (input) => { input.behaviors[0].atomic_invariants[1].invariant_id = input.behaviors[0].atomic_invariants[0].invariant_id; }, 'atomic_invariant_id_duplicate'],
    ['duplicate probe', (input) => {
      const atom = input.behaviors[0].atomic_invariants[0];
      atom.probe_definitions[1].probe_id = atom.probe_definitions[0].probe_id;
      atom.scenario_plan = scenarioPlan(atom.probe_definitions);
    }, 'atomic_probe_id_duplicate'],
    ['atom priority', (input) => { input.behaviors[0].atomic_invariants[0].priority = 'P1'; }, 'atomic_invariant_prefix_invalid'],
    ['atom family prefix', (input) => { reparentAtomPrefix(input.behaviors[0].atomic_invariants[0], 'P0-99'); }, 'atomic_invariant_prefix_invalid'],
    ['probe family prefix', (input) => {
      const atom = input.behaviors[0].atomic_invariants[0];
      atom.probe_definitions[0].probe_id = atom.probe_definitions[0].probe_id.replace('P0-01', 'P0-99');
      atom.scenario_plan = scenarioPlan(atom.probe_definitions);
    }, 'atomic_probe_prefix_invalid', true],
    ['atom sequence gap', (input) => { renameAtom(input.behaviors[0].atomic_invariants[1], 5); }, 'atomic_family_count_mismatch'],
    ['probe sequence gap', (input) => {
      const atom = input.behaviors[0].atomic_invariants[0];
      atom.probe_definitions[1].probe_id = atom.probe_definitions[1].probe_id.replace('-002', '-099');
      atom.scenario_plan = scenarioPlan(atom.probe_definitions);
    }, 'atomic_probe_count_mismatch', true],
  ])('rejects %s', (_name, mutate, code, exact = false) => {
    const input = fullFixture();
    mutate(input);
    if (exact) expectOnlyCode(input, code);
    else expectCode(input, code);
  });

  it('reports duplicate supplied string probe IDs even when their grammar is invalid', () => {
    const first = activeAtom('P0-01', 1);
    const second = activeAtom('P0-01', 2);
    first.probe_definitions[0].probe_id = 'bogus';
    second.probe_definitions[0].probe_id = 'bogus';
    first.scenario_plan = scenarioPlan(first.probe_definitions);
    second.scenario_plan = scenarioPlan(second.probe_definitions);
    const output = validate(contract([
      familyFixture('P0-01', [first, second]),
    ]));
    expect(output.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        'atomic_probe_id_duplicate',
        'atomic_probe_prefix_invalid',
      ]),
    );
  });

  it.each([
    ['v1 atomic fields', { schema_version: '1.0.0', required_atomic_invariant_count: 1, behaviors: [] }, 'atomic_fields_forbidden_in_v1'],
    ['unknown schema', { schema_version: '9.9.9', behaviors: [] }, 'behavior_equivalence_schema_unsupported'],
  ])('rejects %s', (_name, input, code) => expectCode(input, code));

  it('accepts a pure schema 1.0 contract as legacy-only', () => {
    const output = validateAtomicContract({
      schema_version: '1.0.0',
      required_behavior_count: 11,
      behaviors: [],
    });
    expect(output.schema_valid).toBe(true);
    expect(output.atomic_contract_present).toBe(false);
    expect(output.atomic_cutover_ready).toBe(false);
  });
});

describe('canonical axes and exact scenario plan shape', () => {
  it('accepts non-empty child subsets whose union exactly covers the parent axes', () => {
    const catalog = catalogEntry('P0-02');
    const first = activeAtom('P0-02', 1);
    const second = activeAtom('P0-02', 2);
    first.steps = [catalog.steps[0]];
    second.steps = catalog.steps.slice(1);
    first.dimensions = catalog.dimensions.filter((_, index) => index % 2 === 0);
    second.dimensions = catalog.dimensions.filter((_, index) => index % 2 === 1);
    expect(validate(contract([familyFixture('P0-02', [first, second])]))).toMatchObject({
      schema_valid: true,
      findings: [],
    });
  });

  it.each([
    ['missing step from child union', (family) => { family.atomic_invariants.forEach((atom) => { atom.steps = family.steps.slice(1); }); }],
    ['missing dimension from child union', (family) => { family.atomic_invariants.forEach((atom) => { atom.dimensions = family.dimensions.slice(1); }); }],
    ['empty atom steps', (family) => { family.atomic_invariants[0].steps = []; }],
    ['empty atom dimensions', (family) => { family.atomic_invariants[0].dimensions = []; }],
    ['forged but self-consistent parent and children', (family) => {
      family.steps = ['S99'];
      family.dimensions = ['forged_axis'];
      family.atomic_invariants.forEach((atom) => {
        atom.steps = ['S99'];
        atom.dimensions = ['forged_axis'];
      });
    }],
  ])('rejects canonical axes defect: %s', (_name, mutate) => {
    const atoms = [activeAtom('P0-02', 1), activeAtom('P0-02', 2)];
    const family = familyFixture('P0-02', atoms);
    mutate(family);
    expectCode(contract([family]), 'atomic_family_canonical_axes_mismatch');
  });

  it('uses the exact normal/violation/recovery scenario_plan shape', () => {
    const atom = activeAtom();
    expect(atom.scenario_plan).toEqual({
      normal: { required_probe_ids: ['KERNEL-PROBE-P0-01-01-001'] },
      violation: {
        required_probe_ids: ['KERNEL-PROBE-P0-01-01-002'],
      },
      recovery: {
        required_probe_ids: ['KERNEL-PROBE-P0-01-01-003'],
        bindings: [{
          recovery_probe_id: 'KERNEL-PROBE-P0-01-01-003',
          predecessor_probe_ids: ['KERNEL-PROBE-P0-01-01-002'],
          authority: appendixAuthority(),
        }],
        coverage_gaps: [],
      },
    });
    expect(validate(contract())).toMatchObject({ schema_valid: true, findings: [] });
  });

  it('accepts canonical slugged invariant IDs with non-slugged probe prefixes', () => {
    const atom = activeAtom();
    atom.invariant_id = 'KERNEL-INV-P0-01-01-WORKSPACE-WRITE-ADMISSION';
    expect(validate(contract([familyFixture('P0-01', [atom])]))).toMatchObject({
      schema_valid: true,
      findings: [],
    });
  });

  it('accepts approved scenario-coded probe suffixes', () => {
    const atom = activeAtom();
    atom.invariant_id = 'KERNEL-INV-P0-01-01-WORKSPACE-WRITE-ADMISSION';
    atom.probe_definitions = [
      probeDefinition('KERNEL-PROBE-P0-01-01-N01', 'normal', 'confirmed'),
      probeDefinition('KERNEL-PROBE-P0-01-01-V01', 'violation', 'denied'),
      probeDefinition('KERNEL-PROBE-P0-01-01-V02', 'violation', 'blocked'),
      probeDefinition('KERNEL-PROBE-P0-01-01-R01', 'recovery', 'recovered'),
      probeDefinition(
        'KERNEL-PROBE-P0-01-01-R02',
        'recovery',
        'recovered',
        designAuthority(),
      ),
    ];
    atom.scenario_plan = {
      normal: { required_probe_ids: ['KERNEL-PROBE-P0-01-01-N01'] },
      violation: {
        required_probe_ids: [
          'KERNEL-PROBE-P0-01-01-V01',
          'KERNEL-PROBE-P0-01-01-V02',
        ],
      },
      recovery: {
        required_probe_ids: [
          'KERNEL-PROBE-P0-01-01-R01',
          'KERNEL-PROBE-P0-01-01-R02',
        ],
        bindings: [
          {
            recovery_probe_id: 'KERNEL-PROBE-P0-01-01-R01',
            predecessor_probe_ids: ['KERNEL-PROBE-P0-01-01-V01'],
            authority: appendixAuthority(),
          },
          {
            recovery_probe_id: 'KERNEL-PROBE-P0-01-01-R02',
            predecessor_probe_ids: [
              'KERNEL-PROBE-P0-01-01-V02',
              'KERNEL-PROBE-P0-01-01-R01',
            ],
            authority: designAuthority(),
          },
        ],
        coverage_gaps: [],
      },
    };
    atom.receipt_requirements = receiptRequirements(atom.probe_definitions);
    const family = familyFixture('P0-01', [atom], {
      probe_definition_count: atom.probe_definitions.length,
    });
    expect(validate(contract([family]))).toMatchObject({
      schema_valid: true,
      findings: [],
    });
  });

  it('rejects flat shorthand for multiple dedicated recovery probes', () => {
    const atom = activeAtom('P0-01', 1, 4);
    atom.probe_definitions[2].scenario = 'recovery';
    atom.probe_definitions[3].scenario = 'recovery';
    atom.scenario_plan = {
      normal: { required_probe_ids: [atom.probe_definitions[0].probe_id] },
      violation: { required_probe_ids: [atom.probe_definitions[1].probe_id] },
      recovery: {
        required_probe_ids: [
          atom.probe_definitions[2].probe_id,
          atom.probe_definitions[3].probe_id,
        ],
        predecessor_probe_ids: [atom.probe_definitions[1].probe_id],
        exact_predecessor_receipt_required: true,
      },
    };
    expectCode(
      contract([familyFixture('P0-01', [atom])]),
      'atomic_scenario_requirement_invalid',
    );
  });

  it('rejects required IDs that mix normal and dedicated recovery probes', () => {
    const atom = activeAtom('P0-01', 1, 3);
    atom.probe_definitions[2].scenario = 'recovery';
    atom.scenario_plan = {
      normal: { required_probe_ids: [atom.probe_definitions[0].probe_id] },
      violation: { required_probe_ids: [atom.probe_definitions[1].probe_id] },
      recovery: {
        required_probe_ids: [
          atom.probe_definitions[0].probe_id,
          atom.probe_definitions[2].probe_id,
        ],
        bindings: [],
        coverage_gaps: [],
      },
    };
    expectCode(
      contract([familyFixture('P0-01', [atom])]),
      'atomic_scenario_requirement_invalid',
    );
  });

  it('rejects a recovery ID owned by another atom', () => {
    const first = activeAtom('P0-01', 1);
    const second = activeAtom('P0-01', 2);
    first.scenario_plan.recovery.required_probe_ids = [
      second.scenario_plan.recovery.required_probe_ids[0],
    ];
    expectCode(
      contract([familyFixture('P0-01', [first, second])]),
      'atomic_scenario_requirement_invalid',
    );
  });

  it('rejects a plan that omits a recovery obligation', () => {
    const atom = activeAtom('P0-01', 1, 4);
    atom.probe_definitions[2].scenario = 'recovery';
    atom.probe_definitions[2].expected_outcome = 'recovered';
    atom.probe_definitions[3].scenario = 'recovery';
    atom.scenario_plan = {
      normal: { required_probe_ids: [atom.probe_definitions[0].probe_id] },
      violation: { required_probe_ids: [atom.probe_definitions[1].probe_id] },
      recovery: {
        required_probe_ids: [
          atom.probe_definitions[2].probe_id,
          atom.probe_definitions[3].probe_id,
        ],
        bindings: [
          {
            recovery_probe_id: atom.probe_definitions[2].probe_id,
            predecessor_probe_ids: [atom.probe_definitions[1].probe_id],
            authority: appendixAuthority(),
          },
        ],
        coverage_gaps: [],
      },
    };
    atom.receipt_requirements = receiptRequirements(atom.probe_definitions);
    expectCode(
      contract([familyFixture('P0-01', [atom])]),
      'recovery_coverage_gap_invalid',
    );
  });

  it('accepts an appendix-authorized normal replay when no recovery probe exists', () => {
    const atom = activeAtom();
    const [normal, firstViolation, replayedAsViolation] = atom.probe_definitions;
    replayedAsViolation.scenario = 'violation';
    replayedAsViolation.expected_outcome = 'denied';
    atom.scenario_plan = {
      normal: { required_probe_ids: [normal.probe_id] },
      violation: {
        required_probe_ids: [
          firstViolation.probe_id,
          replayedAsViolation.probe_id,
        ],
      },
      recovery: {
        required_probe_ids: [normal.probe_id],
        bindings: [{
          recovery_probe_id: normal.probe_id,
          predecessor_probe_ids: [
            firstViolation.probe_id,
            replayedAsViolation.probe_id,
          ],
          authority: appendixAuthority(),
        }],
        coverage_gaps: [],
      },
    };
    expect(validate(contract([familyFixture('P0-01', [atom])]))).toMatchObject({
      schema_valid: true,
      findings: [],
    });
  });

  it('accepts multiple atom-local normal replay targets', () => {
    const atom = activeAtom();
    atom.probe_definitions = [
      probeDefinition('KERNEL-PROBE-P0-01-01-N01', 'normal', 'confirmed'),
      probeDefinition('KERNEL-PROBE-P0-01-01-N02', 'normal', 'confirmed'),
      probeDefinition('KERNEL-PROBE-P0-01-01-V01', 'violation', 'denied'),
    ];
    atom.scenario_plan = {
      normal: {
        required_probe_ids: [
          'KERNEL-PROBE-P0-01-01-N01',
          'KERNEL-PROBE-P0-01-01-N02',
        ],
      },
      violation: { required_probe_ids: ['KERNEL-PROBE-P0-01-01-V01'] },
      recovery: {
        required_probe_ids: [
          'KERNEL-PROBE-P0-01-01-N01',
          'KERNEL-PROBE-P0-01-01-N02',
        ],
        bindings: [
          {
            recovery_probe_id: 'KERNEL-PROBE-P0-01-01-N01',
            predecessor_probe_ids: ['KERNEL-PROBE-P0-01-01-V01'],
            authority: appendixAuthority(),
          },
          {
            recovery_probe_id: 'KERNEL-PROBE-P0-01-01-N02',
            predecessor_probe_ids: ['KERNEL-PROBE-P0-01-01-V01'],
            authority: designAuthority(),
          },
        ],
        coverage_gaps: [],
      },
    };
    atom.receipt_requirements = receiptRequirements([
      ...atom.probe_definitions,
      probeDefinition('receipt-only-R01', 'recovery', 'recovered'),
    ]);
    const output = validate(contract([familyFixture('P0-01', [atom])]));
    expect(output).toMatchObject({ schema_valid: true, findings: [] });
    expect(output.metrics.recovery_mapping).toMatchObject({
      exact_binding_count: 42,
      derived_binding_count: 1,
    });
  });

  it('rejects an unknown normal replay target', () => {
    const atom = activeAtom();
    atom.probe_definitions[2].scenario = 'violation';
    atom.probe_definitions[2].expected_outcome = 'denied';
    atom.scenario_plan.recovery.required_probe_ids = [
      'KERNEL-PROBE-P0-01-01-N99',
    ];
    atom.scenario_plan.recovery.bindings[0].recovery_probe_id =
      'KERNEL-PROBE-P0-01-01-N99';
    expectCode(
      contract([familyFixture('P0-01', [atom])]),
      'atomic_scenario_requirement_invalid',
    );
  });

  it('rejects an unaccounted normal replay target', () => {
    const atom = activeAtom();
    const [normal] = atom.probe_definitions;
    atom.probe_definitions[2].scenario = 'violation';
    atom.probe_definitions[2].expected_outcome = 'denied';
    atom.scenario_plan = scenarioPlan(atom.probe_definitions);
    atom.scenario_plan.recovery = {
      required_probe_ids: [normal.probe_id],
      bindings: [],
      coverage_gaps: [],
    };
    expectCode(
      contract([familyFixture('P0-01', [atom])]),
      'recovery_coverage_gap_invalid',
    );
  });

  it('rejects cyclic dedicated recovery bindings', () => {
    const atom = activeAtom();
    atom.probe_definitions = [
      probeDefinition('KERNEL-PROBE-P0-01-01-N01', 'normal', 'confirmed'),
      probeDefinition('KERNEL-PROBE-P0-01-01-V01', 'violation', 'denied'),
      probeDefinition('KERNEL-PROBE-P0-01-01-R01', 'recovery', 'recovered'),
      probeDefinition('KERNEL-PROBE-P0-01-01-R02', 'recovery', 'recovered'),
    ];
    atom.scenario_plan = {
      normal: { required_probe_ids: ['KERNEL-PROBE-P0-01-01-N01'] },
      violation: { required_probe_ids: ['KERNEL-PROBE-P0-01-01-V01'] },
      recovery: {
        required_probe_ids: [
          'KERNEL-PROBE-P0-01-01-R01',
          'KERNEL-PROBE-P0-01-01-R02',
        ],
        bindings: [
          {
            recovery_probe_id: 'KERNEL-PROBE-P0-01-01-R01',
            predecessor_probe_ids: ['KERNEL-PROBE-P0-01-01-R02'],
            authority: appendixAuthority(),
          },
          {
            recovery_probe_id: 'KERNEL-PROBE-P0-01-01-R02',
            predecessor_probe_ids: ['KERNEL-PROBE-P0-01-01-R01'],
            authority: appendixAuthority(),
          },
        ],
        coverage_gaps: [],
      },
    };
    atom.receipt_requirements = receiptRequirements(atom.probe_definitions);
    const family = familyFixture('P0-01', [atom], {
      probe_definition_count: atom.probe_definitions.length,
    });
    const output = validate(contract([family]));
    expect(output.findings.map(({ code }) => code)).toContain(
      'recovery_binding_authority_invalid',
    );
    expect(output.metrics.recovery_mapping.exact_binding_count).toBe(41);
  });
});

describe('honest per-probe outcomes and recovery authority', () => {
  it.each([
    ['normal', 'confirmed'],
    ['violation', 'denied'],
    ['violation', 'blocked'],
    ['violation', 'unknown'],
    ['recovery', 'recovered'],
  ])('accepts the explicit %s outcome %s', (scenario, expectedOutcome) => {
    const atom = activeAtom();
    const probe = atom.probe_definitions.find((item) => item.scenario === scenario);
    probe.expected_outcome = expectedOutcome;
    atom.receipt_requirements.scenarios[scenario].expected_outcome = expectedOutcome;
    expect(validate(contract([familyFixture('P0-01', [atom])]))).toMatchObject({
      schema_valid: true,
      findings: [],
    });
  });

  it.each([
    ['appendix explicit', appendixAuthority()],
    ['design derived', designAuthority()],
    ['coverage gap', coverageGapAuthority()],
  ])('accepts exact %s expectation authority', (_name, authority) => {
    const atom = activeAtom();
    atom.probe_definitions[1].expectation_authority = authority;
    expect(validate(contract([familyFixture('P0-01', [atom])]))).toMatchObject({
      schema_valid: true,
      findings: [],
    });
  });

  it.each([
    ['missing assertion', (probe) => { delete probe.assertion; }],
    ['invalid outcome', (probe) => { probe.expected_outcome = 'success'; }],
    ['missing authority', (probe) => { delete probe.expectation_authority; }],
    ['appendix ref missing', (probe) => {
      probe.expectation_authority = { kind: 'appendix_explicit' };
    }],
    ['derived ref missing', (probe) => {
      probe.expectation_authority = { kind: 'design_derived' };
    }],
    ['coverage gap fields missing', (probe) => {
      probe.expectation_authority = { kind: 'coverage_gap', owner: 'kernel-contract' };
    }],
    ['authority extra field', (probe) => {
      probe.expectation_authority.extra = true;
    }],
  ])('rejects probe outcome contract defect: %s', (_name, mutate) => {
    const atom = activeAtom();
    mutate(atom.probe_definitions[0]);
    expectCode(
      contract([familyFixture('P0-01', [atom])]),
      'probe_outcome_contract_invalid',
    );
  });

  it('requires per_probe for heterogeneous outcomes in one scenario', () => {
    const atom = activeAtom('P0-01', 1, 4);
    atom.probe_definitions[2].expected_outcome = 'blocked';
    atom.receipt_requirements = receiptRequirements(atom.probe_definitions);
    const valid = validate(contract([familyFixture('P0-01', [atom])]));
    expect(valid).toMatchObject({ schema_valid: true, findings: [] });

    atom.receipt_requirements.scenarios.violation.expected_outcome = 'denied';
    expectCode(
      contract([familyFixture('P0-01', [atom])]),
      'probe_outcome_contract_invalid',
    );
  });

  it('requires the unique probe outcome for a homogeneous scenario', () => {
    const atom = activeAtom();
    atom.receipt_requirements.scenarios.violation.expected_outcome = 'per_probe';
    expectCode(
      contract([familyFixture('P0-01', [atom])]),
      'probe_outcome_contract_invalid',
    );
  });

  it('accepts a partially bound recovery plan with an explicit coverage gap', () => {
    const atom = activeAtom('P0-01', 1, 4);
    const [, firstViolation, secondViolation, recovery] = atom.probe_definitions;
    atom.scenario_plan.recovery = {
      required_probe_ids: [recovery.probe_id],
      bindings: [{
        recovery_probe_id: recovery.probe_id,
        predecessor_probe_ids: [firstViolation.probe_id],
        authority: appendixAuthority(),
      }],
      coverage_gaps: [recoveryGap(
        'KERNEL-RECOVERY-GAP-P0-01-01-01',
        [secondViolation.probe_id],
        [recovery.probe_id],
      )],
    };
    const output = validate(contract([familyFixture('P0-01', [atom])]));
    expect(output).toMatchObject({
      schema_valid: true,
      findings: [],
      atomic_cutover_ready: false,
    });
    expect(output.families[0].atoms[0].effective_status).toBe('gap');
  });

  it.each([
    ['missing authority', (binding) => { delete binding.authority; }],
    ['appendix ref missing', (binding) => {
      binding.authority = { kind: 'appendix_explicit' };
    }],
    ['derived ref missing', (binding) => {
      binding.authority = { kind: 'design_derived' };
    }],
    ['outside recovery target', (binding) => {
      binding.recovery_probe_id = 'KERNEL-PROBE-P0-01-02-R01';
    }],
    ['outside predecessor', (binding) => {
      binding.predecessor_probe_ids = ['KERNEL-PROBE-P0-01-02-V01'];
    }],
  ])('rejects recovery binding authority defect: %s', (_name, mutate) => {
    const atom = activeAtom();
    mutate(atom.scenario_plan.recovery.bindings[0]);
    expectCode(
      contract([familyFixture('P0-01', [atom])]),
      'recovery_binding_authority_invalid',
    );
  });

  it.each([
    ['missing owner', (atom, gap) => { delete gap.owner; }],
    ['missing reason', (atom, gap) => { delete gap.reason; }],
    ['missing closure plan', (atom, gap) => { delete gap.closure_plan; }],
    ['outside violation', (atom, gap) => {
      gap.affected_violation_probe_ids = ['KERNEL-PROBE-P0-01-02-V01'];
    }],
    ['outside recovery', (atom, gap) => {
      gap.affected_recovery_probe_ids = ['KERNEL-PROBE-P0-01-02-R01'];
    }],
    ['gap ID owned by another atom', (atom, gap) => {
      gap.gap_id = 'KERNEL-RECOVERY-GAP-P0-01-02-01';
    }],
    ['duplicate gap ID', (atom, gap) => {
      atom.scenario_plan.recovery.coverage_gaps.push(clone(gap));
    }],
    ['unaccounted violation', (atom) => {
      atom.scenario_plan.recovery.bindings[0].predecessor_probe_ids = [];
    }],
    ['unaccounted recovery', (atom) => {
      atom.scenario_plan.recovery.bindings = [];
    }],
    ['binding and gap claim same relation', (atom, gap) => {
      gap.affected_violation_probe_ids = [
        atom.scenario_plan.recovery.bindings[0].predecessor_probe_ids[0],
      ];
    }],
  ])('rejects recovery coverage gap defect: %s', (_name, mutate) => {
    const atom = activeAtom('P0-01', 1, 4);
    const [, firstViolation, secondViolation, recovery] = atom.probe_definitions;
    const gap = recoveryGap(
      'KERNEL-RECOVERY-GAP-P0-01-01-01',
      [secondViolation.probe_id],
      [recovery.probe_id],
    );
    atom.scenario_plan.recovery = {
      required_probe_ids: [recovery.probe_id],
      bindings: [{
        recovery_probe_id: recovery.probe_id,
        predecessor_probe_ids: [firstViolation.probe_id],
        authority: appendixAuthority(),
      }],
      coverage_gaps: [gap],
    };
    mutate(atom, gap);
    expectCode(
      contract([familyFixture('P0-01', [atom])]),
      'recovery_coverage_gap_invalid',
    );
  });

  it('derives authority and recovery metrics only from legal structures', () => {
    const atom = activeAtom('P0-01', 1, 4);
    const [, firstViolation, secondViolation, recovery] = atom.probe_definitions;
    firstViolation.expectation_authority = designAuthority();
    secondViolation.expectation_authority = coverageGapAuthority();
    atom.scenario_plan.recovery = {
      required_probe_ids: [recovery.probe_id],
      bindings: [{
        recovery_probe_id: recovery.probe_id,
        predecessor_probe_ids: [firstViolation.probe_id],
        authority: designAuthority(),
      }],
      coverage_gaps: [recoveryGap(
        'KERNEL-RECOVERY-GAP-P0-01-01-01',
        [secondViolation.probe_id],
        [recovery.probe_id],
      )],
    };
    const output = validate(contract([familyFixture('P0-01', [atom])]));
    expect(output.metrics).toMatchObject({
      probe_outcome_authority: {
        appendix_explicit: 444,
        design_derived: 1,
        coverage_gap: 1,
      },
      recovery_mapping: {
        exact_binding_count: 41,
        derived_binding_count: 1,
        coverage_gap_count: 1,
      },
    });
  });
});

describe('classification contracts are independent and mutually exclusive', () => {
  it.each([
    ['active', () => activeAtom()],
    ['drifted', () => driftedAtom()],
    ['replacement', () => replacementAtom()],
    ['retired', () => retiredAtom(), 'P1-08'],
  ])('accepts a legal %s atom', (_name, makeAtom, prefix = 'P0-01') => {
    const input = contract([familyFixture(prefix, [makeAtom()])]);
    expect(validate(input)).toMatchObject({ schema_valid: true, findings: [] });
  });

  it.each([
    ['active legacy_behavior', () => activeAtom(), (atom) => { delete atom.legacy_behavior; }],
    ['active legacy_evidence', () => activeAtom(), (atom) => { delete atom.legacy_evidence; }],
    ['active unified_constructs', () => activeAtom(), (atom) => { delete atom.unified_constructs; }],
    ['active gap', () => activeAtom(), (atom) => { delete atom.gap; }],
    ...['owner', 'reason', 'closure_plan'].map((field) => [
      `active gap.${field}`,
      () => activeAtom(),
      (atom) => { delete atom.gap[field]; },
    ]),
    ...['legacy_behavior', 'legacy_evidence', 'unified_constructs', 'gap'].map((field) => [
      `drifted inherited ${field}`,
      () => driftedAtom(),
      (atom) => { delete atom[field]; },
    ]),
    ['drift block', () => driftedAtom(), (atom) => { delete atom.drift; }],
    ...['expected', 'observed', 'evidence', 'owner', 'closure_plan'].map((field) => [
      `drift.${field}`,
      () => driftedAtom(),
      (atom) => { delete atom.drift[field]; },
    ]),
    ['replacement block', () => replacementAtom(), (atom) => { delete atom.replacement; }],
    ...['forbidden_legacy_authority', 'replacement_behavior', 'rationale'].map((field) => [
      `replacement.${field}`,
      () => replacementAtom(),
      (atom) => { delete atom.replacement[field]; },
    ]),
    ['retirement block', () => retiredAtom(), (atom) => { delete atom.retirement; }, 'P1-08'],
    ...['decision_ref', 'rationale', 'absence_proof'].map((field) => [
      `retirement.${field}`,
      () => retiredAtom(),
      (atom) => { delete atom.retirement[field]; },
      'P1-08',
    ]),
    ['retirement absence required_probe_ids', () => retiredAtom(), (atom) => {
      delete atom.retirement.absence_proof.required_probe_ids;
    }, 'P1-08'],
    ['active mixed with drift', () => activeAtom(), (atom) => { atom.drift = driftedAtom().drift; }],
    ['active mixed with replacement', () => activeAtom(), (atom) => { atom.replacement = replacementAtom().replacement; }],
    ['active mixed with retirement', () => activeAtom(), (atom) => { atom.retirement = retiredAtom().retirement; }],
    ['drifted mixed with replacement', () => driftedAtom(), (atom) => { atom.replacement = replacementAtom().replacement; }],
    ['drifted mixed with retirement', () => driftedAtom(), (atom) => { atom.retirement = retiredAtom().retirement; }],
    ...['legacy_behavior', 'legacy_evidence', 'unified_constructs', 'gap'].flatMap((field) => [
      [
        `replacement mixed with active ${field}`,
        () => replacementAtom(),
        (atom) => { atom[field] = clone(activeAtom()[field]); },
      ],
      [
        `retired mixed with active ${field}`,
        () => retiredAtom(),
        (atom) => { atom[field] = clone(activeAtom()[field]); },
        'P1-08',
      ],
    ]),
    ['replacement mixed with drift', () => replacementAtom(), (atom) => { atom.drift = driftedAtom().drift; }],
    ['replacement mixed with retirement', () => replacementAtom(), (atom) => { atom.retirement = retiredAtom().retirement; }],
    ['retired mixed with drift', () => retiredAtom(), (atom) => { atom.drift = driftedAtom().drift; }, 'P1-08'],
    ['retired mixed with replacement', () => retiredAtom(), (atom) => { atom.replacement = replacementAtom().replacement; }, 'P1-08'],
  ])('rejects classification contract defect: %s', (_name, makeAtom, mutate, prefix = 'P0-01') => {
    const atom = makeAtom();
    mutate(atom);
    expectCode(contract([familyFixture(prefix, [atom])]), 'atomic_classification_contract_invalid');
  });

  it('preserves classification when proven proof fails closed', () => {
    const atom = driftedAtom('P0-01', 1, 3, { proof_status: 'proven' });
    const output = validate(contract([familyFixture('P0-01', [atom])]));
    expect(output.families[0].atoms[0].classification).toBe('drifted_required_gap');
    expect(output.families[0].atoms[0].effective_status).toBe('gap');
    expect(output.atomic_cutover_ready).toBe(false);
    expect(output.findings.map((finding) => finding.code)).toContain(
      'atomic_receipt_v2_verifier_unavailable',
    );
  });

  it.each([
    ['active', () => activeAtom()],
    ['drifted', () => driftedAtom()],
    ['replacement', () => replacementAtom()],
  ])('rejects not_applicable proof_status for non-retired %s atom', (_name, makeAtom) => {
    const atom = makeAtom();
    atom.proof_status = 'not_applicable';
    expectCode(
      contract([familyFixture('P0-01', [atom])]),
      'atomic_classification_contract_invalid',
    );
  });

  it.each([
    ['active missing', () => activeAtom(), undefined],
    ['active unknown', () => activeAtom(), 'banana'],
    ['drifted missing', () => driftedAtom(), undefined],
    ['drifted unknown', () => driftedAtom(), 'banana'],
    ['replacement missing', () => replacementAtom(), undefined],
    ['replacement unknown', () => replacementAtom(), 'banana'],
  ])('rejects strict proof_status defect: %s', (_name, makeAtom, proofStatus) => {
    const atom = makeAtom();
    if (proofStatus === undefined) delete atom.proof_status;
    else atom.proof_status = proofStatus;
    expectCode(
      contract([familyFixture('P0-01', [atom])]),
      'atomic_classification_contract_invalid',
    );
  });

  it('derives proof-required metrics from classification, not proof_status', () => {
    const atom = activeAtom();
    atom.proof_status = 'not_applicable';
    const input = contract([familyFixture('P0-01', [atom])]);
    const output = validate(input);
    expect(output.metrics).toMatchObject({
      proof_required_atomic_invariant_count: 42,
      proof_required_probe_definition_count: 442,
      provider_probe_assertion_count: 1326,
    });
  });
});

describe('evidence is replayable, repository-relative, and non-sensitive', () => {
  it.each([
    ['code', SHA40],
    ['test', SHA64],
    ['contract', SHA40],
    ['history', SHA64],
  ])('accepts %s evidence with an immutable SHA', (kind, sha) => {
    const atom = activeAtom('P0-01', 1, 3, { legacy_evidence: [evidence(kind, sha)] });
    expect(validate(contract([familyFixture('P0-01', [atom])]))).toMatchObject({
      schema_valid: true,
      findings: [],
    });
  });

  it.each([
    ['home path', { ...evidence(), ref: '~/.claude/settings.json' }],
    ['absolute path', { ...evidence(), ref: '/Users/operator/audit.json' }],
    ['path traversal', { ...evidence(), ref: '../outside.json' }],
    ['missing ref', { kind: 'code', audited_at_sha: SHA40 }],
    ['missing SHA', { kind: 'code', ref: 'packages/brain/a.js' }],
    ['malformed SHA', evidence('code', 'not-a-sha')],
    ['uppercase SHA', evidence('code', SHA40.toUpperCase())],
    ['invalid kind', evidence('machine')],
    ...['payload', 'content', 'secret', 'credential', 'token', 'private_key', 'raw_value'].map((field) => [
      `sensitive field ${field}`,
      { ...evidence(), [field]: 'forbidden material' },
    ]),
  ])('rejects invalid legacy evidence: %s', (_name, invalidEvidence) => {
    const atom = activeAtom('P0-01', 1, 3, { legacy_evidence: [invalidEvidence] });
    expectCode(contract([familyFixture('P0-01', [atom])]), 'atomic_legacy_evidence_invalid');
  });

  it('uses the dedicated fail-closed code for runtime audit evidence', () => {
    const runtimeAudit = {
      kind: 'runtime_audit',
      ref: 'artifacts/kernel/runtime-audit.json',
      audited_at_sha: SHA40,
      signature: 'syntactically-signed-but-unverified',
    };
    const atom = activeAtom('P0-01', 1, 3, { legacy_evidence: [runtimeAudit] });
    expectCode(
      contract([familyFixture('P0-01', [atom])]),
      'runtime_audit_verifier_unavailable',
    );
  });

  it.each([
    ['file URI', 'file:///tmp/audit.json'],
    ['https URI', 'https://example.com/audit.json'],
    ['UNC backslash', '\\\\server\\share\\audit.json'],
    ['UNC slash', '//server/share/audit.json'],
    ['drive relative', 'C:audit.json'],
    ['NUL', 'packages/brain/audit\u0000.json'],
    ['dot', '.'],
    ['empty', ''],
  ])('rejects non-repository evidence ref: %s', (_name, ref) => {
    const atom = activeAtom('P0-01', 1, 3, {
      legacy_evidence: [{ ...evidence(), ref }],
    });
    expectCode(
      contract([familyFixture('P0-01', [atom])]),
      'atomic_legacy_evidence_invalid',
    );
  });

  it.each([
    ['unknown field', { ...evidence(), unexpected: true }],
    ['case-normalized token', { ...evidence(), Token: 'forbidden' }],
    ['underscore token', { ...evidence(), access_token: 'forbidden' }],
    ['hyphen token', { ...evidence(), 'access-token': 'forbidden' }],
  ])('rejects non-exact evidence shape: %s', (_name, invalidEvidence) => {
    const atom = activeAtom('P0-01', 1, 3, {
      legacy_evidence: [invalidEvidence],
    });
    expectCode(
      contract([familyFixture('P0-01', [atom])]),
      'atomic_legacy_evidence_invalid',
    );
  });

  it('preserves valid replacement legacy evidence without treating it as receipt proof', () => {
    const atom = replacementAtom();
    const output = validate(contract([familyFixture('P0-01', [atom])]));
    expect(output).toMatchObject({
      schema_valid: true,
      findings: [],
      atomic_cutover_ready: false,
    });
    expect(output.families[0].atoms[0].effective_status).toBe('gap');
  });

  it.each([
    ['absolute path', { ...evidence(), ref: '/tmp/legacy.js' }],
    ['missing SHA', { kind: 'code', ref: 'packages/engine/hooks/stop-dev.sh' }],
    ['runtime audit', {
      kind: 'runtime_audit',
      ref: 'artifacts/runtime.json',
      audited_at_sha: SHA40,
    }],
    ['sensitive material', { ...evidence(), token: 'forbidden' }],
  ])('rejects replacement legacy evidence: %s', (_name, invalidEvidence) => {
    const atom = replacementAtom();
    atom.replacement.legacy_evidence = [invalidEvidence];
    const output = validate(contract([familyFixture('P0-01', [atom])]));
    const finding = output.findings.find(
      ({ code }) => code === 'replacement_legacy_evidence_invalid',
    );
    expect(finding?.path).toContain('replacement.legacy_evidence');
    expect(output.findings.map(({ code }) => code)).not.toContain(
      'atomic_receipt_v2_verifier_unavailable',
    );
  });

  it.each([
    ['empty list', []],
    ['non-list', evidence()],
  ])('rejects replacement legacy evidence container: %s', (_name, legacyEvidence) => {
    const atom = replacementAtom();
    atom.replacement.legacy_evidence = legacyEvidence;
    expectCode(
      contract([familyFixture('P0-01', [atom])]),
      'replacement_legacy_evidence_invalid',
    );
  });
});

describe('providers, scenarios, owners, and recovery binding', () => {
  it('rejects a sparse provider matrix with the canonical length', () => {
    const input = fullFixture();
    const providers = new Array(3);
    providers[0] = 'claude';
    providers[2] = 'grok';
    input.behaviors[0]
      .atomic_invariants[0].receipt_requirements.providers = providers;

    expectCode(input, 'atomic_provider_matrix_invalid');
  });

  it.each([
    ['missing provider', (atom) => { atom.receipt_requirements.providers = PROVIDERS.slice(0, 2); }],
    ['extra provider', (atom) => { atom.receipt_requirements.providers.push('gemini'); }],
    ['duplicate provider', (atom) => { atom.receipt_requirements.providers[2] = 'codex'; }],
    ['provider order', (atom) => { atom.receipt_requirements.providers.reverse(); }],
  ])('rejects provider matrix defect: %s', (_name, mutate) => {
    const atom = activeAtom();
    mutate(atom);
    expectCode(contract([familyFixture('P0-01', [atom])]), 'atomic_provider_matrix_invalid');
  });

  it.each([
    ['missing scenario_plan normal', (atom) => { delete atom.scenario_plan.normal; }],
    ['extra scenario_plan member', (atom) => { atom.scenario_plan.other = { required_probe_ids: [] }; }],
    ['missing scenario', (atom) => { delete atom.receipt_requirements.scenarios.recovery; }],
    ['extra scenario', (atom) => { atom.receipt_requirements.scenarios.other = {}; }],
    ['normal has no probe', (atom) => {
      atom.probe_definitions[0].scenario = 'violation';
      atom.probe_definitions[0].expected_outcome = 'denied';
      atom.scenario_plan = scenarioPlan(atom.probe_definitions);
    }, true],
    ['violation has no probe', (atom) => {
      atom.probe_definitions
        .filter((probe) => probe.scenario === 'violation')
        .forEach((probe) => {
          probe.scenario = 'normal';
          probe.expected_outcome = 'confirmed';
        });
      atom.scenario_plan = scenarioPlan(atom.probe_definitions);
    }, true],
  ])('rejects scenario/probe defect: %s', (_name, mutate, exact = false) => {
    const atom = activeAtom();
    mutate(atom);
    const input = contract([familyFixture('P0-01', [atom])]);
    if (exact) expectOnlyCode(input, 'atomic_scenario_requirement_invalid');
    else expectCode(input, 'atomic_scenario_requirement_invalid');
  });

  it('rejects a recovery predecessor owned by another atom', () => {
    const first = activeAtom('P0-01', 1);
    const second = activeAtom('P0-01', 2);
    first.scenario_plan.recovery.bindings[0].predecessor_probe_ids = [
      second.scenario_plan.violation.required_probe_ids[0],
    ];
    expectCode(
      contract([familyFixture('P0-01', [first, second])]),
      'recovery_binding_authority_invalid',
    );
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['array', ['kernel.owner']],
    ['path traversal', '../../two owners'],
    ['empty segment', 'kernel..owner'],
    ['space', 'kernel owner'],
    ['slash', 'kernel/owner'],
    ['uppercase', 'Kernel.owner'],
  ])('rejects %s single-effect owner', (_name, owner) => {
    const atom = activeAtom('P0-01', 1, 3, { single_effect_owner_seam: owner });
    expectCode(
      contract([familyFixture('P0-01', [atom])]),
      'atomic_single_effect_owner_seam_invalid',
    );
  });

  it('rejects a family priority that contradicts its behavior ID', () => {
    const family = familyFixture('P0-01', [activeAtom()], {
      priority: 'P1',
    });
    expectCode(
      contract([family]),
      'atomic_invariant_prefix_invalid',
    );
  });

  it.each([
    ['receipt requirements extra field', (atom) => {
      atom.receipt_requirements.extra = true;
    }, 'atomic_provider_matrix_invalid'],
    ['normal requirement extra field', (atom) => {
      atom.receipt_requirements.scenarios.normal.extra = true;
    }, 'atomic_scenario_requirement_invalid'],
    ['violation requirement extra field', (atom) => {
      atom.receipt_requirements.scenarios.violation.extra = true;
    }, 'atomic_scenario_requirement_invalid'],
    ['recovery requirement extra field', (atom) => {
      atom.receipt_requirements.scenarios.recovery.extra = true;
    }, 'atomic_recovery_predecessor_binding_invalid'],
  ])('rejects non-exact receipt shape: %s', (_name, mutate, code) => {
    const atom = activeAtom();
    mutate(atom);
    expectOnlyCode(contract([familyFixture('P0-01', [atom])]), code);
  });

  it.each(SCENARIOS.flatMap((scenario) => [
    [`${scenario} missing expected_outcome`, (atom) => {
      delete atom.receipt_requirements.scenarios[scenario].expected_outcome;
    }],
    [`${scenario} missing effect_code`, (atom) => {
      delete atom.receipt_requirements.scenarios[scenario].effect_code;
    }],
  ]))('rejects %s', (_name, mutate) => {
    const atom = activeAtom();
    mutate(atom);
    expectCode(contract([familyFixture('P0-01', [atom])]), 'atomic_scenario_requirement_invalid');
  });

  it('rejects a non-violation predecessor_scenario', () => {
    const atom = activeAtom();
    atom.receipt_requirements.scenarios.recovery.predecessor_scenario = 'normal';
    expectCode(
      contract([familyFixture('P0-01', [atom])]),
      'atomic_recovery_predecessor_binding_invalid',
    );
  });

  it.each(Object.keys(predecessorBinding()).flatMap((field) => [
    [`missing ${field}`, (atom) => {
      delete atom.receipt_requirements.scenarios.recovery.predecessor_binding[field];
    }],
    [`false ${field}`, (atom) => {
      atom.receipt_requirements.scenarios.recovery.predecessor_binding[field] = false;
    }],
  ]))('rejects recovery binding defect: %s', (_name, mutate) => {
    const atom = activeAtom();
    mutate(atom);
    expectCode(
      contract([familyFixture('P0-01', [atom])]),
      'atomic_recovery_predecessor_binding_invalid',
    );
  });
});

describe('atom-bound receipts fail closed until a v2 verifier exists', () => {
  it.each([
    ['proof_matrix v1 family material', (atom) => { atom.proof_matrix = { version: 'v1', scope: 'family' }; }],
    ['proof_identity.effect_receipt_id', (atom) => { atom.proof_identity = { effect_receipt_id: 'receipt-v1-family' }; }],
    ['effect_receipt_id', (atom) => { atom.effect_receipt_id = 'receipt-v1-family'; }],
    ['receipt_bundle_ref', (atom) => { atom.receipt_bundle_ref = 'artifacts/receipts/v1.json'; }],
    ['execution_grant v1 object', (atom) => { atom.execution_grant = { version: 'v1', grant_id: 'fake' }; }],
    ['effect_receipt v1 object', (atom) => { atom.effect_receipt = { version: 'v1', receipt_id: 'fake' }; }],
    ['receipt_material string', (atom) => { atom.receipt_material = 'fake receipt bytes'; }],
    ['atom-bound fake-v2 object', (atom) => {
      atom.receipt_material = {
        schema_version: '2.0.0',
        invariant_id: atom.invariant_id,
        receipt_id: 'fake-v2',
      };
    }],
    ['atom-bound fake-v2 ref', (atom) => {
      atom.receipt_ref = `receipt://fake-v2/${atom.invariant_id}`;
    }],
  ])('rejects %s', (_name, addMaterial) => {
    const atom = activeAtom();
    addMaterial(atom);
    const output = validate(contract([familyFixture('P0-01', [atom])]));
    expect(output.findings.map((finding) => finding.code)).toContain(
      'atomic_receipt_v2_verifier_unavailable',
    );
    expect(output.families[0].atoms[0].effective_status).toBe('gap');
    expect(output.atomic_cutover_ready).toBe(false);
  });

  it('rejects proven status even when no receipt material is supplied', () => {
    const atom = activeAtom('P0-01', 1, 3, { proof_status: 'proven' });
    const output = validate(contract([familyFixture('P0-01', [atom])]));
    expect(output.findings.map((finding) => finding.code)).toContain(
      'atomic_receipt_v2_verifier_unavailable',
    );
    expect(output.families[0].atoms[0].effective_status).toBe('gap');
    expect(output.atomic_cutover_ready).toBe(false);
  });

  it.each([
    ['gap receipt ref', () => activeAtom(), (atom) => {
      atom.gap.receipt_ref = 'receipt://v2/fake';
    }],
    ['case-insensitive nested receipt', () => activeAtom(), (atom) => {
      atom.gap.ReceiptRef = { schema_version: '2.0.0' };
    }],
    ['drift nested grant', () => driftedAtom(), (atom) => {
      atom.drift.executionGrant = { version: 'v2', grant_id: 'fake' };
    }],
    ['replacement nested proof', () => replacementAtom(), (atom) => {
      atom.replacement.proofMaterial = 'fake';
    }],
    ['retired top-level receipt ref', () => retiredAtom(), (atom) => {
      atom.receipt_ref = 'receipt://v2/fake';
    }, 'P1-08'],
    ['retired fake v2 material', () => retiredAtom(), (atom) => {
      atom.receipt_material = { schema_version: '2.0.0', receipt_id: 'fake' };
    }, 'P1-08'],
  ])('rejects recursively configured receipt material: %s', (
    _name,
    makeAtom,
    mutate,
    prefix = 'P0-01',
  ) => {
    const atom = makeAtom();
    mutate(atom);
    const output = validate(contract([familyFixture(prefix, [atom])]));
    expect(output.schema_valid).toBe(false);
    expect(output.atomic_cutover_ready).toBe(false);
    expect(output.findings.map((finding) => finding.code)).toContain(
      'atomic_receipt_v2_verifier_unavailable',
    );
  });
});

describe('retirement is P1-08 atom 01 with exact absence proof projection', () => {
  it('keeps the canonical retired atom in its real family and cutover remains false', () => {
    const input = contract([familyFixture('P1-08', [retiredAtom()])]);
    const output = validate(input);
    expect(output).toMatchObject({
      schema_valid: true,
      findings: [],
      atomic_cutover_ready: false,
    });
    const family = output.families.find(
      ({ behavior_id }) => behavior_id === 'KERNEL-P1-08-STOP-ORPHAN-LIVENESS',
    );
    expect(family.atoms[0]).toMatchObject({
      classification: 'retired',
      effective_status: 'retired',
      projection: 'na',
      retired_absence_probe_statuses: [
        { probe_id: 'KERNEL-PROBE-P1-08-01-A01', status: 'unverified' },
        { probe_id: 'KERNEL-PROBE-P1-08-01-A02', status: 'unverified' },
        { probe_id: 'KERNEL-PROBE-P1-08-01-A03', status: 'unverified' },
        { probe_id: 'KERNEL-PROBE-P1-08-01-A04', status: 'unverified' },
      ],
    });
  });

  it.each([
    ['gap proof status', (atom) => { atom.proof_status = 'gap'; }],
    ['proven proof status', (atom) => { atom.proof_status = 'proven'; }],
    ['3x3 policy', (atom) => { atom.receipt_requirements = receiptRequirements(); }],
    ['normal probe', (atom) => { atom.probe_definitions[0].scenario = 'normal'; }],
    ['violation probe', (atom) => { atom.probe_definitions[0].scenario = 'violation'; }],
    ['recovery probe', (atom) => { atom.probe_definitions[0].scenario = 'recovery'; }],
    ['non-canonical absence ID', (atom) => {
      atom.probe_definitions[3].probe_id = 'KERNEL-PROBE-P1-08-01-A05';
      atom.retirement.absence_proof.required_probe_ids[3] = 'KERNEL-PROBE-P1-08-01-A05';
    }],
  ])('rejects retired atom with %s', (_name, mutate) => {
    const atom = retiredAtom();
    mutate(atom);
    expectCode(
      contract([familyFixture('P1-08', [atom])]),
      'atomic_classification_contract_invalid',
    );
  });

  it.each([
    ['missing assertion', (probe) => { delete probe.assertion; }],
    ['non-absent outcome', (probe) => { probe.expected_outcome = 'unknown'; }],
    ['invalid authority', (probe) => {
      probe.expectation_authority = { kind: 'appendix_explicit' };
    }],
  ])('rejects retired probe outcome defect: %s', (_name, mutate) => {
    const atom = retiredAtom();
    mutate(atom.probe_definitions[0]);
    expectCode(
      contract([familyFixture('P1-08', [atom])]),
      'probe_outcome_contract_invalid',
    );
  });

  it('rejects a retired atom with a non-absence scenario plan', () => {
    const atom = retiredAtom({ scenario_plan: scenarioPlan([]) });
    expectCode(
      contract([familyFixture('P1-08', [atom])]),
      'atomic_classification_contract_invalid',
    );
  });
});

describe('malformed external values never escape the finding envelope', () => {
  const malformed = [
    ['null', null],
    ['number', 42],
    ['object', { forged: true }],
    ['symbol', Symbol('malformed')],
  ];

  it.each(malformed)('does not throw for malformed behavior_id: %s', (_name, value) => {
    const input = contract([familyFixture('P0-01', [activeAtom()], {
      behavior_id: value,
    })]);
    let output;
    expect(() => {
      output = validate(input);
    }).not.toThrow();
    expect(output.schema_valid).toBe(false);
    expect(output.findings.length).toBeGreaterThan(0);
  });

  it.each(malformed)('does not throw for malformed invariant_id: %s', (_name, value) => {
    const atom = activeAtom();
    atom.invariant_id = value;
    const input = contract([familyFixture('P0-01', [atom])]);
    let output;
    expect(() => {
      output = validate(input);
    }).not.toThrow();
    expect(output.schema_valid).toBe(false);
    expect(output.findings.length).toBeGreaterThan(0);
  });

  it.each(malformed)('does not throw for malformed probe_id: %s', (_name, value) => {
    const atom = activeAtom();
    atom.probe_definitions[0].probe_id = value;
    atom.scenario_plan.normal.required_probe_ids[0] = value;
    const input = contract([familyFixture('P0-01', [atom])]);
    let output;
    expect(() => {
      output = validate(input);
    }).not.toThrow();
    expect(output.schema_valid).toBe(false);
    expect(output.findings.length).toBeGreaterThan(0);
  });

  it.each(malformed)('does not throw for malformed audited_at_sha: %s', (_name, value) => {
    const atom = activeAtom('P0-01', 1, 3, {
      legacy_evidence: [evidence('code', value)],
    });
    const input = contract([familyFixture('P0-01', [atom])]);
    let output;
    expect(() => {
      output = validate(input);
    }).not.toThrow();
    expect(output.schema_valid).toBe(false);
    expect(output.findings.length).toBeGreaterThan(0);
  });
});

describe('object graph validation is cycle-safe and budgeted', () => {
  it.each([
    ['top-level schema_version', (input, getter) => {
      Object.defineProperty(input, 'schema_version', {
        enumerable: true,
        get: getter,
      });
    }],
    ['top-level behaviors', (input, getter) => {
      Object.defineProperty(input, 'behaviors', {
        enumerable: true,
        get: getter,
      });
    }],
    ['top-level declared count', (input, getter) => {
      Object.defineProperty(input, 'required_behavior_count', {
        enumerable: true,
        get: getter,
      });
    }],
    ['family behavior_id', (input, getter) => {
      Object.defineProperty(input.behaviors[0], 'behavior_id', {
        enumerable: true,
        get: getter,
      });
    }],
    ['family steps', (input, getter) => {
      Object.defineProperty(input.behaviors[0], 'steps', {
        enumerable: true,
        get: getter,
      });
    }],
  ])('fails closed without invoking a throwing %s accessor', (
    _name,
    installAccessor,
  ) => {
    const input = fullFixture();
    let accessorCalls = 0;
    installAccessor(input, () => {
      accessorCalls += 1;
      throw new Error('hostile enumerable accessor');
    });
    let output;

    expect(() => {
      output = validate(input);
    }).not.toThrow();
    expect(accessorCalls).toBe(0);
    expect(output.schema_valid).toBe(false);
    expect(output.findings.map((finding) => finding.code)).toContain(
      'atomic_contract_input_invalid',
    );
  });

  it('preserves the family budget when a nested family accessor is hostile', () => {
    const input = fullFixture();
    input.behaviors.push(clone(input.behaviors[0]));
    let accessorCalls = 0;
    Object.defineProperty(input.behaviors[0], 'atomic_invariants', {
      enumerable: true,
      get() {
        accessorCalls += 1;
        throw new Error('hostile atomic_invariants accessor');
      },
    });
    let output;

    expect(() => {
      output = validate(input);
    }).not.toThrow();
    expect(accessorCalls).toBe(0);
    expect(output.schema_valid).toBe(false);
    expect(output.metrics.behavior_count).toBeGreaterThan(11);
    expect(output.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        'atomic_contract_input_invalid',
        'atomic_contract_input_budget_exceeded',
      ]),
    );
  });

  it('fails closed without throwing when an atom references itself', () => {
    const input = fullFixture();
    const atom = input.behaviors[0].atomic_invariants[0];
    atom.self = atom;
    let output;

    expect(() => {
      output = validate(input);
    }).not.toThrow();
    expect(output.schema_valid).toBe(false);
    expect(output.findings.map((finding) => finding.code)).toContain(
      'atomic_contract_input_invalid',
    );
  });

  it('fails closed when a probe Proxy throws from ownKeys', () => {
    const input = fullFixture();
    input.behaviors[0].atomic_invariants[0].probe_definitions[0] = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('hostile ownKeys trap');
        },
      },
    );
    let output;

    expect(() => {
      output = validate(input);
    }).not.toThrow();
    expect(output.schema_valid).toBe(false);
    expect(output.findings.map((finding) => finding.code)).toContain(
      'atomic_contract_input_invalid',
    );
  });

  it('fails closed when a probe scenario accessor throws before metrics', () => {
    const input = fullFixture();
    const hostileProbe = {};
    Object.defineProperty(hostileProbe, 'scenario', {
      enumerable: true,
      get() {
        throw new Error('hostile scenario accessor');
      },
    });
    input.behaviors[0].atomic_invariants[0].probe_definitions[0] = hostileProbe;
    let output;

    expect(() => {
      output = validate(input);
    }).not.toThrow();
    expect(output.schema_valid).toBe(false);
    expect(output.findings.map((finding) => finding.code)).toContain(
      'atomic_contract_input_invalid',
    );
  });

  it('fails closed without throwing for cyclic evidence', () => {
    const input = fullFixture();
    const evidenceItem = input.behaviors[0]
      .atomic_invariants[0].legacy_evidence[0];
    evidenceItem.self = evidenceItem;
    let output;

    expect(() => {
      output = validate(input);
    }).not.toThrow();
    expect(output.schema_valid).toBe(false);
    expect(output.findings.map((finding) => finding.code)).toContain(
      'atomic_contract_input_invalid',
    );
  });

  it('fails closed without throwing when graph depth exceeds the budget', () => {
    const input = fullFixture();
    let cursor = input.behaviors[0].atomic_invariants[0];
    for (let depth = 0; depth < 65; depth += 1) {
      cursor.nested = {};
      cursor = cursor.nested;
    }
    let output;

    expect(() => {
      output = validate(input);
    }).not.toThrow();
    expect(output.schema_valid).toBe(false);
    expect(output.findings.map((finding) => finding.code)).toContain(
      'atomic_contract_input_budget_exceeded',
    );
  });

  it('fails closed without throwing when graph nodes exceed the budget', () => {
    const input = fullFixture();
    input.behaviors[0].atomic_invariants[0].wide = Array.from(
      { length: 4097 },
      () => ({}),
    );
    let output;

    expect(() => {
      output = validate(input);
    }).not.toThrow();
    expect(output.schema_valid).toBe(false);
    expect(output.findings.map((finding) => finding.code)).toContain(
      'atomic_contract_input_budget_exceeded',
    );
  });
});

describe('inventory complexity budgets stop adversarial descent', () => {
  it.each([
    ['12 families', 'behavior_count', 11, (input) => {
      input.behaviors.push(clone(input.behaviors[0]));
    }],
    ['44 atoms', 'atomic_invariant_count', 43, (input) => {
      input.behaviors[0].atomic_invariants.push(
        clone(input.behaviors[0].atomic_invariants[0]),
      );
    }],
    ['447 probes', 'probe_definition_count', 446, (input) => {
      input.behaviors[0].atomic_invariants[0].probe_definitions.push({
        probe_id: 'KERNEL-PROBE-P0-01-01-009',
        scenario: 'violation',
      });
    }],
  ])('fails closed at the canonical maximum: %s', (
    _name,
    metric,
    maximum,
    mutate,
  ) => {
    const input = fullFixture();
    mutate(input);
    let output;

    expect(() => {
      output = validate(input);
    }).not.toThrow();
    expect(output.schema_valid).toBe(false);
    expect(output.metrics[metric]).toBeGreaterThan(maximum);
    expect(output.findings.map((finding) => finding.code)).toContain(
      'atomic_contract_input_budget_exceeded',
    );
    expect(output.findings.length).toBeLessThanOrEqual(256);
  });

  it.each([
    ['sparse', () => {
      const behaviors = new Array(50_000);
      behaviors[0] = fullFixture().behaviors[0];
      behaviors[49_999] = fullFixture().behaviors[1];
      return behaviors;
    }],
    ['repeated', () => {
      const family = fullFixture().behaviors[0];
      return Array(50_000).fill(family);
    }],
  ])('bounds a large %s family array without throwing', (_name, makeBehaviors) => {
    const input = fullFixture();
    input.behaviors = makeBehaviors();
    let output;

    expect(() => {
      output = validate(input);
    }).not.toThrow();
    expect(output.schema_valid).toBe(false);
    expect(output.metrics.behavior_count).toBe(50_000);
    expect(output.findings.map((finding) => finding.code)).toContain(
      'atomic_contract_input_budget_exceeded',
    );
    expect(output.findings.length).toBeLessThanOrEqual(256);
    expect(output.families.length).toBeLessThanOrEqual(11);
  });

  it('caps unique findings while preserving fail-closed status', () => {
    const input = fullFixture();
    for (const family of input.behaviors) {
      for (const atom of family.atomic_invariants) {
        if (atom.classification === 'retired') continue;
        atom.probe_definitions.forEach((probe, index) => {
          probe.probe_id = `invalid-${atom.invariant_id}-${index}`;
        });
      }
    }

    const output = validate(input);

    expect(output.schema_valid).toBe(false);
    expect(output.findings).toHaveLength(256);
    expect(output.findings.map((finding) => finding.code)).toContain(
      'atomic_probe_prefix_invalid',
    );
  });
});

describe('nested complexity preflight stops detailed validators', () => {
  it('bounds 50k dense legacy evidence before evidence validation', () => {
    const input = fullFixture();
    input.behaviors[0].atomic_invariants[0].legacy_evidence = Array(50_000)
      .fill({});
    let output;

    expect(() => {
      output = validate(input);
    }).not.toThrow();
    expect(output.schema_valid).toBe(false);
    expect(output.findings.map((finding) => finding.code)).toContain(
      'atomic_contract_input_budget_exceeded',
    );
    expect(output.findings.map((finding) => finding.code)).not.toContain(
      'atomic_legacy_evidence_invalid',
    );
    expect(output.findings.length).toBeLessThanOrEqual(256);
  });

  it('bounds 50k dense atom axes before Set-based validation', () => {
    const input = fullFixture();
    const atom = input.behaviors[0].atomic_invariants[0];
    atom.steps = Array(50_000).fill('S4');
    atom.dimensions = Array(50_000).fill('invariant');
    let output;

    expect(() => {
      output = validate(input);
    }).not.toThrow();
    expect(output.schema_valid).toBe(false);
    expect(output.findings.map((finding) => finding.code)).toContain(
      'atomic_contract_input_budget_exceeded',
    );
    expect(output.findings.map((finding) => finding.code)).not.toContain(
      'atomic_family_canonical_axes_mismatch',
    );
    expect(output.findings.length).toBeLessThanOrEqual(256);
  });

  it('bounds 50k dense recovery bindings before flatMap validation', () => {
    const input = fullFixture();
    const atom = input.behaviors[0].atomic_invariants[0];
    atom.scenario_plan.recovery = {
      required_probe_ids: [atom.probe_definitions.at(-1).probe_id],
      bindings: Array(50_000).fill({
        recovery_probe_id: atom.probe_definitions.at(-1).probe_id,
        predecessor_probe_ids: [atom.probe_definitions[1].probe_id],
        authority: appendixAuthority(),
      }),
      coverage_gaps: [],
    };
    let output;

    expect(() => {
      output = validate(input);
    }).not.toThrow();
    expect(output.schema_valid).toBe(false);
    expect(output.findings.map((finding) => finding.code)).toContain(
      'atomic_contract_input_budget_exceeded',
    );
    expect(output.findings.map((finding) => finding.code)).not.toContain(
      'atomic_scenario_requirement_invalid',
    );
    expect(output.findings.length).toBeLessThanOrEqual(256);
  });
});

describe('finding identity includes the exact path', () => {
  it('keeps same-code findings for separate malformed atoms', () => {
    const first = activeAtom('P0-01', 1);
    const second = activeAtom('P0-01', 2);
    delete first.single_effect_owner_seam;
    delete second.single_effect_owner_seam;
    const output = validate(contract([
      familyFixture('P0-01', [first, second]),
    ]));
    const ownerFindings = output.findings.filter(
      (finding) => finding.code === 'atomic_single_effect_owner_seam_invalid',
    );
    expect(ownerFindings).toHaveLength(2);
    expect(new Set(ownerFindings.map((finding) => finding.path)).size).toBe(2);
  });

  it('is deterministic and does not mutate canonical input', () => {
    const input = fullFixture();
    const before = clone(input);

    const first = validate(input);
    const second = validate(input);

    expect(input).toEqual(before);
    expect(second).toEqual(first);
  });
});
