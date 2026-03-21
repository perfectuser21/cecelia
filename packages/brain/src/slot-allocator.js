/**
 * Slot Allocator - Three-Pool Slot Allocation System
 *
 * Replaces the flat MAX_SEATS - INTERACTIVE_RESERVE model with three pools:
 *   Pool A (Cecelia Reserved): Internal tasks (OKR decomposition, cortex RCA)
 *   Pool B (User Reserved): Headed sessions + headroom for team agents
 *   Pool C (Dynamic Task Pool): Auto-dispatched tasks, pressure-scaled
 *
 * Priority: User (B) > Cecelia (A) > Task Pool (C)
 * Graceful: Never kills running tasks, only stops new dispatches.
 */

/* global console */

import { MAX_SEATS, checkServerResources, getActiveProcessCount, getEffectiveMaxSeats, PHYSICAL_CAPACITY, getBudgetCap, getTokenPressure } from './executor.js';
import pool from './db.js';
import { listProcessesWithElapsed, listProcessesWithPpid } from './platform-utils.js';
import { calculateBudgetState } from './token-budget-planner.js';
import { getFleetStatus, getRemoteCapacity } from './fleet-resource-cache.js';

// ============================================================
// Constants
// ============================================================

const TOTAL_CAPACITY = MAX_SEATS;           // startup snapshot (backward compat)
function getTotalCapacity() { return getEffectiveMaxSeats(); }
const CECELIA_RESERVED = 0;                  // Pool A: removed static reserve — dynamic model handles this
const USER_RESERVED_BASE = 1;                // Pool B: minimum when user absent (1 slot suffices)
const USER_PRIORITY_HEADROOM = 1;            // Extra free slots when user is active (1 headroom)
const SESSION_TTL_SECONDS = 4 * 60 * 60;    // 4 hours: orphaned sessions expire (worktree leftovers etc.)
const CODEX_ACCOUNT_COUNT = 5;              // Codex 账号总数（硬上限）
const CODEX_FALLBACK_CONCURRENT = 3;        // Fleet cache 不可用时的降级值

/**
 * 动态计算 Codex 并发上限（基于 fleet cache 的远程机器 effectiveSlots）
 * 上限不超过 CODEX_ACCOUNT_COUNT（5 个账号）
 */
function getCodexMaxConcurrent() {
  const m4 = getRemoteCapacity('xian-mac-m4');
  const m1 = getRemoteCapacity('xian-mac-m1');
  const remoteSlots = (m4?.online ? m4.effectiveSlots : 0) + (m1?.online ? m1.effectiveSlots : 0);
  if (remoteSlots === 0 && !m4?.online && !m1?.online) {
    return CODEX_FALLBACK_CONCURRENT; // fleet cache 不可用时降级
  }
  return Math.min(remoteSlots, CODEX_ACCOUNT_COUNT);
}
const BACKPRESSURE_THRESHOLD = 5;           // 队列深度超过此值时触发降速
const BACKPRESSURE_BURST_LIMIT = 3;         // 背压激活时 burst limit（动态检测已做防雪崩，不需要压到 1）

// ============================================================
// Process Detection
// ============================================================

/**
 * Detect and classify all claude processes on the system.
 * headed = `claude` without `-p` (user interactive sessions)
 * headless = `claude -p ...` (Cecelia auto-dispatched)
 *
 * Sessions older than SESSION_TTL_SECONDS are excluded from the headed count
 * to prevent orphaned worktree processes from permanently triggering team mode.
 *
 * Platform-aware: uses listProcessesWithElapsed() from platform-utils.js
 * (Darwin: ps -ax -o pid=,etime=,comm=,args= with etime parsing;
 *  Linux: ps -eo pid,etimes,comm,args --no-headers)
 *
 * PPID Detection (macOS fix):
 * On macOS, claude overrides its process title so `-p` flag disappears from ps args.
 * Solution: check parent process (PPID) args for CECELIA_HEADLESS=true, which
 * cecelia-run sets when launching headless tasks. Falls back to -p detection on error.
 */
