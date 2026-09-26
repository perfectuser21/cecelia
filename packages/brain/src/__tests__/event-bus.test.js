import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn() }
}));

import pool from '../db.js';
import { ensureEventsTable, emit, queryEvents, getEventCounts } from '../event-bus.js';

describe('EventBus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ensureEventsTable', () => {
    it('creates table and index', async () => {
      pool.query.mockResolvedValue({ rows: [] });
      await ensureEventsTable();
      expect(pool.query).toHaveBeenCalledTimes(2);
      expect(pool.query.mock.calls[0][0]).toContain('CREATE TABLE IF NOT EXISTS cecelia_events');
      expect(pool.query.mock.calls[1][0]).toContain('CREATE INDEX IF NOT EXISTS');
    });
  });

  describe('emit', () => {
    it('inserts event into cecelia_events', async () => {
      pool.query.mockResolvedValue({ rows: [] });
      await emit('task_dispatched', 'tick', { task_id: 't1' });
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO cecelia_events'),
        ['task_dispatched', 'tick', { task_id: 't1' }]
      );
    });

    it('does not throw on DB error', async () => {
      pool.query.mockRejectedValue(new Error('DB down'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await emit('test', 'test', {});
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[event-bus]'), expect.any(String));
      consoleSpy.mockRestore();
    });

    it('uses empty object as default payload', async () => {
      pool.query.mockResolvedValue({ rows: [] });
      await emit('test_event', 'source');
      expect(pool.query).toHaveBeenCalledWith(
        expect.any(String),
        ['test_event', 'source', {}]
      );
    });
  });

  describe('queryEvents', () => {
    it('returns events with no filters', async () => {
      pool.query.mockResolvedValue({ rows: [{ id: 1, event_type: 'test', source: 'test', payload: {}, created_at: '2026-01-01' }] });
      const events = await queryEvents();
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM cecelia_events'),
        [50]
      );
      expect(events).toHaveLength(1);
    });

    it('filters by eventType', async () => {
      pool.query.mockResolvedValue({ rows: [] });
      await queryEvents({ eventType: 'task_dispatched' });
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('event_type = $1'),
        ['task_dispatched', 50]
      );
    });

    it('filters by source and since', async () => {
      pool.query.mockResolvedValue({ rows: [] });
      await queryEvents({ source: 'tick', since: '2026-01-01T00:00:00Z' });
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('source = $1'),
        ['tick', '2026-01-01T00:00:00Z', 50]
      );
    });

    it('respects custom limit', async () => {
      pool.query.mockResolvedValue({ rows: [] });
      await queryEvents({ limit: 10 });
      expect(pool.query).toHaveBeenCalledWith(expect.any(String), [10]);
    });
  });

  describe('getEventCounts', () => {
    it('returns counts grouped by event type', async () => {
      pool.query.mockResolvedValue({
        rows: [
          { event_type: 'task_dispatched', count: '5' },
          { event_type: 'task_completed', count: '3' }
        ]
      });
      const counts = await getEventCounts('2026-01-01T00:00:00Z');
      expect(counts).toHaveLength(2);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('GROUP BY event_type'),
        ['2026-01-01T00:00:00Z']
      );
    });
  });
});

describe('on/off — 进程内订阅（棒3a 判定：run.finished 的接线口）', () => {
  it('on 后 emit 同步派发 payload 给订阅者；off 后不再收', async () => {
    const { on, off } = await import('../event-bus.js');
    pool.query.mockResolvedValue({ rows: [] });
    const seen = [];
    const handler = (payload, meta) => { seen.push({ payload, meta }); };
    on('run.finished', handler);
    await emit('run.finished', 'task-run', { runId: 'r1' });
    expect(seen).toHaveLength(1);
    expect(seen[0].payload).toEqual({ runId: 'r1' });
    expect(seen[0].meta).toMatchObject({ eventType: 'run.finished', source: 'task-run' });
    off('run.finished', handler);
    await emit('run.finished', 'task-run', { runId: 'r2' });
    expect(seen).toHaveLength(1);
  });

  it('一个订阅者抛错不影响其他订阅者，emit 也不抛（fail-open）', async () => {
    const { on } = await import('../event-bus.js');
    pool.query.mockResolvedValue({ rows: [] });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const calls = [];
    const unsubBad = on('x.evt', () => { throw new Error('boom'); });
    const unsubGood = on('x.evt', async () => { calls.push('good'); });
    await expect(emit('x.evt', 'test', {})).resolves.toBeUndefined();
    expect(calls).toEqual(['good']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[event-bus] subscriber'), expect.any(String));
    unsubBad(); unsubGood(); warn.mockRestore();
  });

  it('落库失败也照样派发给订阅者（订阅与审计落库解耦）', async () => {
    const { on } = await import('../event-bus.js');
    pool.query.mockRejectedValue(new Error('DB down'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    let got = null;
    const unsub = on('y.evt', (p) => { got = p; });
    await emit('y.evt', 'test', { a: 1 });
    expect(got).toEqual({ a: 1 });
    unsub(); err.mockRestore();
  });
});
