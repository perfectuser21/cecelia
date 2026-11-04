import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  blockTask: vi.fn(),
  classifyFailure: vi.fn(),
}));
vi.mock('../../db.js', () => ({ default: { query: mocks.query } }));
vi.mock('../../task-updater.js', () => ({ blockTask: mocks.blockTask }));
vi.mock('../../quarantine.js', () => ({
  classifyFailure: mocks.classifyFailure,
  quarantineTask: vi.fn(),
}));

import taskErrorReportRouter from '../task-error-report.js';

afterEach(() => vi.restoreAllMocks());
describe('task error report route', () => {
  it('blocks a transient network failure with a bounded TTL', async () => {
    const now = Date.parse('2026-11-04T00:00:00Z');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    mocks.query.mockResolvedValue({ rows: [{ id: 'task-1', title: 'Task', status: 'in_progress', payload: {} }] });
    mocks.classifyFailure.mockReturnValue({ class: 'network', retry_strategy: { reason: 'retry network' } });
    const app = express();
    app.use(express.json());
    app.use('/tasks', taskErrorReportRouter);

    const response = await request(app)
      .post('/tasks/task-1/error-report')
      .send({ error_message: 'ECONNRESET' });

    expect(response.status).toBe(200);
    expect(response.body.blocked_until).toBe('2026-11-04T00:05:00.000Z');
    expect(response.body).toMatchObject({ action: 'blocked', failure_class: 'network' });
    expect(mocks.blockTask).toHaveBeenCalledWith('task-1', expect.objectContaining({ until: '2026-11-04T00:05:00.000Z' }));
  });
});
