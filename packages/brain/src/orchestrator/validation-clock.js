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

// deadline 原点顺延上限：健康长跑 run 每轮 spawn:generator-fix 把 deadline 原点前推，
// 但最多 6 次；出现第 7 次及以后的 fix 时原点冻结在第 6 次 fix，deadline 照常到点判死。
const MAX_FIX_EXTENSIONS = 6;

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

function isExistingPrEvaluatorOrigin(row) {
  return (
    row?.action === 'spawn:evaluator'
    && asObject(row?.detail).validation_origin === VERIFIED_EXISTING_PR_ORIGIN
  );
}

export function resolveValidationClock({
  action,
  decisionLog = [],
  intentAt,
  timeoutSeconds,
  allowEvaluatorOrigin = false,
  maxFixExtensions = MAX_FIX_EXTENSIONS,
}) {
  if (!VALIDATION_ACTIONS.has(action)) return null;
  const firstValidationOrigin = [...decisionLog]
    .filter((row) => (
      GENERATOR_ACTIONS.has(row?.action)
      || isExistingPrEvaluatorOrigin(row)
    ))
    .sort((a, b) => Number(a.hop) - Number(b.hop))[0];
  if (firstValidationOrigin) {
    // existing-PR evaluator origin 复用路径不受 fix 顺延影响（[existing-PR-clock] 铁律）。
    if (!isExistingPrEvaluatorOrigin(firstValidationOrigin)) {
      // 顺延：deadline 原点 = 最近一次成功派发的 spawn:generator-fix 行时间（按 hop 时序），
      // 有界 maxFixExtensions（6）次——超限时冻结在第 6 次 fix，不再前进。
      // 只依赖行的 created_at 时序，忽略被污染的持久化 detail（纯可重放）。
      const fixRows = decisionLog
        .filter((row) => row?.action === 'spawn:generator-fix')
        .sort((a, b) => Number(a.hop) - Number(b.hop));
      if (fixRows.length > 0) {
        const boundedIndex = Math.min(fixRows.length, maxFixExtensions) - 1;
        return exactClock(fixRows[boundedIndex].created_at, timeoutSeconds);
      }
    }
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
