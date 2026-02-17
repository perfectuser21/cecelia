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

import { execSync } from 'child_process';
import { MAX_SEATS, checkServerResources, getActiveProcessCount } from './executor.js';
import pool from './db.js';

// ============================================================
// Constants
// ============================================================

const TOTAL_CAPACITY = MAX_SEATS;           // 12 on 8-core 16GB
const CECELIA_RESERVED = 1;                  // Pool A: 1 slot for internal tasks
const USER_RESERVED_BASE = 2;                // Pool B: minimum when user absent
const USER_PRIORITY_HEADROOM = 2;            // Extra free slots when user is active
const SESSION_TTL_SECONDS = 4 * 60 * 60;    // 4 hours: orphaned sessions expire (worktree leftovers etc.)

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
 */
function detectUserSessions() {
  try {
    // Include etimes (elapsed time in seconds) for TTL filtering
    const output = execSync(
      "ps -eo pid,etimes,comm,args --no-headers 2>/dev/null | awk '$3 == \"claude\" {print}'",
      { encoding: 'utf-8', timeout: 3000 }
    ).trim();

    if (!output) return { headed: [], headless: [], total: 0 };

    const headed = [];
    const headless = [];

    for (const line of output.split('\n').filter(Boolean)) {
      const parts = line.trim().split(/\s+/);
      const pid = parseInt(parts[0], 10);
      const elapsedSec = parseInt(parts[1], 10);
      // parts[2] = "claude" (comm), parts[3+] = args
      const args = parts.slice(3).join(' ');

      if (isNaN(pid)) continue;

      // `claude -p "..."` or `claude --print "..."` = headless (Cecelia dispatched)
      if (/ -p /.test(args) || /^-p /.test(args) || / --print /.test(args)) {
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

// ============================================================
// Slot Budget Calculation
// ============================================================

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

  // Pool B: user slots = used + headroom (or base if absent)
  let userBudget;
  if (userMode === 'team') {
    // Team mode: user needs lots of slots, yield everything possible
    userBudget = userSlotsUsed + USER_PRIORITY_HEADROOM;
  } else if (userMode === 'interactive') {
    // Interactive: keep headroom for additional sessions
    userBudget = userSlotsUsed + USER_PRIORITY_HEADROOM;
  } else {
    // Absent: base reservation (ready for user to appear)
    userBudget = USER_RESERVED_BASE;
  }

  // Pool A: Cecelia internal (on-demand)
  const hasInternalWork = await hasPendingInternalTasks();
  // In team mode, Cecelia also yields
  const ceceliaNeeded = (hasInternalWork && userMode !== 'team') ? CECELIA_RESERVED : 0;

  // Pool C: remaining capacity after A and B
  const poolCRaw = Math.max(0, TOTAL_CAPACITY - userBudget - ceceliaNeeded);

  // Further throttle by resource pressure
  const resources = checkServerResources();
  const poolCBudget = Math.min(poolCRaw, resources.effectiveSlots);

  // Count actual usage
  const ceceliaUsed = await countCeceliaInProgress();
  const autoDispatchUsed = await countAutoDispatchInProgress();

  return {
    total: TOTAL_CAPACITY,
    user: {
      budget: userBudget,
      used: userSlotsUsed,
      mode: userMode,
      headroom: Math.max(0, userBudget - userSlotsUsed),
    },
    cecelia: {
      budget: ceceliaNeeded,
      used: ceceliaUsed,
    },
    taskPool: {
      budget: poolCBudget,
      used: autoDispatchUsed,
      available: Math.max(0, poolCBudget - autoDispatchUsed),
    },
    pressure: resources.metrics.max_pressure,
    resources: {
      effectiveSlots: resources.effectiveSlots,
      maxPressure: resources.metrics.max_pressure,
    },
    dispatchAllowed: poolCBudget > autoDispatchUsed,
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
    pressure: {
      max: budget.pressure,
      effective_slots: budget.resources.effectiveSlots,
    },
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
  detectUserSessions,
  detectUserMode,
  hasPendingInternalTasks,
  countCeceliaInProgress,
  countAutoDispatchInProgress,
  calculateSlotBudget,
  getSlotStatus,
};
