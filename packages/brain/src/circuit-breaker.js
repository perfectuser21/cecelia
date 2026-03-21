/**
 * Circuit Breaker - Prevents repeated failures from wasting resources
 *
 * States: CLOSED (normal) → OPEN (blocked) → HALF_OPEN (testing)
 * - CLOSED: Tasks dispatch normally
 * - OPEN: After 3 consecutive failures, block dispatch for 5 minutes
 * - HALF_OPEN: After cooldown, allow up to MAX_HALF_OPEN_PROBES probe tasks;
 *              success → CLOSED, failure → OPEN.
 *              Call recordProbeDispatched() after each allowed dispatch to consume a probe slot.
 */

import pool from './db.js';
import { emit } from './event-bus.js';
import { raise } from './alerting.js';

const FAILURE_THRESHOLD = 3;
const OPEN_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const MAX_HALF_OPEN_PROBES = 1; // 每次 HALF_OPEN 周期最多派发 1 个探针

// In-memory state (per worker key)
const breakers = new Map();

function defaultState() {
  return { state: 'CLOSED', failures: 0, lastFailureAt: null, openedAt: null, probesSent: 0 };
}

/**
 * Get circuit breaker state for a worker key
 * @param {string} key - Worker identifier (e.g. 'cecelia-run', or a specific worker name)
 * @returns {{ state: string, failures: number, lastFailureAt: number|null, openedAt: number|null, probesSent: number }}
 */
function getState(key = 'default') {
  if (!breakers.has(key)) {
    breakers.set(key, defaultState());
  }
  const b = breakers.get(key);

  // Auto-transition: OPEN → HALF_OPEN after cooldown
  if (b.state === 'OPEN' && b.openedAt && (Date.now() - b.openedAt >= OPEN_DURATION_MS)) {
    b.state = 'HALF_OPEN';
    b.probesSent = 0; // reset probe counter for new half-open period
  }

  return { ...b };
}

/**
 * Check if dispatch is allowed for a worker key.
 * In HALF_OPEN state, only allowed if probe slots remain (probesSent < MAX_HALF_OPEN_PROBES).
 * Call recordProbeDispatched() immediately after a successful dispatch to consume the slot.
 * @param {string} key
 * @returns {boolean}
 */
function isAllowed(key = 'default') {
  const s = getState(key);
  if (s.state === 'OPEN') return false;
  if (s.state === 'HALF_OPEN') return s.probesSent < MAX_HALF_OPEN_PROBES;
  return true; // CLOSED
}

/**
 * Consume a probe slot in HALF_OPEN state.
 * Must be called immediately after isAllowed() returns true during HALF_OPEN.
 * No-op in CLOSED or OPEN state.
 * @param {string} key
 */
function recordProbeDispatched(key = 'default') {
  // Call getState() to ensure OPEN→HALF_OPEN auto-transition has been applied
  const s = getState(key);
  if (s.state === 'HALF_OPEN') {
    const b = breakers.get(key);
    b.probesSent += 1;
  }
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
    b.probesSent = 0;
    await emit('circuit_open', 'circuit_breaker', {
      key,
      reason: 'half_open_probe_failed',
      failures: b.failures
    });
    raise('P0', `circuit_open_${key}`, `⚠️ 熔断触发：${key} 连续失败 ${b.failures} 次（半开探针失败），已暂停派发`).catch(err => console.error('[circuit-breaker] silent error:', err));
  } else if (b.failures >= FAILURE_THRESHOLD && b.state === 'CLOSED') {
    b.state = 'OPEN';
    b.openedAt = Date.now();
    await emit('circuit_open', 'circuit_breaker', {
      key,
      reason: 'failure_threshold_reached',
      failures: b.failures
    });
    raise('P0', `circuit_open_${key}`, `⚠️ 熔断触发：${key} 连续失败 ${b.failures} 次，已暂停派发`).catch(err => console.error('[circuit-breaker] silent error:', err));
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
  recordProbeDispatched,
  recordSuccess,
  recordFailure,
  reset,
  getAllStates,
  FAILURE_THRESHOLD,
  OPEN_DURATION_MS,
  MAX_HALF_OPEN_PROBES
};
