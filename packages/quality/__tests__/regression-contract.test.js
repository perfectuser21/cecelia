import { readdirSync, readFileSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { test, expect } from 'vitest';
import { validateAtomicContract } from '../../brain/src/lib/kernel-equivalence-atomic-contract.js';
import {
  FAMILY_CANONICAL_AXES,
  GOLDEN_PATH_STEP_CATALOG,
} from '../../brain/src/lib/kernel-equivalence-axes.js';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ROOT_CONTRACT_PATH = join(REPOSITORY_ROOT, 'regression-contract.yaml');
const EXPECTED_ATOMIC_METRICS = {
  behavior_count: 11,
  atomic_invariant_count: 43,
  proof_required_atomic_invariant_count: 42,
  probe_definition_count: 446,
  proof_required_probe_definition_count: 442,
  provider_probe_assertion_count: 1326,
  retired_absence_probe_count: 4,
};
const EXPECTED_VALIDATOR_METRICS = {
  ...EXPECTED_ATOMIC_METRICS,
  probe_outcome_authority: {
    appendix_explicit: 446,
    design_derived: 0,
    coverage_gap: 0,
  },
  recovery_mapping: {
    exact_binding_count: 56,
    derived_binding_count: 0,
    coverage_gap_count: 11,
  },
};
const EXPECTED_FAMILY_TOTALS = {
  'KERNEL-P0-01-BRANCH-PROTECTION': [4, 31],
  'KERNEL-P0-02-CREDENTIAL-GUARD': [3, 29],
  'KERNEL-P0-03-BRANCH-PUSH-GUARD': [4, 42],
  'KERNEL-P0-04-CI-MERGE-AUTHORITY': [4, 40],
  'KERNEL-P0-05-INDEPENDENT-EVALUATOR-JUDGE': [3, 25],
  'KERNEL-P0-06-HUMAN-REVIEW-AUTHORITY': [2, 34],
  'KERNEL-P0-07-RELEASE-PROMOTION': [5, 57],
  'KERNEL-P1-08-STOP-ORPHAN-LIVENESS': [5, 44],
  'KERNEL-P1-09-DEVGATE-TDD-DOD': [5, 71],
  'KERNEL-P1-10-CONTROLLER-SESSION-ISOLATION': [4, 40],
  'KERNEL-P1-11-REPORT-LEARNING-CLOSURE': [4, 33],
};

function readYaml(path) {
  return load(readFileSync(path, 'utf8'));
}

function rootBehaviorEquivalence() {
  const section = readYaml(ROOT_CONTRACT_PATH)?.behavior_equivalence;
  if (!section || typeof section !== 'object' || Array.isArray(section)) {
    throw new Error(
      'root regression-contract.yaml must define a top-level behavior_equivalence object',
    );
  }
  return section;
}

function declaredAtomicMetrics(section) {
  return {
    behavior_count: section.required_behavior_count,
    atomic_invariant_count: section.required_atomic_invariant_count,
    proof_required_atomic_invariant_count:
      section.proof_required_atomic_invariant_count,
    probe_definition_count: section.required_probe_definition_count,
    proof_required_probe_definition_count:
      section.proof_required_probe_definition_count,
    provider_probe_assertion_count:
      section.required_provider_probe_assertion_count,
    retired_absence_probe_count: section.required_retired_absence_probe_count,
  };
}

function deriveAtomicInventory(section) {
  const behaviors = section?.behaviors ?? [];
  const atoms = behaviors.flatMap((behavior) => behavior.atomic_invariants ?? []);
  const probes = atoms.flatMap((atom) => atom.probe_definitions ?? []);
  const proofRequiredAtoms = atoms.filter((atom) => atom.classification !== 'retired');
  const proofRequiredProbes = proofRequiredAtoms.flatMap(
    (atom) => atom.probe_definitions ?? [],
  );
  return {
    behaviors,
    atoms,
    probes,
    proofRequiredAtoms,
    proofRequiredProbes,
    absenceProbes: probes.filter((probe) => probe.scenario === 'absence'),
  };
}

function findPackageRegressionContracts(directory) {
  const matches = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name !== 'docs' && entry.name !== 'node_modules') {
        matches.push(...findPackageRegressionContracts(join(directory, entry.name)));
      }
      continue;
    }
    const filename = basename(entry.name).toLowerCase();
    if (
      entry.isFile()
      && filename.includes('regression-contract')
      && ['.yaml', '.yml'].includes(extname(filename))
    ) {
      matches.push(join(directory, entry.name));
    }
  }
  return matches.sort();
}

