const VALIDATION_ACTIONS = new Set([
  'spawn:generator',
  'spawn:generator-fix',
  'spawn:evaluator',
  'spawn:evaluator-evidence-repair',
  'spawn:judge',
]);

const GENERATOR_ACTIONS = new Set([
  'spawn:generator',
  'spawn:generator-fix',
]);

export const VERIFIED_EXISTING_PR_ORIGIN = 'verified_existing_pr';

function asObject(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

function exactClock(startedAt, timeoutSeconds) {
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds <= 0) {
    throw new Error('validation_clock_timeout_invalid');
  }
  const startedMs = new Date(startedAt).getTime();
  if (!Number.isFinite(startedMs)) throw new Error('validation_clock_invalid');
  return Object.freeze({
    pipeline_started_at: new Date(startedMs).toISOString(),
    deadline_at: new Date(startedMs + timeoutSeconds * 1000).toISOString(),
  });
}

function persistedClock(row, timeoutSeconds) {
  const detail = asObject(row?.detail);
  const hasStarted = detail.pipeline_started_at != null;
  const hasDeadline = detail.deadline_at != null;
  if (hasStarted || hasDeadline) {
    if (!hasStarted || !hasDeadline) throw new Error('validation_clock_invalid');
    const expected = exactClock(detail.pipeline_started_at, timeoutSeconds);
    const deadlineMs = new Date(detail.deadline_at).getTime();
    if (
      !Number.isFinite(deadlineMs)
      || expected.deadline_at !== new Date(deadlineMs).toISOString()
    ) {
      throw new Error('validation_clock_invalid');
    }
    return expected;
  }
  if (row?.created_at != null) return exactClock(row.created_at, timeoutSeconds);
  throw new Error('validation_clock_invalid');
}

export function resolveValidationClock({
  action,
  decisionLog = [],
  intentAt,
  timeoutSeconds,
  allowEvaluatorOrigin = false,
}) {
  if (!VALIDATION_ACTIONS.has(action)) return null;
  const firstValidationOrigin = [...decisionLog]
    .filter((row) => (
      GENERATOR_ACTIONS.has(row?.action)
      || (
        row?.action === 'spawn:evaluator'
        && asObject(row?.detail).validation_origin === VERIFIED_EXISTING_PR_ORIGIN
      )
    ))
    .sort((a, b) => Number(a.hop) - Number(b.hop))[0];
  if (firstValidationOrigin) {
    return persistedClock(firstValidationOrigin, timeoutSeconds);
  }
  if (action === 'spawn:evaluator' && allowEvaluatorOrigin === true) {
    return exactClock(intentAt, timeoutSeconds);
  }
  if (!GENERATOR_ACTIONS.has(action)) {
    throw new Error('validation_clock_required');
  }
  return exactClock(intentAt, timeoutSeconds);
}

export const __test__ = Object.freeze({
  VALIDATION_ACTIONS,
  GENERATOR_ACTIONS,
  VERIFIED_EXISTING_PR_ORIGIN,
});
