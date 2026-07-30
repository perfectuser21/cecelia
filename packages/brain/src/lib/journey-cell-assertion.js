const TEST_PATH_PATTERNS = [
  /^tests\//,
  /\/tests\//,
  /(^|\/)test_[^/]+\.py$/,
  /\.(?:test|spec)\.[cm]?[jt]sx?$/,
  /\/smoke\/[^/]+\.sh$/,
];

/**
 * Classify a Golden Path cell assertion without implying verification.
 *
 * A semantic anchor is useful for tracing but is intentionally not runnable.
 * Unknown prose remains missing so a colored cell cannot hide behind free text.
 */
export function classifyJourneyCellAssertion({ assertion_ref: assertionRef, na_reason: naReason } = {}) {
  const ref = typeof assertionRef === 'string' ? assertionRef.trim() : '';
  const na = typeof naReason === 'string' ? naReason.trim() : '';

  if (!ref) {
    if (na) {
      return {
        assertion_state: 'not_applicable',
        runnable: false,
        needs_assertion: false,
      };
    }
    return {
      assertion_state: 'missing',
      runnable: false,
      needs_assertion: true,
    };
  }

  if (ref.startsWith('manual:')) {
    return { assertion_state: 'manual', runnable: true, needs_assertion: false };
  }
  if (ref.startsWith('eval:')) {
    return { assertion_state: 'evaluation', runnable: false, needs_assertion: false };
  }
  if (ref.startsWith('decision:')) {
    return { assertion_state: 'decision', runnable: false, needs_assertion: false };
  }
  if (TEST_PATH_PATTERNS.some(pattern => pattern.test(ref))) {
    return { assertion_state: 'test', runnable: true, needs_assertion: false };
  }

  return {
    assertion_state: 'unknown',
    runnable: false,
    needs_assertion: true,
  };
}
