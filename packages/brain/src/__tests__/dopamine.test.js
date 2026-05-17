import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn().mockResolvedValue({ rows: [] });

vi.mock('../db.js', () => ({
  default: { query: mockQuery },
}));

describe('dopamine reward system', () => {
  it('should export recordReward and getRewardHistory', async () => {
    const mod = await import('../dopamine.js');
    expect(typeof mod.recordReward).toBe('function');
    expect(typeof mod.getRewardHistory).toBe('function');
    expect(typeof mod.getRewardScore).toBe('function');
    expect(typeof mod.initDopamineListeners).toBe('function');
  });

  it('should export reinforcePattern and getHabitPatterns', async () => {
    const mod = await import('../dopamine.js');
    expect(typeof mod.reinforcePattern).toBe('function');
    expect(typeof mod.getHabitPatterns).toBe('function');
  });
});

describe('RPE (Reward Prediction Error)', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('should export computeExpectedReward, recordRPE, getRPEHistory', async () => {
    const mod = await import('../dopamine.js');
    expect(typeof mod.computeExpectedReward).toBe('function');
    expect(typeof mod.recordRPE).toBe('function');
    expect(typeof mod.getRPEHistory).toBe('function');
  });

  it('computeExpectedReward: returns 0.5 when no history', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ avg_actual: null }] });
    const { computeExpectedReward } = await import('../dopamine.js');
    const result = await computeExpectedReward('dev');
    expect(result).toBe(0.5);
  });

  it('computeExpectedReward: returns parsed avg when history exists', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ avg_actual: '0.8' }] });
    const { computeExpectedReward } = await import('../dopamine.js');
    const result = await computeExpectedReward('dev');
    expect(result).toBeCloseTo(0.8);
  });

  it('recordRPE: writes rpe_signal event with correct payload fields', async () => {
    // computeExpectedReward query
    mockQuery.mockResolvedValueOnce({ rows: [{ avg_actual: '0.5' }] });
    // INSERT returning id
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 42 }] });
    // rpe > 0 → no rpe_adjustments query

    const { recordRPE } = await import('../dopamine.js');
    const result = await recordRPE('task-1', 'dev', 1.0);

    expect(result.id).toBe(42);
    expect(result.actual).toBe(1.0);
    expect(result.expected).toBeCloseTo(0.5);
    expect(result.rpe).toBeCloseTo(0.5);

    // Check that INSERT was called with rpe_signal event type
    const insertCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT') && c[0].includes('rpe_signal')
    );
    expect(insertCall).toBeTruthy();
    const payloadArg = JSON.parse(insertCall[1][0]);
    expect(payloadArg).toMatchObject({
      task_id: 'task-1',
      task_type: 'dev',
      actual: 1.0,
    });
    expect(typeof payloadArg.rpe).toBe('number');
  });

  it('recordRPE: writes rpe_adjustments to brain_config when RPE < 0', async () => {
    // computeExpectedReward: avg = 0.8, actual = 0.3 → rpe = -0.5
    mockQuery.mockResolvedValueOnce({ rows: [{ avg_actual: '0.8' }] });
    // INSERT rpe_signal
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 99 }] });
    // SELECT rpe_adjustments
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // UPSERT rpe_adjustments
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { recordRPE } = await import('../dopamine.js');
    const result = await recordRPE('task-2', 'review', 0.3);

    expect(result.rpe).toBeLessThan(0);

    // Verify rpe_adjustments upsert was called
    const upsertCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('rpe_adjustments')
    );
    expect(upsertCall).toBeTruthy();
  });

  it('recordRPE: rpe_adjustments does not go below RPE_ADJUSTMENT_MIN', async () => {
    const { RPE_ADJUSTMENT_MIN } = await import('../dopamine.js');
    // current adjustment already at -2.9, rpe = -0.5 → should clamp to min
    mockQuery.mockResolvedValueOnce({ rows: [{ avg_actual: '1.0' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 100 }] });
    mockQuery.mockResolvedValueOnce({
      rows: [{ value: JSON.stringify({ review: -2.9 }) }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { recordRPE } = await import('../dopamine.js');
    await recordRPE('task-3', 'review', 0.3);

    const upsertCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('rpe_adjustments') && c[0].includes('INSERT')
    );
    expect(upsertCall).toBeTruthy();
    const stored = JSON.parse(upsertCall[1][0]);
    expect(stored.review).toBeGreaterThanOrEqual(RPE_ADJUSTMENT_MIN);
  });

  it('getRPEHistory: queries rpe_signal events', async () => {
    const fakeRows = [{ id: 1, created_at: new Date().toISOString(), payload: { rpe: 0.2 } }];
    mockQuery.mockResolvedValueOnce({ rows: fakeRows });

    const { getRPEHistory } = await import('../dopamine.js');
    const history = await getRPEHistory(12);
    expect(history).toEqual(fakeRows);

    const queryCall = mockQuery.mock.calls[0];
    expect(queryCall[0]).toContain('rpe_signal');
  });
});
