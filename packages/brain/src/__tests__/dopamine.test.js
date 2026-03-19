import { describe, it, expect, vi } from 'vitest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
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
