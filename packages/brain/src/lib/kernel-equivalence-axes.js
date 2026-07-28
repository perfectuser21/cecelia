export const GOLDEN_PATH_STEPS = Object.freeze(
  Array.from({ length: 13 }, (_, index) => `S${index}`),
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