test('regression-contract 非空且字段齐全', () => {
  const c = load(readFileSync(new URL('../../../regression-contract.yaml', import.meta.url), 'utf8'));
  expect(Array.isArray(c.golden_paths)).toBe(true);
  expect(c.golden_paths.length).toBeGreaterThanOrEqual(1);
  for (const g of c.golden_paths) {
    for (const f of ['id', 'priority', 'trigger', 'method', 'test_command']) {
      expect(g[f]).toBeDefined();
    }
  }
});

test('regression-contract owns the complete Kernel behavior-equivalence inventory', () => {
  const c = load(readFileSync(new URL('../../../regression-contract.yaml', import.meta.url), 'utf8'));
  const section = c.behavior_equivalence;
  const expectedSteps = Array.from({ length: 13 }, (_, index) => `S${index}`);
  const expectedDimensions = [
    'fr',
    'nfr',
    'invariant',
    'checkpoint',
    'freshness',
    'death_alert',
    'failure_semantics',
    'effect_confirmation',
    'adversarial_surface',
    'ledger_freshness',
    'axis_alignment',
  ];
  const expectedProviders = ['claude', 'codex', 'grok'];
  const expectedScenarios = ['normal', 'violation', 'recovery'];
  const assertionIds = new Set(c.golden_paths.map((path) => path.id));

  expect(section).toBeDefined();
  expect(section.journey.steps.map((step) => step.id)).toEqual(expectedSteps);
  expect(section.dimensions).toEqual(expectedDimensions);
  expect(section.behaviors.length).toBeGreaterThanOrEqual(11);
  expect(new Set(section.behaviors.map((behavior) => behavior.priority))).toEqual(
    new Set(['P0', 'P1']),
  );

  for (const behavior of section.behaviors) {
    expect(['proven', 'gap', 'intentional_replacement']).toContain(behavior.status);
    expect(assertionIds.has(behavior.assertion_id)).toBe(true);
    expect(behavior.steps.length).toBeGreaterThan(0);
    expect(behavior.dimensions.length).toBeGreaterThan(0);
    expect(behavior.legacy_evidence.length).toBeGreaterThan(0);
    expect(behavior.unified_constructs.length).toBeGreaterThan(0);

    for (const provider of expectedProviders) {
      expect(behavior.proof_matrix[provider]).toBeDefined();
      for (const scenario of expectedScenarios) {
        expect(behavior.proof_matrix[provider][scenario]).toBeDefined();
      }
    }
  }
});

test('root behavior-equivalence declares the exact atomic schema 1.1 inventory totals', () => {
  const section = rootBehaviorEquivalence();

  expect.soft(section.schema_version).toBe('1.1.0');
  expect.soft(declaredAtomicMetrics(section)).toEqual(EXPECTED_ATOMIC_METRICS);
});

test('root atomic inventory derives globally unique family, invariant, and probe identities', () => {
  const {
    behaviors,
    atoms,
    probes,
  } = deriveAtomicInventory(rootBehaviorEquivalence());

  expect.soft(new Set(behaviors.map((behavior) => behavior.behavior_id)).size).toBe(11);
  expect.soft(new Set(atoms.map((atom) => atom.invariant_id)).size).toBe(43);
  expect.soft(new Set(probes.map((probe) => probe.probe_id)).size).toBe(446);
});

