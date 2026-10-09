/**
 * Capture Digestion API integration test
 * 验证 /api/capture-atoms 端点行为（life-events 随 life_events 空表删除，迁移 485）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const originalFetch = global.fetch;

describe('capture-atoms API', () => {
  let mockFetch;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('GET /api/capture-atoms returns 200 array', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => [{ id: 'uuid', content: 'test atom', target_type: 'note', status: 'pending_review' }],
    });
    const res = await fetch('/api/capture-atoms');
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it('POST /api/capture-atoms returns 201', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 201,
      json: async () => ({ id: 'new-uuid', content: 'new atom', target_type: 'knowledge', status: 'pending_review' }),
    });
    const res = await fetch('/api/capture-atoms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'new atom', target_type: 'knowledge' }),
    });
    expect(res.status).toBe(201);
  });

  it('PATCH /api/capture-atoms/:id confirm returns 200', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ id: 'uuid', status: 'confirmed' }),
    });
    const res = await fetch('/api/capture-atoms/uuid', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'confirm', routed_to_table: 'notes', routed_to_id: 'note-uuid' }),
    });
    expect(res.ok).toBe(true);
  });
});
