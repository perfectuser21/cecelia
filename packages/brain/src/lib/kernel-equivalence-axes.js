function freezeAxisDescriptor({ steps, dimensions }) {
  return Object.freeze({
    steps: Object.freeze([...steps]),
    dimensions: Object.freeze([...dimensions]),
  });
}

export const GOLDEN_PATH_STEP_CATALOG = Object.freeze([
  Object.freeze({ id: 'S0', name: 'Task Born' }),
  Object.freeze({ id: 'S1', name: 'Intent / PrepPRD' }),
  Object.freeze({ id: 'S2', name: 'Planner' }),
  Object.freeze({ id: 'S3', name: 'Contract GAN' }),
  Object.freeze({ id: 'S4', name: 'Generator' }),
  Object.freeze({ id: 'S5', name: 'CI' }),
  Object.freeze({ id: 'S6', name: 'Evaluator' }),
  Object.freeze({ id: 'S7', name: 'Independent Judge' }),
  Object.freeze({ id: 'S8', name: 'Risk-based Human Review' }),
  Object.freeze({ id: 'S9', name: 'Merge' }),
  Object.freeze({ id: 'S10', name: 'Staging' }),
  Object.freeze({ id: 'S11', name: 'Production' }),
  Object.freeze({ id: 'S12', name: 'Report / Learning / Complete' }),
]);

export const GOLDEN_PATH_STEPS = Object.freeze(
  GOLDEN_PATH_STEP_CATALOG.map(({ id }) => id),
);

export const BEHAVIOR_DIMENSIONS = Object.freeze([
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
]);

export const PROOF_PROVIDERS = Object.freeze(['claude', 'codex', 'grok']);
export const PROOF_SCENARIOS = Object.freeze(['normal', 'violation', 'recovery']);

export const FAMILY_CANONICAL_AXES = Object.freeze({
  'KERNEL-P0-01-BRANCH-PROTECTION': freezeAxisDescriptor({
    steps: ['S4'],
    dimensions: [
      'nfr',
      'invariant',
      'checkpoint',
      'failure_semantics',
      'effect_confirmation',
      'adversarial_surface',
    ],
  }),
  'KERNEL-P0-02-CREDENTIAL-GUARD': freezeAxisDescriptor({
    steps: ['S0', 'S4', 'S12'],
    dimensions: [
      'nfr',
      'invariant',
      'checkpoint',
      'freshness',
      'failure_semantics',
      'effect_confirmation',
      'adversarial_surface',
      'ledger_freshness',
    ],
  }),
  'KERNEL-P0-03-BRANCH-PUSH-GUARD': freezeAxisDescriptor({
    steps: ['S4', 'S5', 'S9'],
    dimensions: [
      'fr',
      'nfr',
      'invariant',
      'checkpoint',
      'freshness',
      'failure_semantics',
      'effect_confirmation',
      'adversarial_surface',
      'ledger_freshness',
    ],
  }),
  'KERNEL-P0-04-CI-MERGE-AUTHORITY': freezeAxisDescriptor({
    steps: ['S5', 'S6', 'S7', 'S8', 'S9'],
    dimensions: [
      'fr',
      'nfr',
      'invariant',
      'checkpoint',
      'freshness',
      'failure_semantics',
      'effect_confirmation',
      'adversarial_surface',
      'ledger_freshness',
      'axis_alignment',
    ],
  }),
  'KERNEL-P0-05-INDEPENDENT-EVALUATOR-JUDGE': freezeAxisDescriptor({
    steps: ['S5', 'S6', 'S7', 'S9'],
    dimensions: [
      'fr',
      'nfr',
      'invariant',
      'checkpoint',
      'freshness',
      'failure_semantics',
      'effect_confirmation',
      'adversarial_surface',
      'ledger_freshness',
      'axis_alignment',
    ],
  }),
  'KERNEL-P0-06-HUMAN-REVIEW-AUTHORITY': freezeAxisDescriptor({
    steps: ['S8', 'S9'],
    dimensions: [
      'fr',
      'nfr',
      'invariant',
      'checkpoint',
      'freshness',
      'failure_semantics',
      'effect_confirmation',
      'adversarial_surface',
      'ledger_freshness',
      'axis_alignment',
    ],
  }),
  'KERNEL-P0-07-RELEASE-PROMOTION': freezeAxisDescriptor({
    steps: ['S9', 'S10', 'S11', 'S12'],
    dimensions: [
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
    ],
  }),
  'KERNEL-P1-08-STOP-ORPHAN-LIVENESS': freezeAxisDescriptor({
    steps: ['S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11', 'S12'],
    dimensions: [
      'nfr',
      'invariant',
      'checkpoint',
      'freshness',
      'death_alert',
      'failure_semantics',
      'effect_confirmation',
      'adversarial_surface',
      'ledger_freshness',
    ],
  }),
  'KERNEL-P1-09-DEVGATE-TDD-DOD': freezeAxisDescriptor({
    steps: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'],
    dimensions: [
      'fr',
      'nfr',
      'invariant',
      'checkpoint',
      'freshness',
      'failure_semantics',
      'effect_confirmation',
      'adversarial_surface',
      'axis_alignment',
    ],
  }),
  'KERNEL-P1-10-CONTROLLER-SESSION-ISOLATION': freezeAxisDescriptor({
    steps: ['S0', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S12'],
    dimensions: [
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
    ],
  }),
  'KERNEL-P1-11-REPORT-LEARNING-CLOSURE': freezeAxisDescriptor({
    steps: ['S1', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11', 'S12'],
    dimensions: [
      'fr',
      'nfr',
      'invariant',
      'checkpoint',
      'freshness',
      'failure_semantics',
      'effect_confirmation',
      'ledger_freshness',
      'axis_alignment',
    ],
  }),
});

export const ATOMIC_CONTRACT_COUNTS = Object.freeze({
  behavior_count: 11,
  atomic_invariant_count: 43,
  proof_required_atomic_invariant_count: 42,
  probe_definition_count: 446,
  proof_required_probe_definition_count: 442,
  provider_probe_assertion_count: 1326,
  retired_absence_probe_count: 4,
});