test('root atomic inventory derives exact classifications and proof-required totals', () => {
  const section = rootBehaviorEquivalence();
  const {
    behaviors,
    atoms,
    probes,
    proofRequiredAtoms,
    proofRequiredProbes,
    absenceProbes,
  } = deriveAtomicInventory(section);
  const classificationCounts = atoms.reduce((counts, atom) => {
    counts[atom.classification] = (counts[atom.classification] ?? 0) + 1;
    return counts;
  }, {
    active_required: 0,
    drifted_required_gap: 0,
    intentional_replacement: 0,
    retired: 0,
  });
  const actualMetrics = {
    behavior_count: behaviors.length,
    atomic_invariant_count: atoms.length,
    proof_required_atomic_invariant_count: proofRequiredAtoms.length,
    probe_definition_count: probes.length,
    proof_required_probe_definition_count: proofRequiredProbes.length,
    provider_probe_assertion_count: proofRequiredProbes.length * 3,
    retired_absence_probe_count: absenceProbes.length,
  };

  expect.soft(classificationCounts).toEqual({
    active_required: 17,
    drifted_required_gap: 23,
    intentional_replacement: 2,
    retired: 1,
  });
  expect.soft(actualMetrics).toEqual(EXPECTED_ATOMIC_METRICS);
  expect(actualMetrics).toEqual(declaredAtomicMetrics(section));
});

test('every canonical family owns its exact atom and probe totals by full behavior ID', () => {
  const { behaviors } = deriveAtomicInventory(rootBehaviorEquivalence());
  const actualFamilyTotals = Object.fromEntries(
    behaviors.map((behavior) => {
      const atoms = behavior.atomic_invariants ?? [];
      return [
        behavior.behavior_id,
        [
          atoms.length,
          atoms.reduce(
            (total, atom) => total + (atom.probe_definitions ?? []).length,
            0,
          ),
        ],
      ];
    }),
  );

  expect(actualFamilyTotals).toEqual(EXPECTED_FAMILY_TOTALS);
});

test('root journey uses the exact S0-S12 canonical ID and name catalog', () => {
  const section = rootBehaviorEquivalence();

  expect(section.journey?.steps ?? []).toEqual(GOLDEN_PATH_STEP_CATALOG);
});

test('every root family uses its canonical steps and dimensions by behavior ID', () => {
  const { behaviors } = deriveAtomicInventory(rootBehaviorEquivalence());
  const actualAxes = Object.fromEntries(
    behaviors.map((behavior) => [
      behavior.behavior_id,
      {
        steps: behavior.steps,
        dimensions: behavior.dimensions,
      },
    ]),
  );

  expect(actualAxes).toEqual(FAMILY_CANONICAL_AXES);
});

test('the real root atomic contract validates cleanly but remains pre-cutover', () => {
  const output = validateAtomicContract(rootBehaviorEquivalence());

  expect.soft(output.schema_valid).toBe(true);
  expect.soft(output.findings).toEqual([]);
  expect.soft(output.metrics).toEqual(EXPECTED_VALIDATOR_METRICS);
  expect(output.atomic_cutover_ready).toBe(false);
});

test('root is the only repository SSOT for behavior-equivalence inventory', () => {
  const rootContract = readYaml(ROOT_CONTRACT_PATH);
  const packageContracts = findPackageRegressionContracts(
    join(REPOSITORY_ROOT, 'packages'),
  );
  const relativePackageContracts = packageContracts.map(
    (path) => relative(REPOSITORY_ROOT, path),
  );
  const duplicateSsots = packageContracts
    .filter((path) => Object.hasOwn(readYaml(path), 'behavior_equivalence'))
    .map((path) => relative(REPOSITORY_ROOT, path));
  const engineContractPath = join(
    REPOSITORY_ROOT,
    'packages/engine/regression-contract.yaml',
  );
  const engineContract = readYaml(engineContractPath);

  expect.soft(rootContract.behavior_equivalence).toBeDefined();
  expect.soft(relativePackageContracts).toContain(
    'packages/engine/regression-contract.yaml',
  );
  expect.soft(duplicateSsots).toEqual([]);
  expect.soft(engineContract.behavior_equivalence).toBeUndefined();
  expect(engineContract.hooks).toBeDefined();
});