function detectUserSessions() {
  try {
    const allProcs = listProcessesWithElapsed();
    // Filter to claude processes only
    const claudeProcs = allProcs.filter(p => p.comm === 'claude');

    if (claudeProcs.length === 0) return { headed: [], headless: [], total: 0 };

    // Build pid→ppid and pid→args maps for PPID-based headless detection.
    // listProcessesWithPpid() returns [] on error (graceful degradation).
    const ppidProcs = listProcessesWithPpid();
    const pidToPpid = new Map();
    const pidToArgs = new Map();
    for (const p of ppidProcs) {
      pidToPpid.set(p.pid, p.ppid);
      pidToArgs.set(p.pid, p.cmd);
    }

    const headed = [];
    const headless = [];

    for (const proc of claudeProcs) {
      const { pid, elapsedSec, args } = proc;

      // Primary: PPID detection — parent process args contain CECELIA_HEADLESS=true
      // (cecelia-run sets this when launching headless tasks via `env CECELIA_HEADLESS=true ...`)
      // Fallback: -p / --print flag detection (works on Linux, unreliable on macOS)
      const ppid = pidToPpid.get(pid);
      const parentArgs = ppid !== undefined ? (pidToArgs.get(ppid) || '') : '';
      const isHeadlessViaPpid = /CECELIA_HEADLESS=true/.test(parentArgs);

      if (isHeadlessViaPpid || / -p /.test(args) || /^-p /.test(args) || / --print /.test(args)) {
        headless.push({ pid, args: args.slice(0, 100) });
      } else {
        // Filter out sessions older than TTL — likely orphaned worktree/agent processes
        if (!isNaN(elapsedSec) && elapsedSec > SESSION_TTL_SECONDS) {
          console.log(`[slot-allocator] Ignoring stale headed session PID ${pid} (elapsed ${Math.round(elapsedSec / 3600)}h > TTL ${SESSION_TTL_SECONDS / 3600}h)`);
          continue;
        }
        headed.push({ pid, args: args.slice(0, 100) });
      }
    }

    return { headed, headless, total: headed.length + headless.length };
  } catch {
    return { headed: [], headless: [], total: 0 };
  }
}

/**
 * Determine user activity mode from session counts.
 *   'team'        — 3+ headed sessions (team agents active)
 *   'interactive' — 1-2 headed sessions
 *   'absent'      — no headed sessions
 */
function detectUserMode(sessions) {
  const headedCount = sessions?.headed?.length || 0;
  if (headedCount >= 3) return 'team';
  if (headedCount >= 1) return 'interactive';
  return 'absent';
}

// ============================================================
// Task Classification
// ============================================================

/**
 * Check if there are pending Cecelia-internal tasks (decomposition, cortex).
 */
async function hasPendingInternalTasks() {
  try {
    const result = await pool.query(`
      SELECT COUNT(*) FROM tasks
      WHERE status IN ('queued', 'in_progress')
      AND (payload->>'decomposition' IS NOT NULL
           OR payload->>'requires_cortex' = 'true')
    `);
    return parseInt(result.rows[0].count, 10) > 0;
  } catch {
    return false;
  }
}

/**
 * Count Cecelia-internal tasks currently in_progress.
 */
async function countCeceliaInProgress() {
  try {
    const result = await pool.query(`
      SELECT COUNT(*) FROM tasks
      WHERE status = 'in_progress'
      AND (payload->>'decomposition' IS NOT NULL
           OR payload->>'requires_cortex' = 'true')
    `);
    return parseInt(result.rows[0].count, 10);
  } catch {
    return 0;
  }
}

/**
 * Count auto-dispatched (non-internal) tasks currently in_progress.
 */
async function countAutoDispatchInProgress() {
  try {
    const result = await pool.query(`
      SELECT COUNT(*) FROM tasks
      WHERE status = 'in_progress'
      AND (payload->>'decomposition' IS NULL
           AND (payload->>'requires_cortex' IS NULL OR payload->>'requires_cortex' != 'true'))
    `);
    return parseInt(result.rows[0].count, 10);
  } catch {
    return 0;
  }
}

/**
 * Count all tasks currently in queued status (across all task types).
 * Used for backpressure detection: if queue is deep, burst limit is reduced.
 */
async function getQueueDepth() {
  try {
    const r = await pool.query("SELECT COUNT(*) FROM tasks WHERE status='queued'");
    return parseInt(r.rows[0].count, 10);
  } catch {
    return 0;
  }
}

/**
 * Count Codex-native tasks currently in_progress.
 * Includes task_type IN ('codex_qa', 'codex_dev', 'codex_playwright', 'codex_test_gen', 'codex_security_scan') — tasks always routed to Xian Codex CLI.
 * Budget-downgraded tasks (provider=codex override) are not counted here since provider
 * is a runtime in-memory override, not persisted to DB.
 */
