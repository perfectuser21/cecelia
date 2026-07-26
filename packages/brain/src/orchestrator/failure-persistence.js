const MAX_DIAGNOSTIC_LENGTH = 2_000;

export function errorMessage(error) {
  return error?.message ?? String(error);
}

export function sanitizeDiagnostic(value) {
  return String(value ?? 'unknown')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\b(token|secret|password)=\S+/gi, '$1=[REDACTED]')
    .slice(0, MAX_DIAGNOSTIC_LENGTH);
}

export async function failurePersistenceError(deps, {
  attemptId,
  lifecycleCode,
  originalError,
  persistenceError,
}) {
  const errors = [originalError, persistenceError];
  let alertDiagnostic = '';
  try {
    await deps.onFailurePersistenceFailed?.({
      kind: 'failure_persistence',
      attemptId,
      lifecycleCode,
      originalError,
      persistenceError,
    });
  } catch {
    errors.push(new Error('failure_persistence_alert_failed'));
    alertDiagnostic = '; failure_persistence_alert_failed';
  }
  return new AggregateError(
    errors,
    `${errorMessage(originalError)}; failure_persistence_failed: `
      + `${errorMessage(persistenceError)}${alertDiagnostic}`,
  );
}
