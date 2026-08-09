import { describe, expect, it, vi } from 'vitest';
import { runProjectionOutbox } from '../outbox.js';

describe('projection outbox', () => {
  it('defers an event when its projection target is not configured', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'out-1', target: 'notion', entity_type: 'tasks', entity_id: 'task-1', attempts: 0 }] })
      .mockResolvedValue({ rows: [] });
    const adapter = vi.fn().mockResolvedValue({ skipped: true, reason: 'not_configured' });

    expect(await runProjectionOutbox({ query }, { adapter })).toMatchObject({ deferred: 1, done: 0 });
    expect(query.mock.calls.some(([sql]) => String(sql).includes("status='pending'"))).toBe(true);
  });
});