async function countCodexInProgress() {
  try {
    const result = await pool.query(`
      SELECT COUNT(*) FROM tasks
      WHERE status = 'in_progress'
      AND task_type IN ('codex_qa', 'codex_dev', 'codex_playwright', 'codex_test_gen', 'codex_security_scan')
    `);
    return parseInt(result.rows[0].count, 10);
  } catch {
    return 0;
  }
}

// ============================================================
// Slot Budget Calculation
// ============================================================

// Slot change buffer: asymmetric — fast brake, slow recovery
const SLOT_BUFFER_DOWN = 3;   // max decrease per tick (fast brake)
const SLOT_BUFFER_UP = 1;     // max increase per tick (slow recovery)
const SLOT_BUFFER_MAX_DELTA = SLOT_BUFFER_DOWN; // backward compat export (tests)
let _previousPoolCBudget = null;

/**
 * Apply buffer to slot changes: asymmetric limit per tick.
 * Down (brake): max -SLOT_BUFFER_DOWN per tick.
 * Up (recovery): max +SLOT_BUFFER_UP per tick.
 * First call (no previous value) passes through without buffering.
 */
function applySlotBuffer(newValue) {
  if (_previousPoolCBudget === null) {
    _previousPoolCBudget = newValue;
    return newValue;
  }
  const delta = newValue - _previousPoolCBudget;
  let buffered;
  if (delta >= 0 && delta <= SLOT_BUFFER_UP) {
    buffered = newValue;
  } else if (delta < 0 && Math.abs(delta) <= SLOT_BUFFER_DOWN) {
    buffered = newValue;
  } else if (delta > 0) {
    buffered = _previousPoolCBudget + SLOT_BUFFER_UP;
  } else {
    buffered = Math.max(0, _previousPoolCBudget - SLOT_BUFFER_DOWN);
  }
  _previousPoolCBudget = buffered;
  return buffered;
}

/** Reset buffer state (for testing) */
function _resetSlotBuffer() { _previousPoolCBudget = null; }

/**
 * Calculate the slot budget for each pool.
 * Called per-tick to determine how many auto-dispatches are allowed.
 *
 * @returns {Object} Budget breakdown with per-pool allocations
 */
