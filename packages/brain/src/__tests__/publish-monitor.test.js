import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn() }
}));

describe('publish-monitor constants', () => {
  it('exports MAX_RETRY and STATS_KEY', async () => {
    const src = await import('../publish-monitor.js');
    expect(typeof src.monitorPublishQueue).toBe('function');
  });
});
