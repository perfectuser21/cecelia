/**
 * trace.js - Cecelia Core Observability SDK (v1.1.1)
 *
 * Unified event stream for tracing execution across all layers.
 * Implements 8 hard boundaries to prevent implementation drift.
 *
 * Hard Boundaries:
 * 1. run_id only generated at L0, downstream inherits
 * 2. span_id is new UUID per execution
 * 3. Status state machine constraints
 * 4. Heartbeat only for running/blocked, stops after end()
 * 5. artifacts format: {type}_id: uuid
 * 6. executor_host from standard enum
 * 7. reason_code from enum or CHECK constraint
 * 8. GC deletion order
 */

import pool from './db.js';
import { randomUUID } from 'crypto';

// ==================== Constants ====================

/**
 * Hard Boundary #6: executor_host standard enumeration
 */
export const EXECUTOR_HOSTS = {
  US_VPS: 'us-vps',
  HK_VPS: 'hk-vps',
  HK_N8N: 'hk-n8n',
  MAC_MINI: 'mac-mini',
  NODE_PC: 'node-pc',
};

/**
 * Hard Boundary #3: Status state machine
 * Valid transitions:
 * - queued → running | canceled
 * - running → blocked | success | failed | canceled
 * - blocked → running | canceled
 */
export const STATUS = {
  QUEUED: 'queued',
  RUNNING: 'running',
  BLOCKED: 'blocked',
  RETRYING: 'retrying',
  SUCCESS: 'success',
  FAILED: 'failed',
  CANCELED: 'canceled',
};

/**
 * Hard Boundary #7: reason_kind enumeration
 */
export const REASON_KIND = {
  TRANSIENT: 'TRANSIENT',     // Auto-retry
  PERSISTENT: 'PERSISTENT',   // Manual fix
  RESOURCE: 'RESOURCE',       // Scale up
  CONFIG: 'CONFIG',           // Fix config
  UNKNOWN: 'UNKNOWN',
};

/**
 * Execution layers (OpenTelemetry-compatible)
 */
export const LAYER = {
  L0_ORCHESTRATOR: 'L0_orchestrator',
  L1_BRAIN: 'L1_brain',
  L2_EXECUTOR: 'L2_executor',
  L3_BROWSER: 'L3_browser',
  L4_ARTIFACT: 'L4_artifact',
};

/**
 * Sensitive keys to redact (Hard Boundary #2: sanitization)
 */
const SENSITIVE_KEYS = [
  'password', 'token', 'secret', 'api_key', 'apiKey',
  'authorization', 'auth', 'credential', 'private_key',
  'access_token', 'refresh_token', 'session_id',
];

// ==================== Sanitization ====================

/**
 * Sanitize object by redacting sensitive keys
 * Hard Boundary: Always sanitize input/output before storing
 *
 * @param {Object} obj - Object to sanitize
 * @returns {Object} Sanitized object
 */
