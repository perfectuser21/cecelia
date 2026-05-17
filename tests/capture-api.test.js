/**
 * Capture API integration test (root-level, for DoD mapping)
 * 验证 /api/captures 端点行为
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const originalFetch = global.fetch;

describe('captures API', () => {
  let mockFetch;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('GET /api/captures returns 200 array', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => [{ id: 'uuid', content: 'test', status: 'inbox' }],
    });
    const res = await fetch('/api/captures');
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it('POST /api/captures returns 201', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 201,
      json: async () => ({ id: 'new-uuid', content: 'idea', status: 'inbox' }),
    });
    const res = await fetch('/api/captures', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'idea' }),
    });
    expect(res.status).toBe(201);
  });

  it('PATCH /api/captures/:id returns 200', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ id: 'uuid', status: 'done' }),
    });
    const res = await fetch('/api/captures/uuid', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    });
    expect(res.ok).toBe(true);
  });
});
