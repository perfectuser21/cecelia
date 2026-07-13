import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDispatch = vi.hoisted(() => vi.fn());
vi.mock('../line-strategist-dispatch.js', () => ({ dispatchStrategistDecisions: mockDispatch }));

const { tick } = await import('../line-strategist-dispatch-plugin.js');

describe('line-strategist-dispatch-plugin tick', () => {
  beforeEach(() => mockDispatch.mockReset());

  it('runs dispatch and updates tickState timestamp when interval elapsed', async () => {
    mockDispatch.mockResolvedValueOnce({ scanned: 1, dispatched: 1, skipped_duplicate: 0, marked: 1 });
    const tickState = { lastLineStrategistDispatchTime: 0 };
    const pool = {};

    const result = await tick({ pool, tickState, intervalMs: 1000 });

    expect(mockDispatch).toHaveBeenCalledWith(pool);
    expect(result).toEqual({ scanned: 1, dispatched: 1, skipped_duplicate: 0, marked: 1 });
    expect(tickState.lastLineStrategistDispatchTime).toBeGreaterThan(0);
  });

  it('skips when interval has not elapsed', async () => {
    const tickState = { lastLineStrategistDispatchTime: Date.now() };
    const pool = {};

    const result = await tick({ pool, tickState, intervalMs: 60000 });

    expect(result).toEqual({ skipped: true, reason: 'throttled' });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('catches errors from dispatchStrategistDecisions and returns error object', async () => {
    mockDispatch.mockRejectedValueOnce(new Error('db down'));
    const tickState = { lastLineStrategistDispatchTime: 0 };
    const pool = {};

    const result = await tick({ pool, tickState, intervalMs: 1000 });

    expect(result).toEqual({ error: 'db down' });
  });
});
