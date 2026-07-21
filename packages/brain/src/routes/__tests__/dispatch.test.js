import { describe, it, expect, vi } from 'vitest';

const mockPool = { query: vi.fn() };
const mockGetLlmCapacitySnapshot = vi.fn();

vi.mock('../../db.js', () => ({ default: mockPool }));
vi.mock('../../llm-capacity.js', () => ({
  getLlmCapacitySnapshot: (...args) => mockGetLlmCapacitySnapshot(...args),
}));

describe('dispatch routes', () => {
  it('GET /dispatch/recent handler returns events', async () => {
    const { buildRecentDispatchEventsHandler } = await import('../dispatch.js');
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: '1', task_id: 't1', event_type: 'skip', reason: 'x', created_at: '2026-07-21T00:00:00Z' }] });
    const handler = buildRecentDispatchEventsHandler(mockPool);
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
    await handler({ query: { limit: '5' } }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ total: 1, limit: 5 }));
  });

  it('GET /dispatch/llm-capacity handler returns snapshot', async () => {
    const { buildLlmCapacityHandler } = await import('../dispatch.js');
    mockGetLlmCapacitySnapshot.mockResolvedValueOnce({
      sentinel: 'ok',
      vendors: { claude: { available_count: 1 } },
    });
    const handler = buildLlmCapacityHandler(mockGetLlmCapacitySnapshot);
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
    await handler({}, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ sentinel: 'ok' }));
  });
});
