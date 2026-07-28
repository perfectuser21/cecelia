import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { createRunEventStore } from '../run-event-store.js';

describe('Run event store', () => {
  it('appends only through the idempotent database function', async () => {
    const runId = randomUUID();
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ cursor: '1' }] }),
    };
    const events = createRunEventStore(pool);

    await expect(events.append({
      runId,
      eventType: 'commander.directive_rejected',
      sourceType: 'commander_directive',
      sourceId: randomUUID(),
      sourceVersion: 0,
      payload: { reason_code: 'stale_event_cursor' },
    })).resolves.toMatchObject({ cursor: 1 });
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][0]).toContain('append_harness_run_event');
    expect(pool.query.mock.calls[0][0]).not.toMatch(/INSERT INTO harness_run_events/i);
  });

  it('lists ascending events and caps the page size', async () => {
    const runId = randomUUID();
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          { run_id: runId, cursor: '8', source_version: '1' },
          { run_id: runId, cursor: '9', source_version: '2' },
        ],
      }),
    };
    const events = createRunEventStore(pool);

    await expect(events.list(runId, { afterCursor: 7, limit: 999 })).resolves.toMatchObject([
      { cursor: 8 },
      { cursor: 9 },
    ]);
    expect(pool.query.mock.calls[0][0]).toContain('ORDER BY cursor ASC');
    expect(pool.query.mock.calls[0][1]).toEqual([runId, 7, 200]);
  });

  it('proves every evidence reference belongs to the current Run', async () => {
    const runId = randomUUID();
    const attemptId = randomUUID();
    const pool = {
      query: vi.fn(async (sql) => {
        if (sql.includes('harness_run_events')) return { rows: [{ cursor: '7' }] };
        return { rows: [{ id: attemptId }] };
      }),
    };
    const events = createRunEventStore(pool);

    await expect(events.assertEvidenceRefs(runId, [
      'event:7',
      `attempt:${attemptId}`,
    ])).resolves.toBe(true);

    pool.query = vi.fn(async (sql) => (
      sql.includes('harness_run_events') ? { rows: [] } : { rows: [{ id: attemptId }] }
    ));
    await expect(events.assertEvidenceRefs(runId, ['event:7'])).rejects.toThrow('evidence_not_owned');
  });
});
