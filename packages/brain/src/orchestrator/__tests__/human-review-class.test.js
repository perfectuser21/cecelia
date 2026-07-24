import { describe, expect, it } from 'vitest';

import {
  HUMAN_REVIEW_CLASS,
  reviewClassForReason,
} from '../human-review-class.js';

describe('human-review-class', () => {
  it('classifies only the final merge gate as merge_gate', () => {
    expect(reviewClassForReason('awaiting_human_review')).toBe(HUMAN_REVIEW_CLASS.MERGE_GATE);
    expect(reviewClassForReason('unknown:missing_failure_class')).not.toBe(HUMAN_REVIEW_CLASS.MERGE_GATE);
  });

  it.each([
    ['evidence_invalid:repeated_signature', HUMAN_REVIEW_CLASS.EVIDENCE_REPAIR],
    ['unknown:missing_failure_signature', HUMAN_REVIEW_CLASS.EVIDENCE_REPAIR],
    ['failure_set_repeated', HUMAN_REVIEW_CLASS.CONVERGENCE],
    ['failure_set_patience_exhausted', HUMAN_REVIEW_CLASS.CONVERGENCE],
    ['unknown:missing_failure_class', HUMAN_REVIEW_CLASS.DIAGNOSTIC],
    [null, HUMAN_REVIEW_CLASS.DIAGNOSTIC],
  ])('maps review reason %j to %s', (reason, expectedClass) => {
    expect(reviewClassForReason(reason)).toBe(expectedClass);
  });
});
