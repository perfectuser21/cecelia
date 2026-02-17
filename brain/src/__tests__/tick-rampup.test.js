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

  it('should start at 1 from cold start (no previous state, calm + low pressure)', async () => {
    // No previous state -> current_rate = 0
    // CALM + pressure < 0.5 -> +1 -> newRate = 1
    pool.query.mockResolvedValueOnce({ rows: [] }); // SELECT
    pool.query.mockResolvedValueOnce({ rows: [] }); // INSERT

    const result = await getRampedDispatchMax(6);
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

  it('should reduce rate to 0 when alertness >= ALERT', async () => {
    getCurrentAlertness.mockReturnValue({
      level: ALERTNESS_LEVELS.ALERT,
      levelName: 'ALERT'
    });

    pool.query.mockResolvedValueOnce({
      rows: [{ value_json: { current_rate: 1 } }]
    });
    pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await getRampedDispatchMax(6);
    expect(result).toBe(0); // max(0, 1-1) = 0
  });

  it('should keep rate at 0 when alertness is ALERT and already at 0', async () => {
    getCurrentAlertness.mockReturnValue({
      level: ALERTNESS_LEVELS.ALERT,
      levelName: 'ALERT'
    });

    pool.query.mockResolvedValueOnce({
      rows: [{ value_json: { current_rate: 0 } }]
    });
    pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await getRampedDispatchMax(6);
    expect(result).toBe(0);
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

  it('should not ramp up when alertness is AWARE (not CALM)', async () => {
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

    // AWARE + low pressure: no change (only CALM ramps up)
    const result = await getRampedDispatchMax(6);
    expect(result).toBe(3);
  });

  it('should persist state to working_memory', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }); // SELECT
    pool.query.mockResolvedValueOnce({ rows: [] }); // INSERT

    await getRampedDispatchMax(6);

    // Second call should be the upsert
    const insertCall = pool.query.mock.calls[1];
    expect(insertCall[0]).toContain('INSERT INTO working_memory');
    expect(insertCall[1][0]).toBe('dispatch_ramp_state');
    expect(insertCall[1][1]).toHaveProperty('current_rate', 1);
  });

  it('should simulate gradual ramp-up sequence from 0 to ceiling', async () => {
    const rates = [];
    const ceiling = 4;

    for (let tick = 0; tick < 6; tick++) {
      const currentRate = tick === 0 ? 0 : rates[tick - 1];
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

    // Should gradually increase: 1, 2, 3, 4, 4, 4
    expect(rates).toEqual([1, 2, 3, 4, 4, 4]);
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

  describe('Bootstrap guard (防死锁)', () => {
    it('should bootstrap to 1 when stuck at 0 with AWARE alertness and low pressure', async () => {
      // This is the deadlock scenario: current_rate=0, AWARE, normal resources
      // Without bootstrap guard: stable → stays 0 forever
      // With bootstrap guard: → returns 1
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
      expect(result).toBe(1); // bootstrap: 0 → 1
    });

    it('should NOT bootstrap when alertness is ALERT (high stress)', async () => {
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
      expect(result).toBe(0); // ALERT >= ALERT → no bootstrap
    });

    it('should NOT bootstrap when pressure >= 0.8 (resource stress, already handled by pressure path)', async () => {
      // When pressure > 0.8 and currentRate=0: Math.max(1, 0-1) = 1 (from pressure path)
      // Bootstrap guard is not needed: pressure path already produces newRate=1
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

      // Pressure path: Math.max(1, 0-1) = 1, bootstrap guard doesn't apply (newRate != 0)
      const result = await getRampedDispatchMax(6);
      expect(result).toBe(1);
    });

    it('should not affect non-zero rates when AWARE (only bootstraps from 0)', async () => {
      // Existing test: rate=3, AWARE → stays 3 (bootstrap guard doesn't trigger because newRate != 0)
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
      expect(result).toBe(3); // stable at 3, no bootstrap needed
    });
  });
});
