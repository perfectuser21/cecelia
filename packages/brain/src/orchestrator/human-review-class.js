export const HUMAN_REVIEW_CLASS = Object.freeze({
  MERGE_GATE: 'merge_gate',
  EVIDENCE_REPAIR: 'evidence_repair',
  CONVERGENCE: 'convergence',
  DIAGNOSTIC: 'diagnostic',
});

const EVIDENCE_REASONS = new Set([
  'evidence_invalid:repeated_signature',
  'unknown:missing_failure_signature',
]);

const CONVERGENCE_REASONS = new Set([
  'failure_set_repeated',
  'failure_set_patience_exhausted',
]);

export function reviewClassForReason(reason) {
  if (reason === 'awaiting_human_review') {
    return HUMAN_REVIEW_CLASS.MERGE_GATE;
  }
  if (EVIDENCE_REASONS.has(reason)) {
    return HUMAN_REVIEW_CLASS.EVIDENCE_REPAIR;
  }
  if (CONVERGENCE_REASONS.has(reason)) {
    return HUMAN_REVIEW_CLASS.CONVERGENCE;
  }
  return HUMAN_REVIEW_CLASS.DIAGNOSTIC;
}
