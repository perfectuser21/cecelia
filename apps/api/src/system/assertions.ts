/**
 * Boundary Assertions Module
 * Phase 4.4: 自动执法 (Automatic Enforcement)
 *
 * Validates data integrity at system boundaries:
 * - trace_id format validation
 * - evidence task_id association
 * - memory payload JSON validation
 */

// Trace ID format: trc_YYYYMMDD_HHMMSS_xxxxxx
const TRACE_ID_REGEX = /^trc_\d{8}_\d{6}_[a-z0-9]{6}$/;

export interface AssertionResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface AssertionStats {
  total: number;
  passed: number;
  failed: number;
  lastRun: Date | null;
}

// Global stats
let stats: AssertionStats = {
  total: 0,
  passed: 0,
  failed: 0,
  lastRun: null,
};

/**
 * Validate trace_id format
 * Format: trc_YYYYMMDD_HHMMSS_xxxxxx
 */
export function validateTraceId(traceId: string | undefined | null): AssertionResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  stats.total++;
  stats.lastRun = new Date();

  if (!traceId) {
    errors.push('trace_id is required');
    stats.failed++;
    return { valid: false, errors, warnings };
  }

  if (typeof traceId !== 'string') {
    errors.push('trace_id must be a string');
    stats.failed++;
    return { valid: false, errors, warnings };
  }

  if (!TRACE_ID_REGEX.test(traceId)) {
    errors.push(`trace_id format invalid: expected trc_YYYYMMDD_HHMMSS_xxxxxx, got "${traceId}"`);
    stats.failed++;
    return { valid: false, errors, warnings };
  }

  // Extract and validate date components
  const parts = traceId.split('_');
  const dateStr = parts[1]; // YYYYMMDD
  const timeStr = parts[2]; // HHMMSS

  const year = parseInt(dateStr.substring(0, 4), 10);
  const month = parseInt(dateStr.substring(4, 6), 10);
  const day = parseInt(dateStr.substring(6, 8), 10);
  const hour = parseInt(timeStr.substring(0, 2), 10);
  const minute = parseInt(timeStr.substring(2, 4), 10);
  const second = parseInt(timeStr.substring(4, 6), 10);

  // Basic range validation
  if (month < 1 || month > 12) {
    warnings.push(`trace_id month out of range: ${month}`);
  }
  if (day < 1 || day > 31) {
    warnings.push(`trace_id day out of range: ${day}`);
  }
  if (hour > 23) {
    warnings.push(`trace_id hour out of range: ${hour}`);
  }
  if (minute > 59) {
    warnings.push(`trace_id minute out of range: ${minute}`);
  }
  if (second > 59) {
    warnings.push(`trace_id second out of range: ${second}`);
  }

  // Check if date is not too far in the future
  const traceDate = new Date(year, month - 1, day, hour, minute, second);
  const now = new Date();
  const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
  if (traceDate > oneHourFromNow) {
    warnings.push(`trace_id date is in the future: ${traceDate.toISOString()}`);
  }

  stats.passed++;
  return { valid: true, errors, warnings };
}

/**
 * Validate evidence data
 * - task_id must be present
 * - type must be valid
 */
export function validateEvidence(evidence: any): AssertionResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  stats.total++;
  stats.lastRun = new Date();

  if (!evidence) {
    errors.push('evidence is required');
    stats.failed++;
    return { valid: false, errors, warnings };
  }

  if (typeof evidence !== 'object') {
    errors.push('evidence must be an object');
    stats.failed++;
    return { valid: false, errors, warnings };
  }

  // task_id validation
  if (!evidence.task_id) {
    errors.push('evidence.task_id is required');
  } else if (typeof evidence.task_id !== 'string') {
    errors.push('evidence.task_id must be a string');
  }

  // type validation
  const validTypes = ['execution', 'verification', 'decision', 'artifact', 'metric'];
  if (!evidence.type) {
    errors.push('evidence.type is required');
  } else if (!validTypes.includes(evidence.type)) {
    warnings.push(`evidence.type "${evidence.type}" is not standard. Valid types: ${validTypes.join(', ')}`);
  }

  // content validation
  if (evidence.content === undefined) {
    warnings.push('evidence.content is recommended');
  }

  if (errors.length > 0) {
    stats.failed++;
    return { valid: false, errors, warnings };
  }

  stats.passed++;
  return { valid: true, errors, warnings };
}

/**
 * Validate memory payload
 * - Must be valid JSON
 * - Must have key and value
 */
export function validateMemoryPayload(payload: any): AssertionResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  stats.total++;
  stats.lastRun = new Date();

  if (payload === undefined || payload === null) {
    errors.push('memory payload is required');
    stats.failed++;
    return { valid: false, errors, warnings };
  }

  // If string, try to parse as JSON
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      errors.push('memory payload is not valid JSON');
      stats.failed++;
      return { valid: false, errors, warnings };
    }
  }

  if (typeof payload !== 'object') {
    errors.push('memory payload must be an object');
    stats.failed++;
    return { valid: false, errors, warnings };
  }

  // key validation
  if (!payload.key) {
    errors.push('memory payload.key is required');
  } else if (typeof payload.key !== 'string') {
    errors.push('memory payload.key must be a string');
  } else if (payload.key.length > 255) {
    warnings.push('memory payload.key exceeds 255 characters');
  }

  // value validation
  if (payload.value === undefined) {
    errors.push('memory payload.value is required');
  }

  // Try to serialize value to ensure it's JSON-compatible
  try {
    JSON.stringify(payload.value);
  } catch {
    errors.push('memory payload.value is not JSON-serializable');
  }

  if (errors.length > 0) {
    stats.failed++;
    return { valid: false, errors, warnings };
  }

  stats.passed++;
  return { valid: true, errors, warnings };
}

/**
 * Run all assertions on a complete payload
 */
export function validateAll(data: {
  trace_id?: string;
  evidence?: any;
  memory?: any;
}): {
  valid: boolean;
  results: {
    trace_id?: AssertionResult;
    evidence?: AssertionResult;
    memory?: AssertionResult;
  };
} {
  const results: any = {};
  let allValid = true;

  if (data.trace_id !== undefined) {
    results.trace_id = validateTraceId(data.trace_id);
    if (!results.trace_id.valid) allValid = false;
  }

  if (data.evidence !== undefined) {
    results.evidence = validateEvidence(data.evidence);
    if (!results.evidence.valid) allValid = false;
  }

  if (data.memory !== undefined) {
    results.memory = validateMemoryPayload(data.memory);
    if (!results.memory.valid) allValid = false;
  }

  return { valid: allValid, results };
}

/**
 * Get assertion statistics
 */
export function getStats(): AssertionStats {
  return { ...stats };
}

/**
 * Reset assertion statistics
 */
export function resetStats(): void {
  stats = {
    total: 0,
    passed: 0,
    failed: 0,
    lastRun: null,
  };
}

/**
 * Assert or throw
 */
export function assertTraceId(traceId: string | undefined | null): void {
  const result = validateTraceId(traceId);
  if (!result.valid) {
    throw new Error(`Trace ID assertion failed: ${result.errors.join(', ')}`);
  }
}

export function assertEvidence(evidence: any): void {
  const result = validateEvidence(evidence);
  if (!result.valid) {
    throw new Error(`Evidence assertion failed: ${result.errors.join(', ')}`);
  }
}

export function assertMemoryPayload(payload: any): void {
  const result = validateMemoryPayload(payload);
  if (!result.valid) {
    throw new Error(`Memory payload assertion failed: ${result.errors.join(', ')}`);
  }
}
