import { beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';

let pool;
let app;

beforeAll(async () => {
  pool = (await import('../../db.js')).default;
  const { default: router } = await import('../../routes/journeys.js');
  app = express();
  app.use(express.json());
  app.use('/api/brain', router);
});

describe('product journey-step ledger [PostgreSQL]', () => {
  it('returns a real four-zone cell ledger instead of a journey_features column error', async () => {
    const step = await pool.query(
      `SELECT id
       FROM activities
       WHERE id=(SELECT target_id FROM decisions WHERE source_ref='gp-ledger-phase3:nfr:gp-b:s1')`,
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
