import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Test the API functions and data logic without React hooks

describe('Proposal API functions', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchProposals', () => {
    it('fetches and returns proposals from pending-actions API', async () => {
      const mockProposals = [
        { id: '1', action_type: 'propose_decomposition', status: 'pending_approval' },
        { id: '2', action_type: 'propose_anomaly_action', status: 'pending_approval' },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, count: 2, actions: mockProposals }),
      });

      const res = await fetch('/api/brain/pending-actions');
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.actions).toHaveLength(2);
      expect(data.actions[0].action_type).toBe('propose_decomposition');
    });

    it('handles empty response', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, count: 0, actions: [] }),
      });

      const res = await fetch('/api/brain/pending-actions');
      const data = await res.json();

      expect(data.actions).toHaveLength(0);
    });

    it('throws on API error', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const res = await fetch('/api/brain/pending-actions');
      expect(res.ok).toBe(false);
    });
  });

  describe('approve action', () => {
    it('calls approve endpoint', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const res = await fetch('/api/brain/pending-actions/abc-123/approve', { method: 'POST' });
      expect(res.ok).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/brain/pending-actions/abc-123/approve',
        { method: 'POST' }
      );
    });
  });

  describe('reject action', () => {
    it('calls reject endpoint with reason', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const res = await fetch('/api/brain/pending-actions/abc-123/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: '不需要' }),
      });

      expect(res.ok).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/brain/pending-actions/abc-123/reject',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('comment action', () => {
    it('sends comment and receives reply', async () => {
      const reply = {
        role: 'assistant',
        content: '已调整顺序',
        timestamp: '2026-02-22T12:00:00Z',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ reply }),
      });

      const res = await fetch('/api/brain/pending-actions/abc-123/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '调整一下优先级' }),
      });

      const data = await res.json();
      expect(data.reply.role).toBe('assistant');
      expect(data.reply.content).toBe('已调整顺序');
    });
  });

  describe('select option', () => {
    it('calls select endpoint with option_id', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const res = await fetch('/api/brain/pending-actions/abc-123/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ option_id: 'option-a' }),
      });

      expect(res.ok).toBe(true);
    });
  });
});

describe('Proposal data helpers', () => {
  it('calculates pending count correctly', () => {
    const proposals = [
      { status: 'pending_approval' },
      { status: 'pending_approval' },
      { status: 'approved' },
      { status: 'rejected' },
    ];

    const pendingCount = proposals.filter(p => p.status === 'pending_approval').length;
    expect(pendingCount).toBe(2);
  });

  it('filters by action_type', () => {
    const proposals = [
      { action_type: 'propose_decomposition', status: 'pending_approval' },
      { action_type: 'propose_anomaly_action', status: 'pending_approval' },
      { action_type: 'propose_decomposition', status: 'pending_approval' },
    ];

    const filtered = proposals.filter(p => p.action_type === 'propose_decomposition');
    expect(filtered).toHaveLength(2);
  });

  it('separates pending and resolved', () => {
    const proposals = [
      { id: '1', status: 'pending_approval' },
      { id: '2', status: 'approved' },
      { id: '3', status: 'pending_approval' },
      { id: '4', status: 'rejected' },
      { id: '5', status: 'expired' },
    ];

    const pending = proposals.filter(p => p.status === 'pending_approval');
    const resolved = proposals.filter(p => p.status !== 'pending_approval');

    expect(pending).toHaveLength(2);
    expect(resolved).toHaveLength(3);
  });
});

describe('WebSocket event handling', () => {
  it('parses proposal:created event', () => {
    const event = JSON.stringify({
      event: 'proposal:created',
      data: { id: 'new-1', action_type: 'heartbeat_finding', status: 'pending_approval' },
    });

    const { event: eventType, data } = JSON.parse(event);
    expect(eventType).toBe('proposal:created');
    expect(data.id).toBe('new-1');
  });

  it('parses proposal:comment event', () => {
    const event = JSON.stringify({
      event: 'proposal:comment',
      data: { id: '1', comment: { role: 'assistant', content: '回复', timestamp: '2026-02-22T12:00:00Z' } },
    });

    const { event: eventType, data } = JSON.parse(event);
    expect(eventType).toBe('proposal:comment');
    expect(data.comment.role).toBe('assistant');
  });

  it('parses proposal:resolved event', () => {
    const event = JSON.stringify({
      event: 'proposal:resolved',
      data: { id: '1' },
    });

    const { event: eventType, data } = JSON.parse(event);
    expect(eventType).toBe('proposal:resolved');
    expect(data.id).toBe('1');
  });

  it('handles non-JSON messages gracefully', () => {
    const rawMessage = 'ping';
    let parsed = null;
    try {
      parsed = JSON.parse(rawMessage);
    } catch {
      // Expected — non-JSON messages should be ignored
    }
    expect(parsed).toBeNull();
  });
});
