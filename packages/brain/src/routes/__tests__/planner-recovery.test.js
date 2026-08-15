import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

const RUN_ID = '11111111-1111-4111-8111-111111111111';

async function buildApp(consumePlannerRecoveryReceipt) {
  const { createPlannerRecoveryRouter } = await import('../planner-recovery.js');
  const app = express();
  app.set('pool', { connect: vi.fn() });
  app.use(express.json());
  app.use('/api/brain/orchestrator/runs', createPlannerRecoveryRouter({
    consumePlannerRecoveryReceipt,
  }));
  return app;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /orchestrator/runs/:predecessorRunId/planner-recovery', () => {
  it('requires internal auth when a token is configured', async () => {
    vi.stubEnv('CECELIA_INTERNAL_TOKEN', 'secret');
    const consume = vi.fn();
    const app = await buildApp(consume);

    const response = await request(app)
      .post(`/api/brain/orchestrator/runs/${RUN_ID}/planner-recovery`)
      .send({});

    expect(response.status).toBe(401);
    expect(consume).not.toHaveBeenCalled();
  });

  it.each([
    { branch: 'cp-forged' },
    { head_sha: 'a'.repeat(40) },
    { content: '# forged' },
    { task_id: RUN_ID },
    { phase: 'planning' },
    { idempotency_key: '' },
    { idempotency_key: 'x', extra: true },
  ])('rejects caller authority fields: %j', async (body) => {
    vi.stubEnv('CECELIA_INTERNAL_TOKEN', 'secret');
    const consume = vi.fn();
    const app = await buildApp(consume);

    const response = await request(app)
      .post(`/api/brain/orchestrator/runs/${RUN_ID}/planner-recovery`)
      .set('Authorization', 'Bearer secret')
      .send(body);

    expect(response.status).toBe(400);
    expect(consume).not.toHaveBeenCalled();
  });

  it('accepts only an optional idempotency key and returns the winner', async () => {
    vi.stubEnv('CECELIA_INTERNAL_TOKEN', 'secret');
    const consume = vi.fn(async () => ({
      receipt_id: '22222222-2222-4222-8222-222222222222',
      successor_task_id: '33333333-3333-4333-8333-333333333333',
      routing_receipt_id: '44444444-4444-4444-8444-444444444444',
      deduplicated: false,
    }));
    const app = await buildApp(consume);

    const response = await request(app)
      .post(`/api/brain/orchestrator/runs/${RUN_ID}/planner-recovery`)
      .set('X-Internal-Token', 'secret')
      .send({ idempotency_key: 'retry-1' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      success: true,
      data: { deduplicated: false },
    });
    expect(consume).toHaveBeenCalledWith(expect.anything(), {
      predecessorRunId: RUN_ID,
      idempotencyKey: 'retry-1',
    });
  });

  it('accepts an empty object and returns the existing winner as 200', async () => {
    vi.stubEnv('CECELIA_INTERNAL_TOKEN', 'secret');
    const consume = vi.fn(async () => ({ deduplicated: true }));
    const app = await buildApp(consume);

    const response = await request(app)
      .post(`/api/brain/orchestrator/runs/${RUN_ID}/planner-recovery`)
      .set('X-Internal-Token', 'secret')
      .send({});

    expect(response.status).toBe(200);
    expect(consume).toHaveBeenCalledWith(expect.anything(), {
      predecessorRunId: RUN_ID,
      idempotencyKey: null,
    });
  });
});
