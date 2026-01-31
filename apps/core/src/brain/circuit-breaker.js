/**
 * Circuit Breaker - Prevents repeated failures from wasting resources
 *
 * States: CLOSED (normal) → OPEN (blocked) → HALF_OPEN (testing)
 * - CLOSED: Tasks dispatch normally
 * - OPEN: After 3 consecutive failures, block dispatch for 30 minutes
 * - HALF_OPEN: After cooldown, allow 1 probe task; success → CLOSED, failure → OPEN
 */

import pool from '../task-system/db.js';
import { emit } from './event-bus.js';

const FAILURE_THRESHOLD = 3;
const OPEN_DURATION_MS = 30 * 60 * 1000; // 30 minutes

// In-memory state (per worker key)
const breakers = new Map();

function defaultState() {
  return { state: 'CLOSED', failures: 0, lastFailureAt: null, openedAt: null };
}

/**
 * Get circuit breaker state for a worker key
 * @param {string} key - Worker identifier (e.g. 'cecelia-run', or a specific worker name)
 * @returns {{ state: string, failures: number, lastFailureAt: number|null, openedAt: number|null }}
 */
function getState(key = 'default') {
  if (!breakers.has(key)) {
    breakers.set(key, defaultState());
  }
  const b = breakers.get(key);

  // Auto-transition: OPEN → HALF_OPEN after cooldown
  if (b.state === 'OPEN' && b.openedAt && (Date.now() - b.openedAt >= OPEN_DURATION_MS)) {
    b.state = 'HALF_OPEN';
  }

  return { ...b };
}

/**
 * Check if dispatch is allowed for a worker key
 * @param {string} key
 * @returns {boolean}
 */
function isAllowed(key = 'default') {
  const s = getState(key);
  // CLOSED: always allowed
  // HALF_OPEN: allowed (probe)
  // OPEN: blocked
  return s.state !== 'OPEN';
}

/**
 * Record a success for a worker key
 * Resets to CLOSED state
 * @param {string} key
 */
async function recordSuccess(key = 'default') {
  const prev = getState(key);
  breakers.set(key, defaultState());

  if (prev.state === 'HALF_OPEN') {
    await emit('circuit_closed', 'circuit_breaker', {
      key,
      previous_state: prev.state,
      previous_failures: prev.failures
    });
  }
}

/**
 * Record a failure for a worker key
 * @param {string} key
 */
async function recordFailure(key = 'default') {
  if (!breakers.has(key)) {
    breakers.set(key, defaultState());
  }
  const b = breakers.get(key);
  b.failures += 1;
  b.lastFailureAt = Date.now();

  if (b.state === 'HALF_OPEN') {
    // Probe failed → back to OPEN
    b.state = 'OPEN';
    b.openedAt = Date.now();
    await emit('circuit_open', 'circuit_breaker', {
      key,
      reason: 'half_open_probe_failed',
      failures: b.failures
    });
  } else if (b.failures >= FAILURE_THRESHOLD && b.state === 'CLOSED') {
    b.state = 'OPEN';
    b.openedAt = Date.now();
    await emit('circuit_open', 'circuit_breaker', {
      key,
      reason: 'failure_threshold_reached',
      failures: b.failures
    });
  }
}

/**
 * Force reset a circuit breaker
 * @param {string} key
 */
function reset(key = 'default') {
  breakers.set(key, defaultState());
}

/**
 * Get all circuit breaker states (for status API)
 * @returns {Object}
 */
function getAllStates() {
  const result = {};
  for (const [key, b] of breakers.entries()) {
    result[key] = getState(key);
  }
  return result;
}

export {
  getState,
  isAllowed,
  recordSuccess,
  recordFailure,
  reset,
  getAllStates,
  FAILURE_THRESHOLD,
  OPEN_DURATION_MS
};
