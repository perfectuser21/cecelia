/**
 * Structured convergence signatures.
 *
 * These helpers intentionally ignore free-form feedback. Only server-observed
 * process fields and explicit string arrays are allowed to influence loop
 * termination.
 */

/** jsonb compatibility: pg returns objects while replay fixtures may use JSON strings. */
export function asStructuredJson(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

/**
 * Accept only a non-empty array of non-empty strings. Canonical form is
 * trimmed, de-duplicated and sorted so equivalent callbacks replay identically.
 */
export function normalizeFailureSignature(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const normalized = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    const trimmed = item.trim();
    if (!trimmed) return null;
    normalized.push(trimmed);
  }
  const canonical = [...new Set(normalized)].sort();
  return canonical.length > 0 ? canonical : null;
}

export function failureSignatureKey(value) {
  const normalized = normalizeFailureSignature(value);
  return normalized == null ? null : JSON.stringify(normalized);
}

// Product CI failures and evaluator/judge signatures share the same strict
// structured-set contract. Keep aliases so call sites state which evidence
// type they are handling without creating a second normalization scheme.
export const normalizeFailureSet = normalizeFailureSignature;
export const failureSetKey = failureSignatureKey;

function nonEmptyString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/**
 * Build a generator crash signature exclusively from server observations.
 * Explicit structured fields win; Docker/auth observations provide the
 * conservative fallback. A successful/unknown exit is not called a crash.
 */
export function generatorCrashSignature(lastAgentExit) {
  const exit = asStructuredJson(lastAgentExit);
  if (!exit || typeof exit !== 'object' || Array.isArray(exit)) return null;

  const code = Number.isFinite(Number(exit.code)) ? Number(exit.code) : null;
  const authFailed = exit.auth_failed === true;
  const explicitError = nonEmptyString(exit.error_code);
  const explicitClass = nonEmptyString(exit.failure_class);
  const hasCrashSignal = authFailed
    || explicitError != null
    || explicitClass != null
    || (code != null && code !== 0);
  if (!hasCrashSignal) return null;

  return {
    role: nonEmptyString(exit.role) ?? 'generator',
    error_code: explicitError ?? (authFailed ? 'auth_failed' : `exit_${code}`),
    failure_class: explicitClass ?? (authFailed ? 'auth_failure' : 'runtime_crash'),
  };
}

export function crashSignatureKey(value) {
  const signature = asStructuredJson(value);
  if (!signature || typeof signature !== 'object' || Array.isArray(signature)) return null;
  const role = nonEmptyString(signature.role);
  const errorCode = nonEmptyString(signature.error_code);
  const failureClass = nonEmptyString(signature.failure_class);
  if (!role || !errorCode || !failureClass) return null;
  return JSON.stringify({
    role,
    error_code: errorCode,
    failure_class: failureClass,
  });
}
