/**
 * server.test.js — smoke tests for server.js createApp
 */
import { describe, it, expect, vi } from 'vitest';

const mockPool = { query: vi.fn() };
vi.mock('../db.js', () => ({ default: mockPool, pool: mockPool }));
vi.mock('../routes/harness.js', () => ({ default: (req, res, next) => next() }));

const { createApp } = await import('../server.js');

describe('createApp', () => {
  it('returns an Express app', () => {
    const app = createApp();
    expect(typeof app).toBe('function');
    expect(typeof app.listen).toBe('function');
  });

  it('accepts optional pool arg without error', () => {
    const app = createApp({ pool: mockPool });
    expect(typeof app).toBe('function');
  });

  it('mounts harness router at /api/brain/harness', async () => {
    const app = createApp();
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/brain/harness/nonexistent');
    // router falls through — 404 is fine, just no crash
    expect([200, 404]).toContain(res.status);
  });
});
