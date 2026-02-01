/**
 * Retry Analyzer - Intelligent failure analysis and parameter adjustment
 *
 * Analyzes failed tasks to determine failure category and adjust retry parameters.
 * Categories: timeout, code_error, infra_error, prd_unclear
 */

import pool from './db.js';
import { DISPATCH_TIMEOUT_MINUTES } from './tick.js';

const MAX_RETRIES = 2;
const INFRA_RETRY_DELAY_MS = 10 * 60 * 1000; // 10 minutes

// Error pattern matchers (order matters: first match wins)
const FAILURE_PATTERNS = [
  {
    category: 'timeout',
    patterns: [
      /timed?\s*out/i,
      /timeout/i,
      /exceeded.*time/i,
      /dispatch.*timeout/i,
      /elapsed.*minutes/i,
      /auto-fail.*timeout/i,
    ],
  },
  {
    category: 'prd_unclear',
    patterns: [
      /prd.*unclear/i,
      /prd.*invalid/i,
      /prd.*missing/i,
      /requirements.*unclear/i,
      /ambiguous.*requirement/i,
      /no.*prd/i,
      /prd.*empty/i,
    ],
  },
  {
    category: 'infra_error',
    patterns: [
      /ECONNREFUSED/i,
      /ENOTFOUND/i,
      /ETIMEDOUT/i,
      /connection.*refused/i,
      /network.*error/i,
      /docker.*error/i,
      /git.*fatal/i,
      /npm.*ERR/i,
      /disk.*full/i,
      /out\s*of\s*memory/i,
      /spawn.*ENOENT/i,
      /permission.*denied/i,
    ],
  },
  {
    category: 'code_error',
    patterns: [
      /syntax.*error/i,
      /type.*error/i,
      /reference.*error/i,
      /compile.*error/i,
      /build.*fail/i,
      /test.*fail/i,
      /lint.*error/i,
      /CI.*fail/i,
      /merge.*conflict/i,
    ],
  },
];

/**
 * Analyze a failed task and determine failure category + retry adjustments.
 *
 * @param {Object} task - Failed task object with error, payload fields
 * @returns {{ category: string, reason: string, adjustments: Object }}
 */
function analyzeFailure(task) {
  const errorText = extractErrorText(task);
  const category = classifyError(errorText);
  const reason = buildReason(category, errorText);
  const adjustments = computeAdjustments(category, task);

  return { category, reason, adjustments };
}

/**
 * Extract error text from task fields.
 */
function extractErrorText(task) {
  const parts = [];

  if (task.error) {
    parts.push(typeof task.error === 'string' ? task.error : JSON.stringify(task.error));
  }

  const payload = task.payload || {};
  if (payload.error_details) {
    parts.push(typeof payload.error_details === 'string' ? payload.error_details : JSON.stringify(payload.error_details));
  }
  if (payload.last_run_result?.result_summary) {
    parts.push(String(payload.last_run_result.result_summary));
  }
  if (payload.run_status) {
    parts.push(String(payload.run_status));
  }

  return parts.join(' ') || 'unknown error';
}

/**
 * Classify error text into a failure category.
 */
function classifyError(errorText) {
  for (const { category, patterns } of FAILURE_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(errorText)) {
        return category;
      }
    }
  }
  return 'code_error'; // default fallback
}

/**
 * Build a human-readable reason string.
 */
function buildReason(category, errorText) {
  const snippet = errorText.length > 200 ? errorText.slice(0, 200) + '...' : errorText;
  const labels = {
    timeout: 'Task exceeded dispatch timeout',
    code_error: 'Code/build/test failure detected',
    infra_error: 'Infrastructure or connectivity issue',
    prd_unclear: 'PRD missing or unclear requirements',
  };
  return `${labels[category] || 'Unknown failure'}: ${snippet}`;
}

/**
 * Compute retry parameter adjustments based on failure category.
 */
function computeAdjustments(category, task) {
  const retryCount = parseInt(task.payload?.retry_count || 0, 10);
  const currentTimeout = parseFloat(task.payload?.dispatch_timeout || DISPATCH_TIMEOUT_MINUTES);

  switch (category) {
    case 'timeout':
      return {
        should_retry: retryCount < MAX_RETRIES,
        dispatch_timeout: Math.round(currentTimeout * 1.5),
        retry_delay_ms: 0,
      };

    case 'infra_error':
      return {
        should_retry: retryCount < MAX_RETRIES,
        dispatch_timeout: currentTimeout,
        retry_delay_ms: INFRA_RETRY_DELAY_MS,
      };

    case 'code_error':
      return {
        should_retry: retryCount < MAX_RETRIES,
        dispatch_timeout: currentTimeout,
        retry_delay_ms: 0,
      };

    case 'prd_unclear':
      return {
        should_retry: false,
        dispatch_timeout: currentTimeout,
        retry_delay_ms: 0,
      };

    default:
      return {
        should_retry: retryCount < MAX_RETRIES,
        dispatch_timeout: currentTimeout,
        retry_delay_ms: 0,
      };
  }
}

/**
 * Determine if a task should be retried based on analysis.
 *
 * @param {Object} task - Failed task
 * @returns {{ shouldRetry: boolean, analysis: Object }}
 */
function shouldRetryTask(task) {
  const retryCount = task.payload?.retry_count || 0;

  if (retryCount >= MAX_RETRIES) {
    return {
      shouldRetry: false,
      analysis: {
        category: 'max_retries_exceeded',
        reason: `Task has already been retried ${retryCount} times (max: ${MAX_RETRIES})`,
        adjustments: { should_retry: false },
      },
    };
  }

  const analysis = analyzeFailure(task);

  return {
    shouldRetry: analysis.adjustments.should_retry,
    analysis,
  };
}

/**
 * Get retry summary stats from the database.
 *
 * @returns {{ failed_count: number, retrying_count: number, abandoned_count: number }}
 */
async function getRetrySummary() {
  const result = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'failed') as failed_count,
      COUNT(*) FILTER (WHERE status = 'queued' AND payload->>'retry_of' IS NOT NULL) as retrying_count,
      COUNT(*) FILTER (WHERE status = 'abandoned') as abandoned_count
    FROM tasks
  `);

  const row = result.rows[0] || {};
  return {
    failed_count: parseInt(row.failed_count || '0'),
    retrying_count: parseInt(row.retrying_count || '0'),
    abandoned_count: parseInt(row.abandoned_count || '0'),
  };
}

export {
  analyzeFailure,
  shouldRetryTask,
  getRetrySummary,
  classifyError,
  extractErrorText,
  computeAdjustments,
  MAX_RETRIES,
  FAILURE_PATTERNS,
};
