import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../../alerting.js', () => ({ raise: vi.fn() }));

describe('healing', () => {
  it('exports startRecovery function', async () => {
    const { startRecovery } = await import('../healing.js');
    expect(typeof startRecovery).toBe('function');
  });
});
