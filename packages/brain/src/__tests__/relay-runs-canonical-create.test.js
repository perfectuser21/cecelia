import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const {
  mockPool,
  mockCreateKernelRun,
} = vi.hoisted(() => ({
  mockPool: { query: vi.fn(), connect: vi.fn() },
  mockCreateKernelRun: vi.fn(),
}));

vi.mock('../db.js', () => ({ default: mockPool }));
vi.mock('../orchestrator/kernel-run-store.js', () => ({
  createKernelRun: mockCreateKernelRun,
  loadKernelRunById: vi.fn(),
  patchKernelRunById: vi.fn(),
}));

const INITIATIVE_ID = 'aaaabbbb-cccc-4ddd-8eee-ffff00001111';
const TASK_ID = '11111111-2222-4333-8444-555555555555';
const RUN_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa';

async function buildApp() {
  const { default: router } = await import('../routes/initiatives.js');
  const app = express();
  app.use(express.json());
  app.use('/api/brain/orchestrator', router);
  return app;
}

describe('canonical POST /orchestrator/relay-runs', () => {
  beforeEach(() => {
    mockPool.query.mockReset();
    mockPool.connect.mockReset();
    mockCreateKernelRun.mockReset();
    mockCreateKernelRun.mockResolvedValue({
      created: true,
      run: {
        id: RUN_ID,
        initiative_id: INITIATIVE_ID,
        current_task_id: TASK_ID,
        phase: 'planning',
        orchestrator_host: 'foreground',
        created_source: 'foreground_handoff',
      },
    });
  });

  it.each([
    {},
    { initiative_id: INITIATIVE_ID },
    {
      initiative_id: INITIATIVE_ID,
      current_task_id: TASK_ID,
    },
  ])('requires initiative, task, and source identity: %j', async (body) => {
    const app = await buildApp();

    const response = await request(app)
      .post('/api/brain/orchestrator/relay-runs')
      .send(body);

    expect(response.status).toBe(400);
    expect(mockCreateKernelRun).not.toHaveBeenCalled();
  });

  it('returns the authoritative run id and identity', async () => {
    const app = await buildApp();

    const response = await request(app)
      .post('/api/brain/orchestrator/relay-runs')
      .send({
        initiative_id: INITIATIVE_ID,
        current_task_id: TASK_ID,
        created_source: 'foreground_handoff',
        phase: 'planning',
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      created: true,
      run: {
        id: RUN_ID,
        initiative_id: INITIATIVE_ID,
        current_task_id: TASK_ID,
        created_source: 'foreground_handoff',
      },
    });
  });

  it('fails closed when the task is not eligible', async () => {
    mockCreateKernelRun.mockRejectedValueOnce(
      new Error(`kernel run task ${TASK_ID} not eligible`),
    );
    const app = await buildApp();

    const response = await request(app)
      .post('/api/brain/orchestrator/relay-runs')
      .send({
        initiative_id: INITIATIVE_ID,
        current_task_id: TASK_ID,
        created_source: 'foreground_handoff',
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toContain('not eligible');
  });
});
