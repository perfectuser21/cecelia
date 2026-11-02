// 合同声明、执行自述、独立验收三个来源分开保存，不从一次成功推导成熟度。
export const QUESTION_KEYS = Object.freeze(['A1','A2','A3','A4','A5','A6','B1','C1','C2','C3']);
const SECRET_KEY = /password|secret|token|api[_-]?key|authorization|credential/i;
const SECRET_TEXT = /\bBearer\s+\S+|(?:postgres(?:ql)?|https?):\/\/[^\s/@:]+:[^\s/@]+@|\b(?:password|secret|api[_-]?key|access[_-]?token)\s*[=:]\s*\S+/ig;

export function sanitized(value, depth = 0) {
  if (depth > 16) return '[depth_limit]';
  if (value === undefined) return null;
  if (typeof value === 'string') return value.replace(SECRET_TEXT, '[redacted]').slice(0, 8192);
  if (Array.isArray(value)) return value.slice(0, 200).map(v => sanitized(v, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 200)
    .filter(([k]) => !['__proto__','constructor','prototype','stdout','stderr'].includes(k))
    .map(([k, v]) => [k, SECRET_KEY.test(k) ? '[redacted]' : sanitized(v, depth + 1)]));
  return value;
}

export function activityQuestions(metadata, attempt = {}, validation = null, context = {}) {
  const observations = attempt.observations ?? attempt.outputs?.observations ?? {};
  return Object.fromEntries(QUESTION_KEYS.map(key => {
    const declaration = metadata.questions?.[key];
    let actual = null, source = null;
    if (key === 'A2' && Object.hasOwn(context, 'input')) {
      actual = { input: sanitized(context.input) }; source = 'runtime_input';
    } else if (key === 'A3' && Object.hasOwn(attempt, 'outputs')) {
      actual = { outputs: sanitized(attempt.outputs), evidence: sanitized(attempt.evidence ?? []) }; source = 'executor_reported';
    } else if (key === 'A5' && context.started_at && context.ended_at) {
      actual = { budget: sanitized(context.budget), duration_ms: new Date(context.ended_at) - new Date(context.started_at) }; source = 'runtime_observation';
    } else if (key === 'A6' && attempt.status) {
      actual = { status: attempt.status, failure_class: attempt.failure_class ?? null, reason_code: attempt.reason_code ?? null,
        attempt: attempt.attempt ?? context.attempt ?? 1, retries_observed: Math.max(0, (attempt.attempt ?? context.attempt ?? 1) - 1) }; source = 'runtime_result';
    } else if (key === 'B1' && context.execution_invoked !== false && metadata.implementation) {
      actual = sanitized(metadata.implementation); source = 'trusted_profile';
    } else if (key === 'C2' && validation?.executor) {
      actual = { executor: sanitized(validation.executor), verdict: validation.verdict, evidence: sanitized(validation.evidence ?? []) }; source = 'independent_validator';
    } else if (key === 'C3' && context.run_id) {
      actual = sanitized({ ...context, execution_status: attempt.status ?? null, evidence: attempt.evidence ?? [], identity: metadata.identity ?? null }); source = 'runtime_observation';
    } else if (key === 'A4') {
      if (validation && declaration?.ref && validation.acceptance_ref === declaration.ref
        && ['pass','fail'].includes(validation.verdict) && Array.isArray(validation.evidence) && validation.evidence.length) {
        actual = { verdict: validation.verdict, evidence: sanitized(validation.evidence) }; source = 'independent_validator';
      }
    } else if (key !== 'C1' && observations[key] !== undefined && observations[key] !== null) {
      // 不允许执行器自行将声明/建议升级为观察。自述必须带实际证据，仍标记来源。
      const row = observations[key];
      if (row && typeof row === 'object' && Object.hasOwn(row, 'actual')
        && row.actual !== null && Array.isArray(row.evidence) && row.evidence.length) {
        actual = sanitized(row); source = 'executor_reported';
      }
    }
    return [key, { ref: declaration?.ref ?? null, version: declaration?.version ?? null,
      declared: sanitized(declaration?.declared), actual, status: actual === null ? 'unknown' : 'observed', source,
      completeness: actual === null ? 'unknown' : 'partial', supported_fields: actual && typeof actual === 'object' ? Object.keys(actual) : [],
      ...(key === 'C1' && observations[key] ? { candidate: sanitized(observations[key]), self_reported: true } : {}) }];
  }));
}

export function reportedSteps(attempt = {}) {
  const rows = attempt.steps ?? attempt.outputs?.steps;
  return Array.isArray(rows) ? { status: 'observed', reported: rows.map(row => {
    const value = row && typeof row === 'object' ? sanitized(row) : { value: sanitized(row) };
    return { ...value, self_reported: true, fields: Object.fromEntries(['action','evidence','on_failure','executor','side_effect']
      .map(field => [field, { status: Object.hasOwn(value, field) ? 'observed' : 'unknown', actual: value[field] ?? null }])) };
  }) } : { status: 'unknown', reported: [] };
}

export function actualAttempt(receipt, event) {
  const activity = receipt?.activities?.findLast(row => row.key === event.activity
    && JSON.stringify(row.item ?? null) === JSON.stringify(event.item ?? null));
  const attempt = activity?.attempts?.findLast(row => row.attempt === (event.attempt ?? 1));
  if (!attempt) throw new Error('activity_attempt_missing');
  return attempt;
}
