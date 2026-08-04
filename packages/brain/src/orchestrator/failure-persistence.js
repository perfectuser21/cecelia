const MAX_DIAGNOSTIC_LENGTH = 2_000;
const SECRET_KEY_PATTERN = [
  'HARNESS_CALLBACK_TOKEN',
  'KERNEL_FLEET_BRIDGE_TOKEN',
  'callback[_ -]?token',
  'shared[_ -]?(?:secret|token)',
  'token',
  'secret',
  'password',
].join('|');
const QUOTED_SECRET_ASSIGNMENT = new RegExp(
  `((?:["']?)(?:${SECRET_KEY_PATTERN})(?:["']?)\\s*(?:=|:)\\s*)(["'])(.*?)\\2`,
  'gi',
);
const BARE_SECRET_ASSIGNMENT = new RegExp(
  `((?:["']?)(?:${SECRET_KEY_PATTERN})(?:["']?)\\s*(?:=|:)\\s*)([^\\s,;}]+)`,
  'gi',
);

export function errorMessage(error) {
  return error?.message ?? String(error);
}

/**
 * 只做 secret 脱敏，不折行、不截断——诊断日志（sanitizeDiagnostic）和案卷式
 * GAN 的 feedback_md/blockers（attempt-store.js sanitizeCaseFileValue）复用
 * 同一份正则，但后者需要保留完整反馈原文的换行与长度，不能套用诊断日志的
 * "折叠成一行 + 砍到 2000 字符" 那套（review CHANGES REQUESTED P2-4 复审）。
 */
export function redactSecrets(value) {
  return String(value ?? 'unknown')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(QUOTED_SECRET_ASSIGNMENT, '$1$2[REDACTED]$2')
    .replace(BARE_SECRET_ASSIGNMENT, '$1[REDACTED]');
}

export function sanitizeDiagnostic(value) {
  const folded = String(value ?? 'unknown').replace(/[\r\n\t]+/g, ' ');
  return redactSecrets(folded).slice(0, MAX_DIAGNOSTIC_LENGTH);
}

function sanitizedError(error) {
  const sanitized = new Error(sanitizeDiagnostic(errorMessage(error)));
  if (error?.code) sanitized.code = error.code;
  return sanitized;
}

export function buildFailurePersistenceEvidence({
  attemptId,
  lifecycleCode,
  originalError,
  persistenceError,
}) {
  const lifecycleDiagnostic = sanitizeDiagnostic(errorMessage(originalError));
  const persistenceDiagnostic = sanitizeDiagnostic(errorMessage(persistenceError));
  return {
    alert: {
      kind: 'failure_persistence',
      attemptId,
      lifecycleCode,
      originalError,
      persistenceError,
    },
    errors: [
      sanitizedError(originalError),
      sanitizedError(persistenceError),
    ],
    message: `${lifecycleDiagnostic}; failure_persistence_failed: ${persistenceDiagnostic}`,
  };
}

export function aggregateFailureEvidence(evidence, additionalErrors = []) {
  return new AggregateError(
    [
      ...evidence.flatMap((entry) => entry.errors),
      ...additionalErrors.map(sanitizedError),
    ],
    [
      ...evidence.map((entry) => entry.message),
      ...additionalErrors.map((error) => sanitizeDiagnostic(errorMessage(error))),
    ].join('; '),
  );
}

export async function failurePersistenceError(deps, params) {
  const evidence = buildFailurePersistenceEvidence(params);
  const alertErrors = [];
  try {
    await deps.onFailurePersistenceFailed?.(evidence.alert);
  } catch {
    alertErrors.push(new Error('failure_persistence_alert_failed'));
  }
  return aggregateFailureEvidence([evidence], alertErrors);
}
