import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../task-system/db.js', () => ({
  default: { query: vi.fn() }
}));
vi.mock('../event-bus.js', () => ({
  queryEvents: vi.fn(),
  getEventCounts: vi.fn(),
  ensureEventsTable: vi.fn()
}));
vi.mock('../circuit-breaker.js', () => ({
  getAllStates: vi.fn()
}));
vi.mock('../notifier.js', () => ({
  notifyDailySummary: vi.fn()
}));

import pool from '../../task-system/db.js';
import { getEventCounts } from '../event-bus.js';
import { getAllStates } from '../circuit-breaker.js';
import { notifyDailySummary } from '../notifier.js';
import { runDiagnosis } from '../self-diagnosis.js';

describe('Self-Diagnosis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAllStates.mockReturnValue({});
    notifyDailySummary.mockResolvedValue(true);
  });

  it('returns diagnosis report with metrics', async () => {
    getEventCounts.mockResolvedValue([
      { event_type: 'task_dispatched', count: '10' },
      { event_type: 'task_completed', count: '7' },
      { event_type: 'task_failed', count: '3' }
    ]);
    pool.query
      .mockResolvedValueOnce({ rows: [{ avg_duration_seconds: '120', max_duration_seconds: '300', min_duration_seconds: '30' }] }) // duration stats
      .mockResolvedValueOnce({ rows: [] }) // slow KRs
      .mockResolvedValueOnce({ rows: [] }); // failed goals

    const report = await runDiagnosis();

    expect(report.metrics.tasks_dispatched).toBe(10);
    expect(report.metrics.tasks_completed).toBe(7);
    expect(report.metrics.tasks_failed).toBe(3);
    expect(report.metrics.success_rate).toBe(70);
    expect(report.metrics.failure_rate).toBe(30);
    expect(report.metrics.avg_duration_seconds).toBe(120);
    expect(report.period).toHaveProperty('since');
    expect(report.period).toHaveProperty('until');
  });

  it('generates recommendations for high failure rate', async () => {
    getEventCounts.mockResolvedValue([
      { event_type: 'task_completed', count: '2' },
      { event_type: 'task_failed', count: '8' }
    ]);
    pool.query
      .mockResolvedValueOnce({ rows: [{}] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const report = await runDiagnosis();

    expect(report.metrics.failure_rate).toBe(80);
    expect(report.recommendations.length).toBeGreaterThan(0);
    expect(report.recommendations[0].severity).toBe('high');
  });

  it('generates recommendations for circuit breaker opens', async () => {
    getEventCounts.mockResolvedValue([
      { event_type: 'circuit_open', count: '3' },
      { event_type: 'task_completed', count: '5' },
      { event_type: 'task_failed', count: '0' }
    ]);
    getAllStates.mockReturnValue({ 'cecelia-run': { state: 'OPEN', failures: 3 } });
    pool.query
      .mockResolvedValueOnce({ rows: [{}] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const report = await runDiagnosis();

    const critical = report.recommendations.filter(r => r.severity === 'critical');
    expect(critical.length).toBeGreaterThan(0);
    expect(critical[0].message).toContain('OPEN');
  });

  it('generates recommendations for slow P0 KRs', async () => {
    getEventCounts.mockResolvedValue([
      { event_type: 'task_completed', count: '5' },
      { event_type: 'task_failed', count: '0' }
    ]);
    pool.query
      .mockResolvedValueOnce({ rows: [{}] })
      .mockResolvedValueOnce({ rows: [{ id: 'kr1', title: 'Critical KR', progress: 10, priority: 'P0' }] })
      .mockResolvedValueOnce({ rows: [] });

    const report = await runDiagnosis();

    const krRec = report.recommendations.find(r => r.message.includes('Critical KR'));
    expect(krRec).toBeDefined();
  });

  it('handles zero events gracefully', async () => {
    getEventCounts.mockResolvedValue([]);
    pool.query
      .mockResolvedValueOnce({ rows: [{}] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const report = await runDiagnosis();

    expect(report.metrics.success_rate).toBe(0);
    expect(report.metrics.tasks_dispatched).toBe(0);
  });

  it('creates tasks when createTasks=true', async () => {
    getEventCounts.mockResolvedValue([
      { event_type: 'task_completed', count: '1' },
      { event_type: 'task_failed', count: '9' }
    ]);
    pool.query
      .mockResolvedValueOnce({ rows: [{}] }) // duration
      .mockResolvedValueOnce({ rows: [] }) // slow KRs
      .mockResolvedValueOnce({ rows: [] }) // failed goals
      .mockResolvedValueOnce({ rows: [{ id: 'task-diag-1', title: '[Self-Diagnosis] Fix failures' }] }); // INSERT

    const report = await runDiagnosis({ createTasks: true, projectId: 'p1' });

    expect(report.tasks_created).toBeDefined();
    expect(report.tasks_created.length).toBeGreaterThan(0);
  });

  it('sends daily summary notification', async () => {
    getEventCounts.mockResolvedValue([
      { event_type: 'task_completed', count: '5' },
      { event_type: 'task_failed', count: '1' }
    ]);
    pool.query
      .mockResolvedValueOnce({ rows: [{}] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await runDiagnosis();

    expect(notifyDailySummary).toHaveBeenCalledWith(expect.objectContaining({
      completed: 5,
      failed: 1
    }));
  });

  it('uses custom since parameter', async () => {
    const customSince = '2026-01-25T00:00:00Z';
    getEventCounts.mockResolvedValue([]);
    pool.query
      .mockResolvedValueOnce({ rows: [{}] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const report = await runDiagnosis({ since: customSince });

    expect(report.period.since).toBe(customSince);
  });
});
