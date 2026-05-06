/**
 * Circuit Breaker - Prevents repeated failures from wasting resources
 *
 * States: CLOSED (normal) → OPEN (blocked) → HALF_OPEN (testing)
 * - CLOSED: Tasks dispatch normally
 * - OPEN: After 8 consecutive failures, block dispatch for 5 minutes
 * - HALF_OPEN: After cooldown, allow 1 probe task; success → CLOSED, failure → OPEN
 *
 * 持久化（migration 261）：
 *   内存 Map (`breakers`) 仍是运行时 SSOT，每次状态变更后异步 upsert 到
 *   `circuit_breaker_states` 表。Brain 启动时调用 `loadFromDB()` 恢复，
 *   防止重启清零导致正在熔断的 worker 立即"复活"。
 *   DB 写失败只 warn，不影响熔断逻辑（fail-open 不可接受，但 fail-degraded 可接受）。
 */

import pool from './db.js';
import { emit } from './event-bus.js';
import { raise } from './alerting.js';

const FAILURE_THRESHOLD = 8;
const OPEN_DURATION_MS = 5 * 60 * 1000; // 5 minutes

// In-memory state (per worker key)
const breakers = new Map();

function defaultState() {
  return { state: 'CLOSED', failures: 0, lastFailureAt: null, openedAt: null };
}

function _toTs(epochMs) {
  return epochMs == null ? null : new Date(epochMs).toISOString();
}

function _fromTs(ts) {
  return ts == null ? null : new Date(ts).getTime();
}

/**
 * Brain 启动时从 DB 恢复熔断器状态（migration 261）
 * 只恢复非默认态（state != CLOSED 或 failures > 0），CLOSED 0-fail 等价默认态。
 */
async function loadFromDB() {
  try {
    const res = await pool.query(
      `SELECT key, state, failures, last_failure_at, opened_at
         FROM circuit_breaker_states
        WHERE state <> 'CLOSED' OR failures > 0`
    );
    for (const row of res.rows) {
      breakers.set(row.key, {
        state: row.state,
        failures: row.failures,
        lastFailureAt: _fromTs(row.last_failure_at),
        openedAt: _fromTs(row.opened_at),
      });
      console.log(`[circuit-breaker] loadFromDB: 恢复 ${row.key} state=${row.state} failures=${row.failures}`);
    }
    if (res.rows.length === 0) {
      console.log('[circuit-breaker] loadFromDB: 无待恢复的熔断器状态');
    }
  } catch (err) {
    console.warn(`[circuit-breaker] loadFromDB 失败: ${err.message}`);
  }
}

async function _persist(key) {
  const b = breakers.get(key);
  if (!b) return;
  try {
    await pool.query(
      `INSERT INTO circuit_breaker_states (key, state, failures, last_failure_at, opened_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (key) DO UPDATE SET
         state           = EXCLUDED.state,
         failures        = EXCLUDED.failures,
         last_failure_at = EXCLUDED.last_failure_at,
         opened_at       = EXCLUDED.opened_at,
         updated_at      = NOW()`,
      [key, b.state, b.failures, _toTs(b.lastFailureAt), _toTs(b.openedAt)]
    );
  } catch (err) {
    console.warn(`[circuit-breaker] _persist(${key}) 失败: ${err.message}`);
  }
}

async function _delete(key) {
  try {
    await pool.query('DELETE FROM circuit_breaker_states WHERE key = $1', [key]);
  } catch (err) {
    console.warn(`[circuit-breaker] _delete(${key}) 失败: ${err.message}`);
  }
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
    void _persist(key);
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
  await _delete(key);

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
    await _persist(key);
    await emit('circuit_open', 'circuit_breaker', {
      key,
      reason: 'half_open_probe_failed',
      failures: b.failures
    });
    raise('P0', `circuit_open_${key}`, `⚠️ 熔断触发：${key} 连续失败 ${b.failures} 次（半开探针失败），已暂停派发`).catch(err => console.error('[circuit-breaker] silent error:', err));
  } else if (b.failures >= FAILURE_THRESHOLD && b.state === 'CLOSED') {
    b.state = 'OPEN';
    b.openedAt = Date.now();
    await _persist(key);
    await emit('circuit_open', 'circuit_breaker', {
      key,
      reason: 'failure_threshold_reached',
      failures: b.failures
    });
    raise('P0', `circuit_open_${key}`, `⚠️ 熔断触发：${key} 连续失败 ${b.failures} 次，已暂停派发`).catch(err => console.error('[circuit-breaker] silent error:', err));
  } else {
    await _persist(key);
  }
}

/**
 * Force reset a circuit breaker (legacy sync API, fire-and-forget DB delete).
 * Prefer `resetBreaker(key)` which awaits the DB write and is exposed via the
 * POST /api/brain/circuit-breaker/:key/reset endpoint.
 * @param {string} key
 */
function reset(key = 'default') {
  breakers.set(key, defaultState());
  void _delete(key);
}

/**
 * Force reset a circuit breaker, awaiting both in-memory and DB writes.
 *
 * 同步把内存 Map 设回 defaultState（CLOSED, failures=0），并 UPSERT
 * `circuit_breaker_states` 行为 state='CLOSED' / failures=0 / opened_at=NULL /
 * last_failure_at=NULL，让 loadFromDB 重启后恢复出干净状态。
 *
 * 与 `reset()` 区别：本函数 await DB 写入，便于 reset API 路由把结果反馈给调用方。
 *
 * @param {string} key
 */
async function resetBreaker(key = 'default') {
  breakers.set(key, defaultState());
  await _persist(key);
}

/**
 * Get all circuit breaker states (for status API)
 * @returns {Object}
 */
function getAllStates() {
  const result = {};
  for (const [key, _b] of breakers.entries()) {
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
  resetBreaker,
  getAllStates,
  loadFromDB,
  FAILURE_THRESHOLD,
  OPEN_DURATION_MS
};
