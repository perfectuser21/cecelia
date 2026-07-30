import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import express from 'express';
import request from 'supertest';

let pool;
let app;
const migration373 = readFileSync(
  new URL('../../../migrations/373_gp_ledger_data_knife.sql', import.meta.url),
  'utf8',
);

beforeAll(async () => {
  pool = (await import('../../db.js')).default;
  // The full integration job replays migration 350 in an idempotency test,
  // which intentionally restores its historical NULL assertion refs. Reapply
  // 373 so this route contract observes the production post-migration state.
  await pool.query(migration373);
  const { default: router } = await import('../../routes/journeys.js');
  app = express();
  app.use(express.json());
  app.use('/api/brain', router);
});

describe('product journey-step ledger [PostgreSQL]', () => {
  it('returns a real four-zone cell ledger instead of a journey_features column error', async () => {
    const step = await pool.query(
      `SELECT id
       FROM journey_steps
       WHERE journey_id='ac2e35bc-849a-48cd-917f-79d15c5ac886'
         AND step_number=1`,
    );
    expect(step.rows).toHaveLength(1);

    const response = await request(app)
      .get(`/api/brain/journey_steps/${step.rows[0].id}/ledger`);

    expect(response.status).toBe(200);
    expect(response.body.step.home).toBe('biz');
    expect(response.body.zones.element.length).toBeGreaterThan(0);
    expect(response.body.zones.capability.length).toBeGreaterThan(0);
    expect(response.body.nfr_decisions).toHaveLength(1);
    expect(response.body.readiness.positive_missing).toBe(0);
    expect(response.body.readiness.ready).toBe(true);
  });
});