async function calculateSlotBudget() {
  const sessions = detectUserSessions();
  const userMode = detectUserMode(sessions);
  const userSlotsUsed = sessions.headed.length;

  // Dynamic model: resource pressure determines effective slots
  const resources = checkServerResources();
  const effectiveSlots = resources.effectiveSlots;

  // Running processes = actual running count from DB
  const ceceliaUsed = await countCeceliaInProgress();
  const autoDispatchUsed = await countAutoDispatchInProgress();
  // Conservative: take the higher of ps detection vs DB count to prevent over-dispatch
  const totalRunning = Math.max(sessions.total, ceceliaUsed + autoDispatchUsed);

  // User reserve: 1 slot headroom when user is active
  const userReserve = userMode !== 'absent' ? USER_PRIORITY_HEADROOM : 0;

  // Available = effective slots - actual running - user headroom
  let availableRaw = Math.max(0, effectiveSlots - totalRunning - userReserve);

  // Budget state: 7-day token budget planning (scale down if overspending)
  let budgetState = null;
  try {
    budgetState = await calculateBudgetState();
    const scale = budgetState.pool_c_scale;
    if (scale < 1.0) {
      const scaled = Math.round(availableRaw * scale);
      if (scaled < availableRaw) {
        console.log(`[slot-allocator] budget_state=${budgetState.state} scale=${scale} available: ${availableRaw}→${scaled}`);
        availableRaw = scaled;
      }
    }
  } catch (err) {
    console.warn(`[slot-allocator] calculateBudgetState failed: ${err.message}, skipping`);
  }

  // Apply slot change buffer (asymmetric: fast brake, slow recovery)
  const availableBuffered = applySlotBuffer(availableRaw);

  // Backpressure: throttle burst limit when queue is deep
  const queueDepth = await getQueueDepth();
  const backpressureActive = queueDepth > BACKPRESSURE_THRESHOLD;
  const backpressure = {
    queue_depth: queueDepth,
    threshold: BACKPRESSURE_THRESHOLD,
    active: backpressureActive,
    override_burst_limit: backpressureActive ? BACKPRESSURE_BURST_LIMIT : null,
  };
  if (backpressureActive) {
    console.log(`[slot-allocator] Backpressure active: queue_depth=${queueDepth} > ${BACKPRESSURE_THRESHOLD}, override_burst_limit=${BACKPRESSURE_BURST_LIMIT}`);
  }

  // Codex Pool D: concurrent limit for Codex tasks (dynamic based on fleet cache)
  const codexRunning = await countCodexInProgress();
  const codexMax = getCodexMaxConcurrent();
  const codexAvailable = codexRunning < codexMax;

  // Token pressure: monitoring only (no longer throttles dispatch)
  // Exception: block dispatch when ALL accounts exhausted (safety valve)
  let tokenInfo = { token_pressure: 0, available_accounts: 3, details: 'not queried' };
  try {
    tokenInfo = await getTokenPressure();
  } catch {
    // Token pressure fetch failed — continue without it
  }

  // Token safety: block dispatch only when ALL accounts exhausted
  const tokenExhausted = tokenInfo.token_pressure >= 1.0 && tokenInfo.available_accounts === 0;
  if (tokenExhausted) {
    console.log('[slot-allocator] Token exhausted: all accounts at quota limit, blocking dispatch');
  }

  // Capacity info from dual-layer model
  const capInfo = getBudgetCap();
  const dynamicCapacity = getTotalCapacity();

  return {
    total: dynamicCapacity,
    capacity: { physical: capInfo.physical, budget: capInfo.budget, effective: capInfo.effective },
    user: {
      budget: userSlotsUsed + userReserve,
      used: userSlotsUsed,
      mode: userMode,
      headroom: userReserve,
    },
    cecelia: {
      budget: 0,
      used: ceceliaUsed,
    },
    taskPool: {
      budget: availableBuffered + autoDispatchUsed,
      used: autoDispatchUsed,
      available: availableBuffered,
    },
    codex: {
      running: codexRunning,
      max: codexMax,
      available: codexAvailable,
    },
    fleet: getFleetStatus(),
    pressure: resources.metrics.max_pressure,
    resources: {
      effectiveSlots,
      maxPressure: resources.metrics.max_pressure,
    },
    tokenPressure: tokenInfo,
    budgetState: budgetState ? {
      state: budgetState.state,
      avg_remaining_pct: budgetState.avg_remaining_pct,
      pool_c_scale: budgetState.pool_c_scale,
    } : null,
    dispatchAllowed: availableBuffered > 0 && !tokenExhausted,
    backpressure,
  };
}

// ============================================================
// API
// ============================================================

/**
 * Get full slot allocation status (for GET /api/brain/slots).
 */
async function getSlotStatus() {
  const budget = await calculateSlotBudget();
  const sessions = detectUserSessions();

  return {
    total_capacity: budget.total,
    capacity: budget.capacity,
    pools: {
      user: {
        budget: budget.user.budget,
        used: budget.user.used,
        mode: budget.user.mode,
        headroom: budget.user.headroom,
        sessions: sessions.headed.map(s => ({ pid: s.pid, type: 'headed' })),
      },
      cecelia: {
        budget: budget.cecelia.budget,
        used: budget.cecelia.used,
      },
      task_pool: {
        budget: budget.taskPool.budget,
        used: budget.taskPool.used,
        available: budget.taskPool.available,
      },
    },
    codex: budget.codex,
    pressure: {
      max: budget.pressure,
      effective_slots: budget.resources.effectiveSlots,
      token: budget.tokenPressure,
    },
    budget_state: budget.budgetState,
    dispatch_allowed: budget.dispatchAllowed,
    headless_count: sessions.headless.length,
  };
}

// ============================================================
// Exports
// ============================================================

export {
  TOTAL_CAPACITY,
  CECELIA_RESERVED,
  USER_RESERVED_BASE,
  USER_PRIORITY_HEADROOM,
  SESSION_TTL_SECONDS,
  getCodexMaxConcurrent,
  CODEX_ACCOUNT_COUNT,
  BACKPRESSURE_THRESHOLD,
  BACKPRESSURE_BURST_LIMIT,
  SLOT_BUFFER_MAX_DELTA,
  SLOT_BUFFER_DOWN,
  SLOT_BUFFER_UP,
  detectUserSessions,
  detectUserMode,
  hasPendingInternalTasks,
  countCeceliaInProgress,
  countAutoDispatchInProgress,
  countCodexInProgress,
  getQueueDepth,
  calculateSlotBudget,
  getSlotStatus,
  applySlotBuffer,
  _resetSlotBuffer,
};
