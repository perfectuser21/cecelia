import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ default: { query: mocks.query } }));

import taskTasksRouter from '../routes/task-tasks.js';

describe('task list queue lanes', () => {
  it('returns a server-classified queue_lane without exposing task payload', async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    const app = express();
    app.use('/api/brain/tasks/tasks', taskTasksRouter);

    const response = await request(app).get('/api/brain/tasks/tasks?limit=10');

    expect(response.status).toBe(200);
    const listSql = mocks.query.mock.calls[0][0];
    expect(listSql).toContain('AS queue_lane');
    expect(listSql).toContain("payload->>'headed_manual'");
    expect(listSql).toContain("task_type IN ('content-pipeline'");
    expect(listSql).not.toMatch(/SELECT[^;]*\bpayload\b\s*(?:,|FROM)/s);
  });
});
