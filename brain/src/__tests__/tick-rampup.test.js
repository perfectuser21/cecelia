/**
 * Tests for gradual ramp-up dispatch mechanism (PR #302)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing tick.js
vi.mock('../db.js', () => {
  const mockQuery = vi.fn();
  return {
    default: { query: mockQuery },
    __mockQuery: mockQuery
  };
});

vi.mock('../executor.js', () => ({
  checkServerResources: vi.fn(() => ({
    ok: true,
    metrics: { max_pressure: 0.3 }
  })),
  MAX_SEATS: 12,
  INTERACTIVE_RESERVE: 2,
  triggerCeceliaRun: vi.fn(),
  checkCeceliaRunAvailable: vi.fn(),
  getActiveProcessCount: vi.fn(() => 0),
  killProcess: vi.fn(),
  cleanupOrphanProcesses: vi.fn(),
  probeTaskLiveness: vi.fn(() => []),
  syncOrphanTasksOnStartup: vi.fn(),
  killProcessTwoStage: vi.fn(),
  requeueTask: vi.fn(),
  getBillingPause: vi.fn(() => ({ active: false })),
}));

vi.mock('../alertness/index.js', () => ({
  getCurrentAlertness: vi.fn(() => ({
    level: 1,
    levelName: 'CALM'
  })),
  evaluateAlertness: vi.fn(),
  initAlertness: vi.fn(),
  canDispatch: vi.fn(() => true),
  canPlan: vi.fn(() => true),
  getDispatchRate: vi.fn(() => 1.0),
  ALERTNESS_LEVELS: { SLEEPING: 0, CALM: 1, AWARE: 2, ALERT: 3, PANIC: 4 },
  LEVEL_NAMES: ['SLEEPING', 'CALM', 'AWARE', 'ALERT', 'PANIC'],
}));

vi.mock('../slot-allocator.js', () => ({
  calculateSlotBudget: vi.fn(() => ({
    dispatchAllowed: true,
    taskPool: { budget: 10, available: 6 },
    user: { mode: 'absent', used: 0 },
  })),
}));

import pool from '../db.js';
import { checkServerResources } from '../executor.js';
import { getCurrentAlertness, ALERTNESS_LEVELS } from '../alertness/index.js';
import { getRampedDispatchMax } from '../tick.js';

describe('getRampedDispatchMax', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock implementations to defaults
    checkServerResources.mockReturnValue({
      ok: true,
      metrics: { max_pressure: 0.3 }
    });
    getCurrentAlertness.mockReturnValue({
      level: ALERTNESS_LEVELS.CALM,
      levelName: 'CALM'
    });
    // Default: no previous state
    pool.query.mockResolvedValue({ rows: [] });
  });

  it('should start at min(2, max) from cold start to prevent restart burst', async () => {
    // No previous state (cold start) -> currentRate = min(2, 6) = 2
    // CALM + pressure < 0.5 -> +1 -> 3, clamped to ceiling 6
    pool.query.mockResolvedValueOnce({ rows: [] }); // SELECT
    pool.query.mockResolvedValueOnce({ rows: [] }); // INSERT

    const result = await getRampedDispatchMax(6);
    expect(result).toBe(3); // min(2,6)=2 → +1=3 (not 6 which caused token burst)
  });

  it('should start at 1 from cold start when max is 1', async () => {
    // min(2, 1) = 1; CALM + low pressure: +1=2, capped at 1 → result=1
    pool.query.mockResolvedValueOnce({ rows: [] });
    pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await getRampedDispatchMax(1);
    expect(result).toBe(1);
  });

  it('should ramp up by 1 each tick when calm and pressure is low', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ value_json: { current_rate: 3 } }]
    });
    pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await getRampedDispatchMax(6);
    expect(result).toBe(4);
  });

  it('should not exceed ceiling (effectiveDispatchMax)', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ value_json: { current_rate: 5 } }]
    });
    pool.query.mockResolvedValueOnce({ rows: [] });

    // ceiling = 4, rate would go to 6 but clamped
    const result = await getRampedDispatchMax(4);
    expect(result).toBe(4);
  });

  it('should reduce rate when pressure > 0.8', async () => {
    checkServerResources.mockReturnValue({
      ok: true,
      metrics: { max_pressure: 0.85 }
    });

    pool.query.mockResolvedValueOnce({
      rows: [{ value_json: { current_rate: 4 } }]
    });
    pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await getRampedDispatchMax(6);
    expect(result).toBe(3); // 4 - 1
  });

  it('should not reduce below 1 when pressure > 0.8', async () => {
    checkServerResources.mockReturnValue({
      ok: true,
      metrics: { max_pressure: 0.9 }
    });

    pool.query.mockResolvedValueOnce({
      rows: [{ value_json: { current_rate: 1 } }]
    });
    pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await getRampedDispatchMax(6);
    expect(result).toBe(1); // max(1, 1-1) = 1
  });

  it('should reduce rate when alertness is ALERT', async () => {
    // ALERT reduces rate: max(0, 1-1) = 0, but bootstrap guard fires (ALERT < PANIC)
    getCurrentAlertness.mockReturnValue({
      level: ALERTNESS_LEVELS.ALERT,
      levelName: 'ALERT'
    });

    pool.query.mockResolvedValueOnce({
      rows: [{ value_json: { current_rate: 1 } }]
    });
    pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await getRampedDispatchMax(6);
    expect(result).toBe(1); // reduced to 0, then bootstrap → 1
  });

  it('should treat current_rate=0 as full speed (cold start behavior)', async () => {
    // current_rate=0 is treated as effectiveDispatchMax via || fallback
    // ALERT + rate=6: max(0, 6-1) = 5
    getCurrentAlertness.mockReturnValue({
      level: ALERTNESS_LEVELS.ALERT,
      levelName: 'ALERT'
    });

    pool.query.mockResolvedValueOnce({
      rows: [{ value_json: { current_rate: 0 } }]
    });
    pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await getRampedDispatchMax(6);
    expect(result).toBe(5); // current_rate=0 → 6 (fallback), ALERT: 6-1=5
  });

  it('should hold rate steady when pressure is moderate (0.5-0.8) and CALM', async () => {
    checkServerResources.mockReturnValue({
      ok: true,
      metrics: { max_pressure: 0.6 }
    });

    pool.query.mockResolvedValueOnce({
      rows: [{ value_json: { current_rate: 3 } }]
    });
    pool.query.mockResolvedValueOnce({ rows: [] });

    // pressure 0.6 is not < 0.5 so no ramp up, and not > 0.8 so no reduction
    const result = await getRampedDispatchMax(6);
    expect(result).toBe(3);
  });

  it('should ramp up when alertness is AWARE and pressure is low', async () => {
    getCurrentAlertness.mockReturnValue({
      level: ALERTNESS_LEVELS.AWARE,
      levelName: 'AWARE'
    });
    checkServerResources.mockReturnValue({
      ok: true,
      metrics: { max_pressure: 0.3 }
    });

    pool.query.mockResolvedValueOnce({
      rows: [{ value_json: { current_rate: 3 } }]
    });
    pool.query.mockResolvedValueOnce({ rows: [] });

    // AWARE (level=2) <= AWARE + pressure < 0.5 → ramp up: 3+1=4
    const result = await getRampedDispatchMax(6);
    expect(result).toBe(4);
  });

  it('should persist state to working_memory', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }); // SELECT
    pool.query.mockResolvedValueOnce({ rows: [] }); // INSERT

    await getRampedDispatchMax(6);

    // Second call should be the upsert
    const insertCall = pool.query.mock.calls[1];
    expect(insertCall[0]).toContain('INSERT INTO working_memory');
    expect(insertCall[1][0]).toBe('dispatch_ramp_state');
    // Cold start: currentRate=min(2,6)=2, CALM+low pressure: +1=3, capped at 6
    expect(insertCall[1][1]).toHaveProperty('current_rate', 3);
  });

  it('should gradually ramp up from cold start (burst prevention)', async () => {
    const rates = [];
    const ceiling = 4;

    for (let tick = 0; tick < 6; tick++) {
      const currentRate = tick === 0 ? null : rates[tick - 1];
      pool.query.mockResolvedValueOnce({
        rows: tick === 0 ? [] : [{ value_json: { current_rate: currentRate } }]
      });
      pool.query.mockResolvedValueOnce({ rows: [] }); // INSERT

      checkServerResources.mockReturnValue({
        ok: true,
        metrics: { max_pressure: 0.3 }
      });
      getCurrentAlertness.mockReturnValue({
        level: ALERTNESS_LEVELS.CALM,
        levelName: 'CALM'
      });

      const result = await getRampedDispatchMax(ceiling);
      rates.push(result);
    }

    // Cold start: min(2,4)=2 → +1=3 → +1=4 → stays at 4 (ceiling)
    expect(rates).toEqual([3, 4, 4, 4, 4, 4]);
  });

  it('should reduce under high pressure then recover', async () => {
    // Tick 1: rate=4, pressure=0.85 -> 3
    pool.query.mockResolvedValueOnce({
      rows: [{ value_json: { current_rate: 4 } }]
    });
    pool.query.mockResolvedValueOnce({ rows: [] });
    checkServerResources.mockReturnValue({ ok: true, metrics: { max_pressure: 0.85 } });
    getCurrentAlertness.mockReturnValue({ level: ALERTNESS_LEVELS.CALM, levelName: 'CALM' });

    const r1 = await getRampedDispatchMax(6);
    expect(r1).toBe(3);

    // Tick 2: rate=3, pressure back to low -> 4
    pool.query.mockResolvedValueOnce({
      rows: [{ value_json: { current_rate: 3 } }]
    });
    pool.query.mockResolvedValueOnce({ rows: [] });
    checkServerResources.mockReturnValue({ ok: true, metrics: { max_pressure: 0.3 } });

    const r2 = await getRampedDispatchMax(6);
    expect(r2).toBe(4);
  });

  it('should handle PANIC alertness (also >= ALERT)', async () => {
    getCurrentAlertness.mockReturnValue({
      level: ALERTNESS_LEVELS.PANIC,
      levelName: 'PANIC'
    });

    pool.query.mockResolvedValueOnce({
      rows: [{ value_json: { current_rate: 5 } }]
    });
    pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await getRampedDispatchMax(6);
    expect(result).toBe(4); // 5 - 1
  });

  describe('current_rate=0 treated as full speed (cold start fallback)', () => {
    // In the new logic, current_rate=0 is treated as effectiveDispatchMax via || fallback.
    // This means the bootstrap guard for rate=0 is effectively bypassed because
    // currentRate is never 0 after the fallback.

    it('should treat current_rate=0 as full speed with AWARE alertness', async () => {
      // current_rate=0 → effectiveDispatchMax=6 via || fallback
      // AWARE (2) < ALERT (3), not high alertness
      // pressure=0.3 < 0.5 && AWARE <= AWARE → ramp up: 6+1=7, capped at 6
      getCurrentAlertness.mockReturnValue({
        level: ALERTNESS_LEVELS.AWARE,
        levelName: 'AWARE'
      });
      checkServerResources.mockReturnValue({
        ok: true,
        metrics: { max_pressure: 0.3 }
      });

      pool.query.mockResolvedValueOnce({
        rows: [{ value_json: { current_rate: 0 } }]
      });
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await getRampedDispatchMax(6);
      expect(result).toBe(6); // 0 → 6 (fallback), +1=7, capped at 6
    });

    it('should treat current_rate=0 with ALERT as reduced from full speed', async () => {
      // current_rate=0 → 6 via fallback
      // ALERT: max(0, 6-1) = 5
      getCurrentAlertness.mockReturnValue({
        level: ALERTNESS_LEVELS.ALERT,
        levelName: 'ALERT'
      });
      checkServerResources.mockReturnValue({
        ok: true,
        metrics: { max_pressure: 0.3 }
      });

      pool.query.mockResolvedValueOnce({
        rows: [{ value_json: { current_rate: 0 } }]
      });
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await getRampedDispatchMax(6);
      expect(result).toBe(5); // 0 → 6 (fallback), ALERT: 6-1=5
    });

    it('should treat current_rate=0 with PANIC as reduced from full speed', async () => {
      // current_rate=0 → 6 via fallback
      // PANIC (>= ALERT): max(0, 6-1) = 5
      getCurrentAlertness.mockReturnValue({
        level: ALERTNESS_LEVELS.PANIC,
        levelName: 'PANIC'
      });
      checkServerResources.mockReturnValue({
        ok: true,
        metrics: { max_pressure: 0.3 }
      });

      pool.query.mockResolvedValueOnce({
        rows: [{ value_json: { current_rate: 0 } }]
      });
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await getRampedDispatchMax(6);
      expect(result).toBe(5); // 0 → 6 (fallback), PANIC: 6-1=5
    });

    it('should treat current_rate=0 with high pressure as reduced from full speed', async () => {
      // current_rate=0 → 6 via fallback
      // pressure > 0.8: max(1, 6-1) = 5
      getCurrentAlertness.mockReturnValue({
        level: ALERTNESS_LEVELS.AWARE,
        levelName: 'AWARE'
      });
      checkServerResources.mockReturnValue({
        ok: true,
        metrics: { max_pressure: 0.85 }
      });

      pool.query.mockResolvedValueOnce({
        rows: [{ value_json: { current_rate: 0 } }]
      });
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await getRampedDispatchMax(6);
      expect(result).toBe(5); // 0 → 6 (fallback), pressure: max(1, 6-1)=5
    });

    it('should ramp up non-zero rates when AWARE and low pressure', async () => {
      // rate=3, AWARE, low pressure → ramp up: 3+1=4
      getCurrentAlertness.mockReturnValue({
        level: ALERTNESS_LEVELS.AWARE,
        levelName: 'AWARE'
      });
      checkServerResources.mockReturnValue({
        ok: true,
        metrics: { max_pressure: 0.3 }
      });

      pool.query.mockResolvedValueOnce({
        rows: [{ value_json: { current_rate: 3 } }]
      });
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await getRampedDispatchMax(6);
      expect(result).toBe(4); // AWARE <= AWARE + pressure < 0.5 → 3+1=4
    });
  });
});
