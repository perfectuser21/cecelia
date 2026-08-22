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

function exactClock(startedAt, timeoutSeconds, windowCount = 1) {
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds <= 0) {
    throw new Error('validation_clock_timeout_invalid');
  }
  const startedMs = new Date(startedAt).getTime();
  if (!Number.isFinite(startedMs)) throw new Error('validation_clock_invalid');
  return Object.freeze({
    pipeline_started_at: new Date(startedMs).toISOString(),
    deadline_at: new Date(startedMs + windowCount * timeoutSeconds * 1000).toISOString(),
  });
}

function persistedClock(row, timeoutSeconds, fixCount = 0) {
  const windowCount = 1 + fixCount;
  const detail = asObject(row?.detail);
  const hasStarted = detail.pipeline_started_at != null;
  const hasDeadline = detail.deadline_at != null;
  if (hasStarted || hasDeadline) {
    if (!hasStarted || !hasDeadline) throw new Error('validation_clock_invalid');
    const expected = exactClock(detail.pipeline_started_at, timeoutSeconds, windowCount);
    const startedMs = new Date(detail.pipeline_started_at).getTime();
    const deadlineMs = new Date(detail.deadline_at).getTime();
    if (!Number.isFinite(deadlineMs)) throw new Error('validation_clock_invalid');
    // 顺延容忍窗口：锚 detail 的 deadline_at 可能是任意历史/中间档 started + k*timeout
    // （k ∈ 1..(1+fixCount)）——在途/恢复 run 上一轮已写成顺延后值，不得误判 invalid。
    const persistedDeadline = new Date(deadlineMs).toISOString();
    let tolerated = false;
    for (let k = 1; k <= windowCount; k += 1) {
      if (new Date(startedMs + k * timeoutSeconds * 1000).toISOString() === persistedDeadline) {
        tolerated = true;
        break;
      }
    }
    if (!tolerated) throw new Error('validation_clock_invalid');
    return expected;
  }
  if (row?.created_at != null) return exactClock(row.created_at, timeoutSeconds, windowCount);
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
    // 锚 hop 之后每出现一次 spawn:generator-fix 即把验证窗顺延一个 timeoutSeconds。
    // 只计锚 hop（含）之后的 fix 行，且不把锚自身计入（锚建立基础窗，fix 才是顺延）。
    const anchorHop = Number(firstValidationOrigin.hop);
    const fixCount = decisionLog.filter((row) => (
      row?.action === 'spawn:generator-fix'
      && Number(row?.hop) >= anchorHop
      && row !== firstValidationOrigin
    )).length;
    return persistedClock(firstValidationOrigin, timeoutSeconds, fixCount);
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
