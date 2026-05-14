import { describe, it, expect } from 'vitest';
import { calculate, KR3_MILESTONE_KEYS } from '../kr3-progress-calculator.js';

const makePool = (completedKeys = []) => ({
  query: async () => ({ rows: completedKeys.map(topic => ({ topic })) }),
});

describe('kr3-progress-calculator', () => {
  it('returns base 60% when no milestones completed', async () => {
    const result = await calculate(makePool([]));
    expect(result.progress_pct).toBe(60);
    expect(result.stage).toBe('code_ready');
  });

  it('adds weight for each completed milestone', async () => {
    const keys = [KR3_MILESTONE_KEYS.CLOUD_FUNCTIONS_DEPLOYED];
    const result = await calculate(makePool(keys));
    expect(result.progress_pct).toBe(70); // 60 + 10
  });

  it('returns 100% when all milestones complete', async () => {
    const keys = Object.values(KR3_MILESTONE_KEYS);
    const result = await calculate(makePool(keys));
    expect(result.progress_pct).toBe(100);
  });

  it('falls back to 60% when db throws', async () => {
    const brokenPool = { query: async () => { throw new Error('db error'); } };
    const result = await calculate(brokenPool);
    expect(result.progress_pct).toBe(60);
    expect(result.breakdown).toEqual({});
  });

  it('breakdown includes done:true for completed milestones', async () => {
    const keys = [KR3_MILESTONE_KEYS.AUDIT_PASSED];
    const result = await calculate(makePool(keys));
    expect(result.breakdown[KR3_MILESTONE_KEYS.AUDIT_PASSED].done).toBe(true);
  });
});
