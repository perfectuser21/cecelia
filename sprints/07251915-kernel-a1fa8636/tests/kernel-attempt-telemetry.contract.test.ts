import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';

import harnessRoutesRouter from '../../../packages/brain/src/routes/harness.routes.js';
import { readFileSync } from 'node:fs';

const app = express();
app.use('/api/brain/harness', harnessRoutesRouter);

describe('kernel attempt telemetry contract [BEHAVIOR]', () => {
  it('GET /api/brain/harness/tasks/:task_id/attempt-telemetry 返回 telemetry schema', async () => {
    const res = await request(app)
      .get('/api/brain/harness/tasks/11111111-1111-4111-8111-111111111111/attempt-telemetry?include_attempts=true');

    expect(res.status).toBe(200);
    expect(res.body.task_id).toBe('11111111-1111-4111-8111-111111111111');
    expect(typeof res.body.run_count).toBe('number');
    expect(typeof res.body.logical_cycle_count).toBe('number');
    expect(typeof res.body.totals?.active_time_ms).toBe('number');
    expect(Array.isArray(res.body.role_metrics)).toBe(true);
    expect(Array.isArray(res.body.attempts)).toBe(true);
    expect(typeof res.body.attempts?.[0]?.status).toBe('string');
  });

  it('GET /api/brain/harness/tasks/:task_id/attempt-telemetry response keys 精确等于 telemetry 合同 keys', async () => {
    const res = await request(app)
      .get('/api/brain/harness/tasks/11111111-1111-4111-8111-111111111111/attempt-telemetry?include_attempts=true');

    expect(Object.keys(res.body).sort()).toEqual([
      'attempts',
      'logical_cycle_count',
      'role_metrics',
      'run_count',
      'task_id',
      'totals',
    ]);
  });

  it('migration 358 adds lineage telemetry columns to harness_attempts', () => {
    const sql = readFileSync(
      new URL('../../../packages/brain/migrations/358_kernel_attempt_telemetry.sql', import.meta.url),
      'utf8',
    );
    expect(sql).toMatch(/logical_cycle_id/);
    expect(sql).toMatch(/attempt_kind/);
    expect(sql).toMatch(/retry_of_attempt_id/);
    expect(sql).toMatch(/restart_reason/);
    expect(sql).toMatch(/workstream_key/);
  });

  it('expired running attempt is resumed or structurally closed instead of hanging forever', async () => {
    const res = await request(app)
      .get('/api/brain/harness/tasks/22222222-2222-4222-8222-222222222222/attempt-telemetry?include_attempts=true');

    expect(res.status).toBe(200);
    expect(
      res.body.attempts.some((attempt: any) =>
        ['resume', 'recovery'].includes(attempt.attempt_kind)
        || (
          ['failed', 'cancelled', 'blocked', 'needs_context'].includes(attempt.status)
          && attempt.completed_at
        )),
    ).toBe(true);
  });
});
