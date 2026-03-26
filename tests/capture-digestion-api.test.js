/**
 * Capture Digestion API integration test
 * 验证 /api/capture-atoms 和 /api/life-events 端点行为
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

describe('life-events API', () => {
  let mockFetch;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('GET /api/life-events returns 200 array', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => [{ id: 'uuid', name: '聚餐', event_type: 'meal' }],
    });
    const res = await fetch('/api/life-events');
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it('POST /api/life-events returns 201', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 201,
      json: async () => ({ id: 'new-uuid', name: '看医生', event_type: 'health' }),
    });
    const res = await fetch('/api/life-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '看医生', date: '2026-03-26', event_type: 'health' }),
    });
    expect(res.status).toBe(201);
  });
});
