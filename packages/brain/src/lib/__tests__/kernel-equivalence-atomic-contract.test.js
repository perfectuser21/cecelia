import { describe, expect, it } from 'vitest';
import { validateAtomicContract } from '../kernel-equivalence-atomic-contract.js';

const SHA40 = 'f16f2a76eef592c0e7b896bb58940f5e6231c306';
const SHA64 = 'a'.repeat(64);
const PROVIDERS = ['claude', 'codex', 'grok'];
const SCENARIOS = ['normal', 'violation', 'recovery'];
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
const receiptRequirements = () => ({
  policy: 'required_3x3',
  providers: [...PROVIDERS],
  scenarios: {
    normal: { expected_outcome: 'confirmed', effect_code: 'kernel_effect_confirmed' },
    violation: { expected_outcome: 'denied', effect_code: 'kernel_effect_denied' },
    recovery: {
      expected_outcome: 'recovered',
      effect_code: 'kernel_effect_recovered',
      predecessor_scenario: 'violation',
      predecessor_binding: predecessorBinding(),
    },
  },
});

function catalogEntry(prefix = 'P0-01') {
  return FAMILY_CATALOG.find((item) => item.prefix === prefix);
}

function activeProbeDefinitions(atomId, count = 3) {
  const prefix = atomId.replace('KERNEL-INV-', 'KERNEL-PROBE-');
  return Array.from({ length: count }, (_, index) => ({
    probe_id: `${prefix}-${String(index + 1).padStart(3, '0')}`,
    scenario: index === 0 ? 'normal' : index === count - 1 ? 'recovery' : 'violation',
  }));
}

function scenarioPlan(probeDefinitions) {
  const ids = (scenario) => probeDefinitions
    .filter((probe) => probe.scenario === scenario)
    .map((probe) => probe.probe_id);
  return {
    normal: { required_probe_ids: ids('normal') },
    violation: { required_probe_ids: ids('violation') },
    recovery: {
      replay_probe_id: ids('recovery')[0],
      predecessor_probe_ids: ids('violation'),
      exact_predecessor_receipt_required: true,
    },
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
    receipt_requirements: receiptRequirements(),
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
    probe_definitions: required_probe_ids.map((probe_id) => ({ probe_id, scenario: 'absence' })),
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
  const proofAtoms = atoms.filter((atom) => atom.proof_status !== 'not_applicable');
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

function contract(behaviors = [familyFixture()], overrides = {}) {
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
  return contract(behaviors);
}

function validate(input, expected = countsOf(input.behaviors || [])) {
  return validateAtomicContract(input, expected);
}
function findingCodes(input, expected) {
  return validate(input, expected).findings.map((finding) => finding.code);
}
function expectCode(input, code, expected) {
  expect(findingCodes(input, expected)).toContain(code);
}
function expectOnlyCode(input, code, expected) {
  expect([...new Set(findingCodes(input, expected))].sort()).toEqual([code]);
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
  it('accepts the full canonical 11-family fixture and locks all seven totals', () => {
    const input = fullFixture();
    expect(validate(input, FULL_COUNTS)).toMatchObject({ schema_valid: true, findings: [] });
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
      expect(recoveryProbeIds).toEqual([atom.scenario_plan.recovery.replay_probe_id]);
      expect(atom.scenario_plan.recovery.predecessor_probe_ids).toEqual(
        atom.probe_definitions
          .filter((probe) => probe.scenario === 'violation')
          .map((probe) => probe.probe_id),
      );
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
    expectCode(input, 'atomic_global_count_mismatch', FULL_COUNTS);
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
      atom.probe_definitions[0].probe_id = atom.probe_definitions[0].probe_id.replace('P0-01', 'P0-02');
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
    if (exact) expectOnlyCode(input, code, FULL_COUNTS);
    else expectCode(input, code, FULL_COUNTS);
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
      violation: { required_probe_ids: ['KERNEL-PROBE-P0-01-01-002'] },
      recovery: {
        replay_probe_id: 'KERNEL-PROBE-P0-01-01-003',
        predecessor_probe_ids: ['KERNEL-PROBE-P0-01-01-002'],
        exact_predecessor_receipt_required: true,
      },
    });
    expect(validate(contract())).toMatchObject({ schema_valid: true, findings: [] });
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
});

describe('providers, scenarios, owners, and recovery binding', () => {
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
      atom.scenario_plan = scenarioPlan(atom.probe_definitions);
    }, true],
    ['violation has no probe', (atom) => {
      atom.probe_definitions[1].scenario = 'normal';
      atom.scenario_plan = scenarioPlan(atom.probe_definitions);
    }, true],
    ['recovery predecessor is not violation', (atom) => {
      atom.scenario_plan.recovery.predecessor_probe_ids = ['KERNEL-PROBE-P0-01-01-001'];
    }],
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
    first.scenario_plan.recovery.predecessor_probe_ids = [
      second.scenario_plan.violation.required_probe_ids[0],
    ];
    expectCode(
      contract([familyFixture('P0-01', [first, second])]),
      'atomic_scenario_requirement_invalid',
    );
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['array', ['kernel.owner']],
  ])('rejects %s single-effect owner', (_name, owner) => {
    const atom = activeAtom('P0-01', 1, 3, { single_effect_owner_seam: owner });
    expectCode(
      contract([familyFixture('P0-01', [atom])]),
      'atomic_single_effect_owner_seam_invalid',
    );
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
});

describe('retirement is P1-08 atom 01 with exact absence proof projection', () => {
  it('keeps the canonical retired atom in its real family and cutover remains false', () => {
    const input = contract([familyFixture('P1-08', [retiredAtom()])]);
    const output = validate(input);
    expect(output).toMatchObject({
      schema_valid: true,
      findings: [],
      atomic_cutover_ready: false,
      families: [{
        atoms: [{
          classification: 'retired',
          effective_status: 'retired',
          projection: 'na',
          retired_absence_probe_statuses: [
            { probe_id: 'KERNEL-PROBE-P1-08-01-A01', status: 'unverified' },
            { probe_id: 'KERNEL-PROBE-P1-08-01-A02', status: 'unverified' },
            { probe_id: 'KERNEL-PROBE-P1-08-01-A03', status: 'unverified' },
            { probe_id: 'KERNEL-PROBE-P1-08-01-A04', status: 'unverified' },
          ],
        }],
      }],
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
});
