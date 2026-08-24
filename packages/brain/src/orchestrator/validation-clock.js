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

// r69：validation clock 按 fix 轮有界顺延。每个新出现的 spawn:generator-fix 行
// 成为新的 clock 原点（deadline 随之前移），顺延有界，上限 6 次——第 7 次及以后
// 的 fix 不再前移原点，deadline 停在第 6 个 fix 的锚点，超界后照常判死。
const MAX_FIX_EXTENSIONS = 6;

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
  // r69：已出现在 decision-log 中的 generator-fix 行按 hop 时序排序后，锚点前移到
  // 第 min(N, 6) 个 fix 行的持久化时间（顺延有界）。无 fix 行时保持原语义。
  const fixRows = [...decisionLog]
    .filter((row) => row?.action === 'spawn:generator-fix')
    .sort((a, b) => Number(a.hop) - Number(b.hop));
  if (fixRows.length > 0) {
    const anchor = fixRows[Math.min(fixRows.length, MAX_FIX_EXTENSIONS) - 1];
    return persistedClock(anchor, timeoutSeconds);
  }
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