export function sanitize(obj) {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(sanitize);
  }

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    const isSensitive = SENSITIVE_KEYS.some(sk => lowerKey.includes(sk));

    if (isSensitive) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = sanitize(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

// ==================== Error Classification ====================

/**
 * Classify error into reason_kind (Hard Boundary #7)
 *
 * @param {Error} error - Error object
 * @returns {Object} { reason_code, reason_kind }
 */
export function classifyError(error) {
  const message = error.message || error.toString();
  const code = error.code || '';

  // TRANSIENT: Network, timeout, temporary failures
  if (
    message.includes('timeout') ||
    message.includes('ETIMEDOUT') ||
    message.includes('ECONNRESET') ||
    message.includes('ECONNREFUSED') ||
    message.includes('429') || // Rate limit
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT'
  ) {
    return {
      reason_code: 'TIMEOUT',
      reason_kind: REASON_KIND.TRANSIENT,
    };
  }

  // RESOURCE: Out of memory, disk full, etc.
  if (
    message.includes('out of memory') ||
    message.includes('ENOMEM') ||
    message.includes('disk full') ||
    message.includes('ENOSPC') ||
    message.includes('resource exhausted')
  ) {
    return {
      reason_code: 'RESOURCE_EXHAUSTED',
      reason_kind: REASON_KIND.RESOURCE,
    };
  }

  // CONFIG: Missing env vars, invalid config
  if (
    message.includes('not found') ||
    message.includes('ENOENT') ||
    message.includes('invalid config') ||
    message.includes('missing required')
  ) {
    return {
      reason_code: 'CONFIG_ERROR',
      reason_kind: REASON_KIND.CONFIG,
    };
  }

  // PERSISTENT: Auth failures, selector not found, etc.
  if (
    message.includes('auth') ||
    message.includes('unauthorized') ||
    message.includes('403') ||
    message.includes('401') ||
    message.includes('selector not found') ||
    message.includes('element not found')
  ) {
    return {
      reason_code: 'AUTH_OR_SELECTOR_ERROR',
      reason_kind: REASON_KIND.PERSISTENT,
    };
  }

  // Default: UNKNOWN
  return {
    reason_code: 'UNKNOWN_ERROR',
    reason_kind: REASON_KIND.UNKNOWN,
  };
}

// ==================== Artifact Management ====================

/**
 * Store artifact metadata (Hard Boundary #5: artifacts format)
 *
 * @param {string} spanId - Span ID
 * @param {string} artifactType - screenshot, log, video, diff, etc.
 * @param {string} storageBackend - local, s3, nas
 * @param {string} storageKey - Path or S3 key
 * @param {Object} options - { contentType, sizeBytes, expiresAt, metadata }
 * @returns {Promise<string>} artifact_id (UUID)
 */
export async function storeArtifact(spanId, artifactType, storageBackend, storageKey, options = {}) {
  const artifactId = randomUUID();
  const { contentType, sizeBytes, expiresAt, metadata } = options;

  await pool.query(
    `INSERT INTO run_artifacts (id, span_id, artifact_type, storage_backend, storage_key, content_type, size_bytes, expires_at, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      artifactId,
      spanId,
      artifactType,
      storageBackend,
      storageKey,
      contentType || null,
      sizeBytes || null,
      expiresAt || null,
      metadata ? JSON.stringify(metadata) : null,
    ]
  );

  return artifactId;
}

/**
 * Get artifact by ID
 *
 * @param {string} artifactId - Artifact UUID
 * @returns {Promise<Object|null>} Artifact metadata
 */
export async function getArtifact(artifactId) {
  const result = await pool.query(
    `SELECT * FROM run_artifacts WHERE id = $1`,
    [artifactId]
  );

  return result.rows[0] || null;
}

// ==================== Trace Step API ====================

/**
 * Create a trace step
 *
 * Hard Boundary #1: run_id must be provided by caller (generated at L0)
 * Hard Boundary #2: span_id is always a new UUID
 *
 * @param {Object} options
 * @param {string} options.taskId - Task ID (nullable)
 * @param {string} options.runId - Run ID (required, from L0)
 * @param {string} [options.parentSpanId] - Parent span ID (nullable)
 * @param {string} options.layer - Execution layer (L0_orchestrator, etc.)
 * @param {string} options.stepName - Step name
 * @param {string} [options.executorHost] - Executor host (from EXECUTOR_HOSTS)
 * @param {string} [options.agent] - Agent name
 * @param {string} [options.region] - Region (us, hk)
 * @param {number} [options.attempt=1] - Attempt number
 * @param {Object} [options.inputSummary] - Input parameters (will be sanitized)
 * @param {Object} [options.metadata] - Additional metadata
 * @returns {TraceStep}
 */
export function traceStep(options) {
  return new TraceStep(options);
}

/**
 * TraceStep class - represents a single execution step
 *
 * Hard Boundary #4: Heartbeat only written when status = running/blocked
 */
class TraceStep {
  constructor(options) {
    this.spanId = randomUUID(); // Hard Boundary #2: new UUID per execution
    this.taskId = options.taskId || null;
    this.runId = options.runId; // Hard Boundary #1: inherited from L0
    this.parentSpanId = options.parentSpanId || null;
    this.layer = options.layer;
    this.stepName = options.stepName;
    this.status = STATUS.QUEUED;
    this.executorHost = options.executorHost || null;
    this.agent = options.agent || null;
    this.region = options.region || null;
    this.attempt = options.attempt || 1;
    this.inputSummary = sanitize(options.inputSummary || {});
    this.metadata = options.metadata || {};
    this.artifacts = {};
    this.heartbeatInterval = null;
  }

  /**
   * Start the trace step (inserts into run_events)
   *
   * @returns {Promise<void>}
   */
  async start() {
    this.status = STATUS.RUNNING;

    await pool.query(
      `INSERT INTO run_events (
        span_id, task_id, run_id, parent_span_id,
        layer, step_name, status,
        executor_host, agent, region, attempt,
        input_summary, metadata,
        ts_start, heartbeat_ts
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), now())`,
      [
        this.spanId,
        this.taskId,
        this.runId,
        this.parentSpanId,
        this.layer,
        this.stepName,
        this.status,
        this.executorHost,
        this.agent,
        this.region,
        this.attempt,
        JSON.stringify(this.inputSummary),
        JSON.stringify(this.metadata),
      ]
    );

    // Start heartbeat (Hard Boundary #4)
    this.startHeartbeat();
  }

  /**
   * Update heartbeat timestamp (Hard Boundary #4)
   * Only updates if status = running or blocked
   *
   * @returns {Promise<void>}
   */
  async heartbeat() {
    if (this.status !== STATUS.RUNNING && this.status !== STATUS.BLOCKED) {
      return; // Hard Boundary #4: No heartbeat after end
    }

    await pool.query(
      `UPDATE run_events SET heartbeat_ts = now() WHERE span_id = $1 AND status IN ('running', 'blocked')`,
      [this.spanId]
    );
  }

  /**
   * Start automatic heartbeat (every 30s)
   * Hard Boundary #4: Only while running/blocked
   */
  startHeartbeat() {
    if (this.heartbeatInterval) {
      return; // Already started
    }

    this.heartbeatInterval = setInterval(() => {
      this.heartbeat().catch(err => {
        console.error(`[Trace] Heartbeat failed for span ${this.spanId}:`, err);
      });
    }, 30000); // 30 seconds
  }

  /**
   * Stop automatic heartbeat
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * End the trace step (success or failure)
   * Hard Boundary #4: Stops heartbeat after end
   *
   * @param {Object} options
   * @param {string} options.status - Final status (success, failed, canceled)
   * @param {Object} [options.outputSummary] - Output result (will be sanitized)
   * @param {Error} [options.error] - Error object (if failed)
   * @param {Object} [options.artifacts] - Artifacts map {screenshot_id: uuid, ...}
   * @returns {Promise<void>}
   */
  async end(options) {
    const { status, outputSummary, error, artifacts } = options;

    this.status = status;
    this.stopHeartbeat(); // Hard Boundary #4

    let reasonCode = null;
    let reasonKind = null;

    if (error) {
      const classified = classifyError(error);
      reasonCode = classified.reason_code;
      reasonKind = classified.reason_kind;
    }

    await pool.query(
      `UPDATE run_events
       SET status = $1,
           ts_end = now(),
           output_summary = $2,
           reason_code = $3,
           reason_kind = $4,
           artifacts = $5
       WHERE span_id = $6`,
      [
        status,
        outputSummary ? JSON.stringify(sanitize(outputSummary)) : null,
        reasonCode,
        reasonKind,
        artifacts ? JSON.stringify(artifacts) : null,
        this.spanId,
      ]
    );
  }

  /**
   * Add artifact to this span (Hard Boundary #5)
   *
   * @param {string} type - Artifact type (screenshot, log, etc.)
   * @param {string} storageBackend - Storage backend (local, s3, nas)
   * @param {string} storageKey - Storage key/path
   * @param {Object} options - { contentType, sizeBytes, expiresAt, metadata }
   * @returns {Promise<string>} artifact_id
   */
  async addArtifact(type, storageBackend, storageKey, options = {}) {
    const artifactId = await storeArtifact(
      this.spanId,
      type,
      storageBackend,
      storageKey,
      options
    );

    // Update artifacts map (Hard Boundary #5: {type}_id format)
    this.artifacts[`${type}_id`] = artifactId;

    // Update run_events.artifacts column
    await pool.query(
      `UPDATE run_events SET artifacts = $1 WHERE span_id = $2`,
      [JSON.stringify(this.artifacts), this.spanId]
    );

    return artifactId;
  }
}

// ==================== High-level Wrapper ====================

/**
 * Wrap an async function with automatic tracing
 *
 * @param {Function} fn - Async function to wrap
 * @param {Object} traceOptions - Options for traceStep()
 * @returns {Function} Wrapped function
 */
export function withSpan(fn, traceOptions) {
  return async function wrappedFunction(...args) {
    const step = traceStep(traceOptions);
    await step.start();

    try {
      const result = await fn(...args);
      await step.end({
        status: STATUS.SUCCESS,
        outputSummary: { result },
      });
      return result;
    } catch (error) {
      await step.end({
        status: STATUS.FAILED,
        error,
      });
      throw error;
    }
  };
}

// ==================== Query Helpers ====================

/**
 * Get active runs (currently running)
 *
 * @returns {Promise<Array>} Active runs
 */
export async function getActiveRuns() {
  const result = await pool.query(`SELECT * FROM v_active_runs`);
  return result.rows;
}

/**
 * Get run summary
 *
 * @param {string} runId - Run ID
 * @returns {Promise<Object|null>} Run summary
 */
export async function getRunSummary(runId) {
  const result = await pool.query(
    `SELECT * FROM v_run_summary WHERE run_id = $1`,
    [runId]
  );
  return result.rows[0] || null;
}

/**
 * Get stuck runs (no heartbeat for 5+ minutes)
 *
 * @returns {Promise<Array>} Stuck runs
 */
export async function getStuckRuns() {
  const result = await pool.query(`SELECT * FROM detect_stuck_runs()`);
  return result.rows;
}

/**
 * Get top failure reasons (last 24h)
 *
 * @returns {Promise<Array>} Top failure reasons
 */
export async function getTopFailureReasons() {
  const result = await pool.query(`SELECT * FROM v_top_failure_reasons`);
  return result.rows;
}

/**
 * Get last alive span for a run
 *
 * @param {string} runId - Run ID
 * @returns {Promise<Object|null>} Last alive span
 */
export async function getLastAliveSpan(runId) {
  const result = await pool.query(
    `SELECT * FROM v_run_last_alive_span WHERE run_id = $1`,
    [runId]
  );
  return result.rows[0] || null;
}

// ==================== Exports ====================

export default {
  // Constants
  EXECUTOR_HOSTS,
  STATUS,
  REASON_KIND,
  LAYER,

  // Functions
  sanitize,
  classifyError,
  storeArtifact,
  getArtifact,
  traceStep,
  withSpan,

  // Queries
  getActiveRuns,
  getRunSummary,
  getStuckRuns,
  getTopFailureReasons,
  getLastAliveSpan,
};
