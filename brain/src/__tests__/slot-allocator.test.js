/**
 * Slot Allocator Tests
 *
 * Tests for the three-pool slot allocation system:
 *   Pool A (Cecelia Reserved): Internal tasks
 *   Pool B (User Reserved): Headed sessions + headroom
 *   Pool C (Dynamic Task Pool): Auto-dispatched tasks
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock child_process before importing the module
vi.mock('child_process', () => ({
  execSync: vi.fn(() => ''),
}));

// Mock executor.js
vi.mock('../executor.js', () => ({
  MAX_SEATS: 12,
  checkServerResources: vi.fn(() => ({
    effectiveSlots: 12,
    metrics: { max_pressure: 0.1 },
  })),
  getActiveProcessCount: vi.fn(() => 0),
}));

// Mock db.js
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(() => Promise.resolve({ rows: [{ count: '0' }] })),
  },
}));

import { execSync } from 'child_process';
import { checkServerResources } from '../executor.js';
import pool from '../db.js';
import {
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
} from '../slot-allocator.js';

// ============================================================
// Constants
// ============================================================

describe('Slot Allocator Constants', () => {
  it('should export correct constants', () => {
    expect(TOTAL_CAPACITY).toBe(12);
    expect(CECELIA_RESERVED).toBe(1);
    expect(USER_RESERVED_BASE).toBe(2);
    expect(USER_PRIORITY_HEADROOM).toBe(2);
    expect(SESSION_TTL_SECONDS).toBe(4 * 60 * 60); // 4 hours
  });

  it('TOTAL_CAPACITY equals MAX_SEATS from executor', () => {
    expect(TOTAL_CAPACITY).toBe(12); // MAX_SEATS mock = 12
  });
});

// ============================================================
// detectUserSessions
// ============================================================

describe('detectUserSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty when no claude processes', () => {
    execSync.mockReturnValue('');
    const result = detectUserSessions();
    expect(result).toEqual({ headed: [], headless: [], total: 0 });
  });

  // ps output format: pid etimes comm args (etimes = elapsed seconds)
  it('should classify headed sessions (no -p flag)', () => {
    execSync.mockReturnValue(
      '12345 300 claude claude --resume abc123\n'
    );
    const result = detectUserSessions();
    expect(result.headed).toHaveLength(1);
    expect(result.headed[0].pid).toBe(12345);
    expect(result.headless).toHaveLength(0);
    expect(result.total).toBe(1);
  });

  it('should classify headless sessions (with -p flag)', () => {
    execSync.mockReturnValue(
      '12345 300 claude claude -p "do something"\n'
    );
    const result = detectUserSessions();
    expect(result.headless).toHaveLength(1);
    expect(result.headless[0].pid).toBe(12345);
    expect(result.headed).toHaveLength(0);
    expect(result.total).toBe(1);
  });

  it('should classify headless sessions (with --print flag)', () => {
    execSync.mockReturnValue(
      '99999 300 claude claude --print "task prompt"\n'
    );
    const result = detectUserSessions();
    expect(result.headless).toHaveLength(1);
    expect(result.headed).toHaveLength(0);
  });

  it('should handle mix of headed and headless', () => {
    execSync.mockReturnValue(
      '100 300 claude claude --resume sess1\n' +
      '200 300 claude claude -p "decompose"\n' +
      '300 300 claude claude\n' +
      '400 300 claude claude -p "dev task"\n'
    );
    const result = detectUserSessions();
    expect(result.headed).toHaveLength(2); // pid 100, 300
    expect(result.headless).toHaveLength(2); // pid 200, 400
    expect(result.total).toBe(4);
  });

  it('should handle execSync error gracefully', () => {
    execSync.mockImplementation(() => { throw new Error('ps failed'); });
    const result = detectUserSessions();
    expect(result).toEqual({ headed: [], headless: [], total: 0 });
  });

  it('should truncate args to 100 chars', () => {
    const longArgs = 'claude -p "' + 'x'.repeat(200) + '"';
    execSync.mockReturnValue(`12345 300 claude ${longArgs}\n`);
    const result = detectUserSessions();
    expect(result.headless[0].args.length).toBeLessThanOrEqual(100);
  });

  // --- Session TTL filtering ---

  it('should filter out headed sessions older than SESSION_TTL_SECONDS', () => {
    const oldElapsed = SESSION_TTL_SECONDS + 1; // 1 second past TTL
    execSync.mockReturnValue(
      `99001 ${oldElapsed} claude claude --resume old-session\n`
    );
    const result = detectUserSessions();
    // Old session should be excluded from headed count
    expect(result.headed).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('should include headed sessions within SESSION_TTL_SECONDS', () => {
    const freshElapsed = SESSION_TTL_SECONDS - 1; // 1 second before TTL
    execSync.mockReturnValue(
      `99002 ${freshElapsed} claude claude --resume fresh-session\n`
    );
    const result = detectUserSessions();
    expect(result.headed).toHaveLength(1);
    expect(result.headed[0].pid).toBe(99002);
  });

  it('TTL does not apply to headless sessions (always included)', () => {
    const oldElapsed = SESSION_TTL_SECONDS + 10000; // way past TTL
    execSync.mockReturnValue(
      `99003 ${oldElapsed} claude claude -p "old headless task"\n`
    );
    const result = detectUserSessions();
    // Headless sessions are not filtered by TTL (they are managed tasks, not user sessions)
    expect(result.headless).toHaveLength(1);
  });

  it('mix of fresh and stale headed sessions — only fresh counted', () => {
    const freshElapsed = 300; // 5 minutes — fresh
    const staleElapsed = SESSION_TTL_SECONDS + 3600; // 5 hours — stale
    execSync.mockReturnValue(
      `100 ${freshElapsed} claude claude --resume fresh\n` +
      `200 ${staleElapsed} claude claude --resume stale\n` +
      `300 ${freshElapsed} claude claude\n`
    );
    const result = detectUserSessions();
    expect(result.headed).toHaveLength(2); // pid 100, 300 (fresh)
    expect(result.headed.map(s => s.pid)).toContain(100);
    expect(result.headed.map(s => s.pid)).toContain(300);
    expect(result.headed.map(s => s.pid)).not.toContain(200);
  });

  it('with TTL filtering: 1 fresh + 2 stale → interactive mode (not team)', () => {
    const fresh = 600; // 10 minutes
    const stale = SESSION_TTL_SECONDS + 3600; // 5 hours
    execSync.mockReturnValue(
      `100 ${stale} claude claude\n` +   // stale → filtered
      `200 ${stale} claude claude\n` +   // stale → filtered
      `300 ${fresh} claude claude\n`     // fresh → counted
    );
    const result = detectUserSessions();
    expect(result.headed).toHaveLength(1); // only PID 300
    expect(detectUserMode(result)).toBe('interactive'); // not team!
  });
});

// ============================================================
// detectUserMode
// ============================================================

describe('detectUserMode', () => {
  it('should return "absent" when no headed sessions', () => {
    expect(detectUserMode({ headed: [], headless: [] })).toBe('absent');
  });

  it('should return "interactive" with 1 headed session', () => {
    expect(detectUserMode({ headed: [{ pid: 1 }], headless: [] })).toBe('interactive');
  });

  it('should return "interactive" with 2 headed sessions', () => {
    expect(detectUserMode({
      headed: [{ pid: 1 }, { pid: 2 }],
      headless: [],
    })).toBe('interactive');
  });

  it('should return "team" with 3 headed sessions', () => {
    expect(detectUserMode({
      headed: [{ pid: 1 }, { pid: 2 }, { pid: 3 }],
      headless: [],
    })).toBe('team');
  });

  it('should return "team" with 5 headed sessions', () => {
    expect(detectUserMode({
      headed: Array.from({ length: 5 }, (_, i) => ({ pid: i })),
      headless: [],
    })).toBe('team');
  });

  it('should ignore headless count for mode detection', () => {
    expect(detectUserMode({
      headed: [],
      headless: Array.from({ length: 10 }, (_, i) => ({ pid: i })),
    })).toBe('absent');
  });

  it('should handle null/undefined input', () => {
    expect(detectUserMode(null)).toBe('absent');
    expect(detectUserMode(undefined)).toBe('absent');
    expect(detectUserMode({})).toBe('absent');
  });
});

// ============================================================
// DB-backed functions
// ============================================================

describe('hasPendingInternalTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return true when internal tasks exist', async () => {
    pool.query.mockResolvedValue({ rows: [{ count: '2' }] });
    expect(await hasPendingInternalTasks()).toBe(true);
  });

  it('should return false when no internal tasks', async () => {
    pool.query.mockResolvedValue({ rows: [{ count: '0' }] });
    expect(await hasPendingInternalTasks()).toBe(false);
  });

  it('should return false on DB error', async () => {
    pool.query.mockRejectedValue(new Error('DB connection error'));
    expect(await hasPendingInternalTasks()).toBe(false);
  });
});

describe('countCeceliaInProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return count of internal in_progress tasks', async () => {
    pool.query.mockResolvedValue({ rows: [{ count: '3' }] });
    expect(await countCeceliaInProgress()).toBe(3);
  });

  it('should return 0 on DB error', async () => {
    pool.query.mockRejectedValue(new Error('DB error'));
    expect(await countCeceliaInProgress()).toBe(0);
  });
});

describe('countAutoDispatchInProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return count of auto-dispatched in_progress tasks', async () => {
    pool.query.mockResolvedValue({ rows: [{ count: '5' }] });
    expect(await countAutoDispatchInProgress()).toBe(5);
  });

  it('should return 0 on DB error', async () => {
    pool.query.mockRejectedValue(new Error('DB error'));
    expect(await countAutoDispatchInProgress()).toBe(0);
  });
});

// ============================================================
// calculateSlotBudget — Pool Math
// ============================================================

describe('calculateSlotBudget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no processes, no pressure, no DB tasks
    execSync.mockReturnValue('');
    checkServerResources.mockReturnValue({
      effectiveSlots: 12,
      metrics: { max_pressure: 0.1 },
    });
    pool.query.mockResolvedValue({ rows: [{ count: '0' }] });
  });

  it('should return correct structure', async () => {
    const budget = await calculateSlotBudget();
    expect(budget).toHaveProperty('total');
    expect(budget).toHaveProperty('user');
    expect(budget).toHaveProperty('cecelia');
    expect(budget).toHaveProperty('taskPool');
    expect(budget).toHaveProperty('pressure');
    expect(budget).toHaveProperty('resources');
    expect(budget).toHaveProperty('dispatchAllowed');
  });

  // --- Absent mode (no user sessions) ---

  it('absent mode: user budget = USER_RESERVED_BASE', async () => {
    const budget = await calculateSlotBudget();
    expect(budget.user.mode).toBe('absent');
    expect(budget.user.budget).toBe(USER_RESERVED_BASE); // 2
    expect(budget.user.used).toBe(0);
  });

  it('absent mode: Pool C = total - user_base - cecelia(0) = 10', async () => {
    // No internal tasks → cecelia budget = 0
    const budget = await calculateSlotBudget();
    expect(budget.cecelia.budget).toBe(0);
    expect(budget.taskPool.budget).toBe(10); // 12 - 2 - 0
  });

  it('absent mode with internal tasks: Pool C = total - user_base - cecelia(1) = 9', async () => {
    // First call: hasPendingInternalTasks → count > 0
    // Subsequent calls: countCeceliaInProgress, countAutoDispatchInProgress → 0
    pool.query
      .mockResolvedValueOnce({ rows: [{ count: '1' }] }) // hasPendingInternalTasks
      .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // countCeceliaInProgress
      .mockResolvedValueOnce({ rows: [{ count: '0' }] }); // countAutoDispatchInProgress

    const budget = await calculateSlotBudget();
    expect(budget.cecelia.budget).toBe(1);
    expect(budget.taskPool.budget).toBe(9); // 12 - 2 - 1
  });

  // --- Interactive mode (1-2 headed sessions) ---

  it('interactive mode: user budget = used + headroom', async () => {
    execSync.mockReturnValue('100 300 claude claude --resume s1\n');

    const budget = await calculateSlotBudget();
    expect(budget.user.mode).toBe('interactive');
    expect(budget.user.used).toBe(1);
    expect(budget.user.budget).toBe(1 + USER_PRIORITY_HEADROOM); // 3
    expect(budget.user.headroom).toBe(USER_PRIORITY_HEADROOM); // 2
  });

  it('interactive mode with 2 headed: Pool C = 12 - 4 - 0 = 8', async () => {
    execSync.mockReturnValue(
      '100 300 claude claude --resume s1\n' +
      '200 300 claude claude --resume s2\n'
    );

    const budget = await calculateSlotBudget();
    expect(budget.user.mode).toBe('interactive');
    expect(budget.user.budget).toBe(4); // 2 + 2
    expect(budget.taskPool.budget).toBe(8); // 12 - 4 - 0
  });

  // --- Team mode (3+ headed sessions) ---

  it('team mode: user budget = used + headroom', async () => {
    execSync.mockReturnValue(
      '100 300 claude claude\n' +
      '200 300 claude claude\n' +
      '300 300 claude claude\n'
    );

    const budget = await calculateSlotBudget();
    expect(budget.user.mode).toBe('team');
    expect(budget.user.used).toBe(3);
    expect(budget.user.budget).toBe(3 + USER_PRIORITY_HEADROOM); // 5
  });

  it('team mode: Cecelia yields its slot (budget=0) even with internal work', async () => {
    execSync.mockReturnValue(
      '100 300 claude claude\n200 300 claude claude\n300 300 claude claude\n'
    );
    pool.query
      .mockResolvedValueOnce({ rows: [{ count: '1' }] }) // hasPendingInternalTasks = true
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const budget = await calculateSlotBudget();
    expect(budget.cecelia.budget).toBe(0); // yields in team mode
  });

  it('team mode with 4 agents: Pool C = 12 - 6 - 0 = 6', async () => {
    execSync.mockReturnValue(
      '100 300 claude claude\n200 300 claude claude\n' +
      '300 300 claude claude\n400 300 claude claude\n'
    );

    const budget = await calculateSlotBudget();
    expect(budget.user.budget).toBe(6); // 4 + 2
    expect(budget.taskPool.budget).toBe(6); // 12 - 6 - 0
  });

  // --- TTL: stale sessions do not trigger team mode ---

  it('TTL filtering: 1 fresh + 2 stale = interactive (not team), Pool C larger', async () => {
    const fresh = 300;
    const stale = SESSION_TTL_SECONDS + 3600;
    execSync.mockReturnValue(
      `100 ${stale} claude claude\n` +   // stale → filtered
      `200 ${stale} claude claude\n` +   // stale → filtered
      `300 ${fresh} claude claude\n`     // fresh → counted
    );

    const budget = await calculateSlotBudget();
    expect(budget.user.mode).toBe('interactive'); // only 1 active session
    expect(budget.user.used).toBe(1);
    expect(budget.user.budget).toBe(3); // 1 + 2 headroom
    expect(budget.taskPool.budget).toBe(9); // 12 - 3(user) - 0(cecelia, no internal tasks) = 9
  });

  // --- Pool C never negative ---

  it('Pool C never goes negative even when user takes most slots', async () => {
    // 10 headed sessions → user budget = 12 (10+2), but total is 12
    execSync.mockReturnValue(
      Array.from({ length: 10 }, (_, i) => `${100 + i} 300 claude claude`).join('\n') + '\n'
    );

    const budget = await calculateSlotBudget();
    expect(budget.taskPool.budget).toBeGreaterThanOrEqual(0);
  });

  // --- Pressure throttling ---

  it('should throttle Pool C by resource pressure', async () => {
    checkServerResources.mockReturnValue({
      effectiveSlots: 4, // pressure limits to 4
      metrics: { max_pressure: 0.7 },
    });

    const budget = await calculateSlotBudget();
    // Pool C raw = 12 - 2 = 10, but effectiveSlots = 4
    expect(budget.taskPool.budget).toBe(4);
    expect(budget.pressure).toBe(0.7);
  });

  // --- dispatchAllowed flag ---

  it('dispatchAllowed is true when Pool C has available slots', async () => {
    const budget = await calculateSlotBudget();
    expect(budget.dispatchAllowed).toBe(true);
  });

  it('dispatchAllowed is false when Pool C is full', async () => {
    // Make autoDispatchUsed = pool C budget
    pool.query
      .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // hasPendingInternalTasks
      .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // countCeceliaInProgress
      .mockResolvedValueOnce({ rows: [{ count: '10' }] }); // countAutoDispatchInProgress = 10

    const budget = await calculateSlotBudget();
    // Pool C budget = 10, used = 10 → available = 0
    expect(budget.taskPool.available).toBe(0);
    expect(budget.dispatchAllowed).toBe(false);
  });
});

// ============================================================
// getSlotStatus (API format)
// ============================================================

describe('getSlotStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execSync.mockReturnValue('');
    checkServerResources.mockReturnValue({
      effectiveSlots: 12,
      metrics: { max_pressure: 0.1 },
    });
    pool.query.mockResolvedValue({ rows: [{ count: '0' }] });
  });

  it('should return API-formatted status', async () => {
    const status = await getSlotStatus();
    expect(status).toHaveProperty('total_capacity', 12);
    expect(status).toHaveProperty('pools');
    expect(status.pools).toHaveProperty('user');
    expect(status.pools).toHaveProperty('cecelia');
    expect(status.pools).toHaveProperty('task_pool');
    expect(status).toHaveProperty('pressure');
    expect(status).toHaveProperty('dispatch_allowed');
    expect(status).toHaveProperty('headless_count');
  });

  it('should include session PIDs in user pool', async () => {
    execSync.mockReturnValue('12345 300 claude claude --resume s1\n');
    const status = await getSlotStatus();
    expect(status.pools.user.sessions).toEqual([
      { pid: 12345, type: 'headed' },
    ]);
  });
});
